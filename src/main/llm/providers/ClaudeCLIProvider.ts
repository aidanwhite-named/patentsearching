/**
 * ClaudeCLIProvider — Windows-safe, deadlock-free Claude CLI wrapper.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * 설계 결정 요약
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * [1] 프롬프트 전달 방식
 *   Windows: 임시파일 → PowerShell 변수 → claude -p $prompt
 *     - cmd.exe /c의 인수 길이 한계 8,191자를 우회
 *     - PowerShell은 유니코드(한국어 포함)를 네이티브 지원
 *     - 임시파일은 프로세스 종료 후 안전하게 삭제
 *   Unix:    claude -p "prompt" (직접 인수, 길이·인코딩 문제 없음)
 *
 * [2] 프로세스 종료 (Windows)
 *   shell:true 또는 PowerShell wrapper를 사용하면 proc.pid는
 *   powershell.exe의 PID다. proc.kill()은 powershell.exe만 종료하고
 *   claude.exe는 계속 실행된다 → API 과금 지속, 다음 요청과 충돌.
 *   해결: taskkill /F /T /PID pid — 전체 프로세스 트리를 강제 종료.
 *
 * [3] stderr deadlock 방지
 *   stderr 파이프 버퍼(기본 64 KB)가 가득 차면 자식 프로세스가
 *   stderr 쓰기에서 block된다. 동시에 우리는 stdout 읽기에서 block된다.
 *   → 상호 대기 deadlock 발생.
 *   해결: stream/buffered 두 모드 모두에서 stderr를 항상 concurrent drain.
 *
 * [4] 'close' 이벤트 등록 순서
 *   stdout async 루프 종료(EOF) 이후에 proc.on('close') 를 등록하면
 *   이미 발생한 'close' 이벤트를 놓쳐 영원히 hang한다.
 *   해결: exitPromise를 stdout 루프 시작 전에 생성.
 *
 * [5] 임시파일 정리 타이밍
 *   PowerShell은 [System.IO.File]::ReadAllText() 로 파일 전체를 메모리에 읽은 후
 *   claude를 호출한다. stdout EOF 시점에는 이미 파일 읽기가 완료됐으므로
 *   finally 블록에서 삭제해도 안전하다.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { GenerateParams, LLMResult, StreamChunk } from '../../../shared/types'
import { LLMError } from '../types'
import type { LLMProvider, RetryConfig } from '../types'
import { RetryManager } from '../RetryManager'

const IS_WIN = process.platform === 'win32'

// 단일 프롬프트 최대 길이: PowerShell 변수 경유이므로 실질적 상한은 없으나
// 비정상적으로 큰 입력을 조기에 차단해 LLM timeout을 예방한다.
const MAX_PROMPT_CHARS = 120_000

interface SpawnResult {
  proc: ChildProcess
  tmpFile: string | null
}

export class ClaudeCLIProvider implements LLMProvider {
  readonly id = 'claude-cli'
  readonly name = 'Claude CLI'

  private readonly retry: RetryManager
  private readonly cliPath: string

  constructor(cliPath = 'claude', retryConfig?: Partial<RetryConfig>) {
    this.cliPath = cliPath
    this.retry = new RetryManager(retryConfig)
  }

  // ─── generate (buffered, retried) ──────────────────────────────────────────

  async generate(params: GenerateParams): Promise<LLMResult> {
    const startTime = Date.now()

    return this.retry.execute(async () => {
      const fullPrompt = this.buildFullPrompt(params)
      this.assertPromptLength(fullPrompt)

      const output = await this.runCLI(
        fullPrompt,
        this.buildModelArgs(params),
        params.timeout ?? 120_000,
      )

      return {
        content: output.trim(),
        model: params.model ?? 'claude-cli',
        provider: this.id,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - startTime,
        metadata: { via: 'cli' },
      }
    }, 'ClaudeCLIProvider.generate')
  }

  // ─── stream ────────────────────────────────────────────────────────────────

  async *stream(params: GenerateParams, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    if (signal?.aborted) return

    const fullPrompt = this.buildFullPrompt(params)
    this.assertPromptLength(fullPrompt)

    const { proc, tmpFile } = this.spawnProcess(fullPrompt, this.buildModelArgs(params))

    // [4] 'close' 핸들러를 stdout 루프 시작 전에 등록해 race condition 방지
    let stderrContent = ''
    const exitPromise = new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve()
        } else {
          reject(
            new LLMError(
              `CLI exited with code ${code}: ${stderrContent.slice(0, 300)}`,
              `CLI_STREAM_EXIT_${code}`,
              code !== 1,
              this.id,
            ),
          )
        }
      })
      proc.on('error', (err) =>
        reject(new LLMError(err.message, 'CLI_STREAM_ERROR', false, this.id)),
      )
    })

    // [3] stderr를 항상 concurrent drain — deadlock 방지
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrContent += chunk.toString('utf8')
    })

    const onAbort = () => this.killProcessTree(proc)
    signal?.addEventListener('abort', onAbort, { once: true })

    let buffer = ''

    try {
      if (!proc.stdout) {
        throw new LLMError('stdout not available', 'CLI_NO_STDOUT', false, this.id)
      }

      for await (const raw of proc.stdout) {
        if (signal?.aborted) break

        buffer += (raw as Buffer).toString('utf8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.length > 0) yield { delta: line + '\n', done: false }
        }
      }

      // 마지막 줄이 \n 없이 끝났을 경우 flush
      if (buffer.length > 0 && !signal?.aborted) {
        yield { delta: buffer, done: false }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      // [5] finally에서 삭제: PowerShell이 이미 파일을 메모리에 올렸으므로 안전
      this.deleteTmpFile(tmpFile)
    }

    if (signal?.aborted) {
      // abort 시 프로세스 트리 전체 종료
      this.killProcessTree(proc)
      return
    }

    // 정상 종료 시 exit code 확인
    await exitPromise

    yield { delta: '', done: true }
  }

  // ─── isAvailable ───────────────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    try {
      // prompt=null → 임시파일 없이 직접 실행 (--version은 프롬프트 불필요)
      await this.runCLI(null, ['--version'], 5_000)
      return true
    } catch {
      return false
    }
  }

  // ─── 프로세스 스폰 ─────────────────────────────────────────────────────────

  /**
   * [1] 플랫폼별 안전한 방식으로 Claude CLI를 스폰한다.
   *
   * Windows:
   *   1. 프롬프트를 UTF-8 임시파일에 기록 (BOM 없음)
   *   2. PowerShell.exe를 shell:false로 직접 스폰 (cmd.exe 우회)
   *   3. PowerShell이 파일을 읽어 $prompt 변수에 저장 후 claude -p $prompt 실행
   *   proc.pid = powershell.exe PID → killProcessTree()로 전체 트리 종료
   *
   * Unix:
   *   claude -p "prompt" [--model ...] 직접 스폰
   *   proc.pid = claude 프로세스 PID → SIGTERM으로 종료
   */
  private spawnProcess(prompt: string | null, extraArgs: string[]): SpawnResult {
    return IS_WIN
      ? this.spawnWindows(prompt, extraArgs)
      : this.spawnUnix(prompt, extraArgs)
  }

  private spawnWindows(prompt: string | null, extraArgs: string[]): SpawnResult {
    // 프롬프트 없음 (예: --version): cmd.exe로 직접 실행
    if (!prompt) {
      const argsStr = extraArgs.join(' ')
      const proc = spawn('cmd.exe', ['/d', '/c', `claude ${argsStr}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        env: { ...process.env },
      })
      return { proc, tmpFile: null }
    }

    // 임시파일에 UTF-8로 저장
    const tmpFile = path.join(
      os.tmpdir(),
      `patent-cli-${process.pid}-${Date.now()}.txt`,
    )
    // 'wx' flag: 파일이 이미 존재하면 에러 (충돌 방지)
    fs.writeFileSync(tmpFile, prompt, { encoding: 'utf8', flag: 'wx' })

    // PowerShell single-quoted string: ' → '' 이스케이프만 필요 (백슬래시는 리터럴)
    const psPath = tmpFile.replace(/'/g, "''")
    const psArgs = extraArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(' ')

    // PowerShell 커맨드:
    //   - UTF-8 콘솔 인코딩 설정
    //   - 임시파일 전체를 $prompt 변수에 로드
    //   - claude -p $prompt [--model ...] 실행
    //   $prompt를 PowerShell 변수로 전달하므로 길이·특수문자 제한 없음
    const psCommand = [
      'chcp 65001 | Out-Null;',  // 자식 프로세스 포함 UTF-8 코드페이지 강제
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
      '[Console]::InputEncoding  = [System.Text.Encoding]::UTF8;',
      `$prompt = [System.IO.File]::ReadAllText('${psPath}', [System.Text.Encoding]::UTF8);`,
      `& claude -p $prompt ${psArgs}`,
    ].join(' ')

    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psCommand],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,             // powershell.exe를 직접 실행 (cmd.exe 래핑 없음)
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          LANG: 'en_US.UTF-8',
        },
      },
    )

    return { proc, tmpFile }
  }

  private spawnUnix(prompt: string | null, extraArgs: string[]): SpawnResult {
    const args = prompt !== null ? ['-p', prompt, ...extraArgs] : extraArgs
    const proc = spawn(this.cliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    return { proc, tmpFile: null }
  }

  // ─── 버퍼링 실행 ───────────────────────────────────────────────────────────

  /**
   * 타임아웃 + [3] stderr drain이 포함된 버퍼링 CLI 실행.
   * 'close'와 'error' 핸들러를 data �핸들러보다 먼저 등록해 이벤트 누락 방지.
   */
  private runCLI(
    prompt: string | null,
    extraArgs: string[],
    timeoutMs: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const { proc, tmpFile } = this.spawnProcess(prompt, extraArgs)

      let stdout = ''
      let stderr = ''
      let settled = false

      // 한 번만 settle되도록 wrapping
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.deleteTmpFile(tmpFile)
        fn()
      }

      // 타임아웃: 지정 시간 내에 프로세스가 종료되지 않으면 강제 종료
      const timer = setTimeout(() => {
        this.killProcessTree(proc)
        settle(() =>
          reject(
            new LLMError(
              `CLI timed out after ${timeoutMs}ms`,
              'CLI_TIMEOUT',
              true,
              this.id,
            ),
          ),
        )
      }, timeoutMs)

      // [3] stdout + stderr 동시 drain — deadlock 방지
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

      proc.on('close', (code) => {
        settle(() => {
          if (code === 0) {
            resolve(stdout)
          } else {
            const retryable =
              code === null || stderr.toLowerCase().includes('rate limit')
            reject(
              new LLMError(
                `CLI exited ${code}: ${stderr.slice(0, 300)}`,
                `CLI_EXIT_${code ?? 'NULL'}`,
                retryable,
                this.id,
              ),
            )
          }
        })
      })

      proc.on('error', (err) => {
        settle(() =>
          reject(
            new LLMError(
              `Failed to spawn CLI: ${err.message}`,
              'CLI_SPAWN',
              false,
              this.id,
            ),
          ),
        )
      })
    })
  }

  // ─── 프로세스 트리 종료 ────────────────────────────────────────────────────

  /**
   * [2] 프로세스와 모든 자식 프로세스를 종료한다.
   *
   * Windows:
   *   proc.pid = powershell.exe 또는 cmd.exe PID.
   *   proc.kill()은 이 직접 자식만 종료하고 claude.exe는 살아있는다.
   *   taskkill /F /T /PID 는 프로세스 트리 전체를 강제 종료한다.
   *     /F: 강제 종료 (FORCEFULLY)
   *     /T: 자식 프로세스 포함 (TREE)
   *
   * Unix:
   *   kill(-pid, SIGTERM): 프로세스 그룹 전체에 SIGTERM 전송.
   *   실패 시 proc.kill('SIGTERM')으로 fallback.
   */
  private killProcessTree(proc: ChildProcess): void {
    if (proc.pid == null || proc.killed) return

    if (IS_WIN) {
      try {
        execSync(`taskkill /F /T /PID ${proc.pid}`, {
          stdio: 'ignore',
          timeout: 3_000,
        })
      } catch {
        // 프로세스가 이미 종료됐을 경우
        try { proc.kill() } catch { /* ignore */ }
      }
    } else {
      try {
        process.kill(-proc.pid, 'SIGTERM')
      } catch {
        try { proc.kill('SIGTERM') } catch { /* ignore */ }
      }
    }
  }

  // ─── 내부 유틸 ─────────────────────────────────────────────────────────────

  private buildFullPrompt(params: GenerateParams): string {
    return params.systemPrompt
      ? `${params.systemPrompt}\n\n${params.prompt}`
      : params.prompt
  }

  private buildModelArgs(params: GenerateParams): string[] {
    const args: string[] = []
    if (params.model) args.push('--model', params.model)
    return args
  }

  private assertPromptLength(prompt: string): void {
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new LLMError(
        `Prompt too long: ${prompt.length} chars (max ${MAX_PROMPT_CHARS}). ` +
        'SemanticChunker나 ClaimEnricher에서 컨텍스트 크기를 줄이세요.',
        'CLI_PROMPT_TOO_LONG',
        false,
        this.id,
      )
    }
  }

  private deleteTmpFile(tmpFile: string | null): void {
    if (tmpFile === null) return
    try { fs.unlinkSync(tmpFile) } catch { /* 이미 삭제됐거나 생성 실패 */ }
  }
}
