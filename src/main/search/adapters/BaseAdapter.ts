/**
 * BaseAdapter — 모든 검색 어댑터의 기반 클래스.
 *
 * fetchJSON() 설계:
 *
 * [1] HTTP 429 (Rate Limit) 처리
 *   - 재시도 최대 3회, 지수 백오프 (2s → 4s → 8s)
 *   - Retry-After 헤더가 있으면 해당 시간 준수
 *   - 3회 모두 실패하면 명시적 에러를 throw (에러를 삼키지 않음)
 *
 * [2] 타임아웃 처리
 *   - 각 시도마다 독립적인 AbortController + setTimeout
 *   - 타임아웃 시 abort → net.fetch가 DOMException(AbortError) throw
 *
 * [3] 비 429 에러
 *   - 재시도 없이 즉시 throw (네트워크 에러, 4xx, 5xx 등)
 *   - 429 외 에러에서 retry하면 서버에 불필요한 부하를 준다
 *
 * [4] net.fetch 사용 이유
 *   - Electron의 net.fetch는 Chromium 네트워킹 스택을 사용
 *   - Windows 시스템 프록시 설정을 자동으로 준수
 *   - Node.js 글로벌 fetch가 특정 기업 환경에서 TLS 문제를 일으키는 것을 방지
 */

import { net } from 'electron'
import type { CandidateDoc, SearchQuery } from '../../../shared/searchTypes'

export interface AdapterOptions {
  apiKey?: string
  timeoutMs?: number
  maxResults?: number
}

// 재시도 간격: 2s, 4s, 8s (지수 백오프)
const RETRY_DELAY_BASE_MS = 2_000
const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export abstract class BaseAdapter {
  protected readonly timeoutMs: number
  protected readonly maxResults: number

  constructor(options: AdapterOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.maxResults = options.maxResults ?? 100
  }

  abstract readonly sourceName: string

  abstract search(query: SearchQuery): Promise<CandidateDoc[]>

  protected filterByDate(docs: CandidateDoc[], cutoffDate?: string): CandidateDoc[] {
    if (!cutoffDate) return docs
    const cutoff = new Date(cutoffDate)
    return docs.filter((d) => {
      const dateStr = d.publicationDate ?? d.filingDate
      if (!dateStr) return true
      return new Date(dateStr) <= cutoff
    })
  }

  /**
   * [1] 429 retry + [2] 타임아웃이 포함된 JSON fetch.
   *
   * 429 이외의 에러(네트워크 오류, 404, 500 등)는 재시도 없이 즉시 throw한다.
   */
  protected async fetchJSON<T>(
    url: string,
    init: RequestInit = {},
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    // ── [DEBUG] 요청 전 로그 ───────────────────────────────────────────────
    const safeHeaders = { ...(init.headers as Record<string, string> ?? {}) }
    if (safeHeaders['Authorization']) safeHeaders['Authorization'] = '***'
    if (safeHeaders['x-api-key'])    safeHeaders['x-api-key']    = '***'

    const bodyPreview = typeof init.body === 'string'
      ? init.body.slice(0, 600)
      : String(init.body ?? '(none)')

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`[${this.sourceName}] ▶ API 요청`)
    console.log(`  Method  : ${init.method ?? 'GET'}`)
    console.log(`  URL     : ${url}`)
    console.log(`  Headers : ${JSON.stringify(safeHeaders)}`)
    console.log(`  Body    : ${bodyPreview}`)
    console.log('─'.repeat(60))

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // [2] 시도별 독립 AbortController
      const res = await this.fetchWithTimeout(url, init, timeoutMs)

      if (res.status === 429) {
        const isLastAttempt = attempt === MAX_RETRIES - 1
        if (isLastAttempt) {
          throw new Error(
            `HTTP 429: rate limited after ${MAX_RETRIES} retries: ${url}`,
          )
        }

        // Retry-After 헤더 준수, 없으면 지수 백오프
        const retryAfterHeader = res.headers.get('Retry-After')
        const delayMs = retryAfterHeader
          ? Math.min(parseInt(retryAfterHeader, 10) * 1_000, 30_000)
          : RETRY_DELAY_BASE_MS * (2 ** attempt)  // 2s, 4s

        console.warn(
          `[${this.sourceName}] HTTP 429 — retry ${attempt + 1}/${MAX_RETRIES} in ${delayMs}ms`,
        )
        await sleep(delayMs)
        continue
      }

      // [3] 비 429 에러: 상태코드 + raw 응답 전체 로그 후 throw
      if (!res.ok) {
        let rawBody = '(응답 본문 읽기 실패)'
        try { rawBody = await res.text() } catch (_) { /* ignore */ }

        console.error(`\n${'!'.repeat(60)}`)
        console.error(`[${this.sourceName}] ✖ HTTP ${res.status} 오류`)
        console.error(`  URL     : ${url}`)
        console.error(`  Status  : ${res.status} ${res.statusText}`)
        console.error(`  Content-Type: ${res.headers.get('content-type') ?? 'unknown'}`)
        console.error(`  Raw Response (처음 3000자):`)
        console.error(rawBody.slice(0, 3_000))
        console.error('!'.repeat(60))

        throw new Error(`HTTP ${res.status}: ${url}\n원본 응답: ${rawBody.slice(0, 300)}`)
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        const rawBody = await res.text()
        console.error(`[${this.sourceName}] ✖ JSON이 아닌 응답 수신`)
        console.error(`  Content-Type: ${contentType}`)
        console.error(`  Raw Response (처음 1000자):\n${rawBody.slice(0, 1_000)}`)
        throw new Error(`JSON이 아닌 응답: Content-Type=${contentType}`)
      }

      return res.json() as Promise<T>
    }

    // for 루프가 정상적으로 완료되는 경우는 없지만 TypeScript 타입 흐름 상 필요
    throw new Error(`HTTP 429: rate limited: ${url}`)
  }

  /**
   * [4] net.fetch를 타임아웃과 함께 실행한다.
   * 타임아웃 시 AbortController를 통해 요청을 취소한다.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await net.fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}
