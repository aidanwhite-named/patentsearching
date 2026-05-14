import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import type {
  GenerateParams,
  StrategyType,
  AnalysisInput,
  StreamStartPayload,
  ProviderCheckResult,
} from '../../shared/types'
import { IPC_CHANNELS } from '../../shared/types'
import { ProviderFactory } from '../llm/providers/ProviderFactory'
import { PromptRegistry } from '../llm/PromptRegistry'
import { PromptStrategy } from '../llm/PromptStrategy'
import { PatentDatabase } from '../db/Database'
import type { DatabaseManager } from '../db/DatabaseManager'
import { getSettings } from './settingsHandlers'

// requestId → AbortController (for in-flight streams)
const activeStreams = new Map<string, AbortController>()

export function registerLLMHandlers(dbManager: DatabaseManager): void {
  const registry = new PromptRegistry(dbManager)
  const patentDb = new PatentDatabase(dbManager)

  // ─── 1. Raw generation (request/response) ────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.LLM_GENERATE,
    async (_event: IpcMainInvokeEvent, params: GenerateParams) => {
      const provider = await ProviderFactory.getInstance().create(getSettings())
      return provider.generate(params)
    }
  )

  // ─── 2. Strategy-based analysis (request/response) ───────────────────────

  ipcMain.handle(
    IPC_CHANNELS.LLM_ANALYZE,
    async (
      _event: IpcMainInvokeEvent,
      {
        strategy,
        input,
        searchId,
      }: { strategy: StrategyType; input: AnalysisInput; searchId?: number }
    ) => {
      const settings = getSettings()
      const provider = await ProviderFactory.getInstance().create(settings)
      const promptStrategy = new PromptStrategy(registry)

      const providerHint = settings.mode === 'cli' ? 'all' : 'claude'
      const { prompt, systemPrompt } = promptStrategy.build(strategy, input, providerHint)
      const activeTemplate = registry.getActive(strategy, providerHint)

      const result = await provider.generate({
        prompt,
        systemPrompt,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        timeout: settings.timeout,
      })

      patentDb.addAnalysis({
        searchId,
        strategy,
        promptName: activeTemplate?.name,
        promptVersion: activeTemplate?.version,
        result: result.content,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      })

      return result
    }
  )

  // ─── 3. Streaming (push-style: send/on) ─────────────────────────────────
  //
  //  Lifecycle:
  //    renderer   → send(STREAM_START,  { requestId, params })
  //    main       → send(STREAM_CHUNK,  { requestId, delta })   × N
  //    main       → send(STREAM_END,    { requestId, usage })
  //    main       → send(STREAM_ERROR,  { requestId, message, code })  on error
  //    renderer   → send(STREAM_CANCEL, requestId)              optional

  ipcMain.on(
    IPC_CHANNELS.STREAM_START,
    async (event: IpcMainEvent, { requestId, params }: StreamStartPayload) => {
      const abort = new AbortController()
      activeStreams.set(requestId, abort)

      try {
        const settings = getSettings()
        const provider = await ProviderFactory.getInstance().create(settings)

        // Merge global settings with per-request params
        const resolvedParams: GenerateParams = {
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          timeout: settings.timeout,
          ...params,
        }

        let finalUsage = null
        const gen = provider.stream(resolvedParams, abort.signal)

        for await (const chunk of gen) {
          if (abort.signal.aborted) break

          if (!chunk.done) {
            event.sender.send(IPC_CHANNELS.STREAM_CHUNK, {
              requestId,
              delta: chunk.delta,
            })
          } else {
            finalUsage = chunk.usage ?? null
          }
        }

        if (!abort.signal.aborted) {
          event.sender.send(IPC_CHANNELS.STREAM_END, {
            requestId,
            usage: finalUsage,
          })
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          event.sender.send(IPC_CHANNELS.STREAM_ERROR, {
            requestId,
            message: (error as Error).message,
            code: (error as { code?: string }).code ?? 'UNKNOWN',
          })
        }
      } finally {
        activeStreams.delete(requestId)
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.STREAM_CANCEL, (_event: IpcMainEvent, requestId: string) => {
    const ctrl = activeStreams.get(requestId)
    if (ctrl) {
      ctrl.abort()
      activeStreams.delete(requestId)
      console.log(`[Stream] Cancelled ${requestId}`)
    }
  })

  // ─── 4. Provider availability check ─────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.LLM_PROVIDER_CHECK,
    async (): Promise<ProviderCheckResult> => {
      const settings = getSettings()
      const startTime = Date.now()
      try {
        const provider = await ProviderFactory.getInstance().resolve(settings)
        const available = await provider.isAvailable()
        return {
          available,
          provider: provider.name,
          mode: settings.mode,
          latencyMs: Date.now() - startTime,
        }
      } catch (error) {
        return {
          available: false,
          provider: 'unknown',
          mode: settings.mode,
          error: (error as Error).message,
          latencyMs: Date.now() - startTime,
        }
      }
    }
  )

  // ─── 5. Prompt registry IPC ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PROMPT_LIST, (_event, strategy?: StrategyType) =>
    registry.list(strategy)
  )

  ipcMain.handle(IPC_CHANNELS.PROMPT_GET, (_event, strategy: StrategyType) =>
    registry.getActive(strategy)
  )

  ipcMain.handle(
    IPC_CHANNELS.PROMPT_SAVE,
    (_event, template: Parameters<PromptRegistry['save']>[0]) => registry.save(template)
  )

  ipcMain.handle(IPC_CHANNELS.PROMPT_ACTIVATE, (_event, id: number) => {
    registry.activate(id)
    return { success: true }
  })

  // ─── 6. Analytics IPC ────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.DB_TOKEN_STATS, () => patentDb.getTokenStats())
  ipcMain.handle(IPC_CHANNELS.DB_RECENT_SEARCHES, (_event, limit?: number) =>
    patentDb.getRecentSearches(limit)
  )
  ipcMain.handle(IPC_CHANNELS.DB_ANALYSES, (_event, searchId: number) =>
    patentDb.getAnalysesForSearch(searchId)
  )
}
