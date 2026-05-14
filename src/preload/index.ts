import { contextBridge, ipcRenderer } from 'electron'
import type {
  GenerateParams,
  LLMResult,
  ProviderSettings,
  StrategyType,
  AnalysisInput,
  PromptTemplate,
  StreamCallbacks,
  CancelStream,
  ProviderCheckResult,
  TokenUsage,
} from '../shared/types'
import { IPC_CHANNELS } from '../shared/types'
import type { BigQueryUsage } from '../shared/searchTypes'
import type {
  SearchQuery,
  SearchSettings,
  SearchProgress,
  SearchResult,
  SearchPromptTemplate,
} from '../shared/searchTypes'
import { SEARCH_CHANNELS } from '../shared/searchTypes'
import type {
  Project,
  ProjectWorkspaceState,
  CreateProjectParams,
  SaveProjectParams,
  PdfExtractResult,
} from '../shared/projectTypes'
import { PROJECT_CHANNELS } from '../shared/projectTypes'
import type {
  PatentStructure,
  SemanticChunk,
  EnrichedClaim,
  EnrichClaimsParams,
  EnrichmentResult,
} from '../shared/patentTypes'
import { CLAIM_CHANNELS } from '../shared/patentTypes'

// ─── Streaming helpers ────────────────────────────────────────────────────

let _streamCounter = 0
function nextRequestId(): string {
  return `stream-${Date.now()}-${++_streamCounter}`
}

// ─── API surface ──────────────────────────────────────────────────────────

const patentAPI = {
  // ── LLM ──────────────────────────────────────────────────────────────

  llm: {
    /** Non-streaming, full-response generate. */
    generate: (params: GenerateParams): Promise<LLMResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.LLM_GENERATE, params),

    /** Strategy-based analysis — prompt is built from the registry. */
    analyze: (
      strategy: StrategyType,
      input: AnalysisInput,
      searchId?: number
    ): Promise<LLMResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.LLM_ANALYZE, { strategy, input, searchId }),

    /**
     * Streaming generate.
     * Returns a cancel() function — call it to abort the in-flight stream.
     *
     * @example
     * const cancel = patentAPI.llm.stream(params, {
     *   onChunk: (delta) => setText(t => t + delta),
     *   onEnd:   (usage) => setUsage(usage),
     *   onError: (msg)   => setError(msg),
     * })
     * // later: cancel()
     */
    stream: (params: GenerateParams, callbacks: StreamCallbacks): CancelStream => {
      const requestId = nextRequestId()

      // ── listeners ──
      const onChunk = (_: unknown, payload: { requestId: string; delta: string }) => {
        if (payload.requestId === requestId) callbacks.onChunk(payload.delta)
      }
      const onEnd = (_: unknown, payload: { requestId: string; usage: TokenUsage | null }) => {
        if (payload.requestId !== requestId) return
        cleanup()
        callbacks.onEnd(payload.usage)
      }
      const onError = (_: unknown, payload: { requestId: string; message: string; code: string }) => {
        if (payload.requestId !== requestId) return
        cleanup()
        callbacks.onError(payload.message, payload.code)
      }

      const cleanup = () => {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM_CHUNK, onChunk)
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM_END, onEnd)
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM_ERROR, onError)
      }

      ipcRenderer.on(IPC_CHANNELS.STREAM_CHUNK, onChunk)
      ipcRenderer.on(IPC_CHANNELS.STREAM_END, onEnd)
      ipcRenderer.on(IPC_CHANNELS.STREAM_ERROR, onError)

      // ── kick off stream on main side ──
      ipcRenderer.send(IPC_CHANNELS.STREAM_START, { requestId, params })

      // ── cancel function ──
      return () => {
        cleanup()
        ipcRenderer.send(IPC_CHANNELS.STREAM_CANCEL, requestId)
      }
    },

    /** Check if the currently configured provider is reachable. */
    checkProvider: (): Promise<ProviderCheckResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.LLM_PROVIDER_CHECK),
  },

  // ── Settings ─────────────────────────────────────────────────────────

  settings: {
    get: (): Promise<ProviderSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

    set: (patch: Partial<ProviderSettings>): Promise<ProviderSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, patch),

    /** 저장된 검색 전략 템플릿 전체 목록 반환 */
    getSearchTemplates: (): Promise<SearchPromptTemplate[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_TEMPLATES_GET),

    /** 커스텀 템플릿 포함 전체 목록을 저장 */
    saveSearchTemplates: (templates: SearchPromptTemplate[]): Promise<SearchPromptTemplate[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_TEMPLATES_SAVE, templates),

    /** ClaimEnricher 시스템 프롬프트 조회 */
    getEnrichPrompt: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.ENRICH_PROMPT_GET),

    /** ClaimEnricher 시스템 프롬프트 저장 */
    setEnrichPrompt: (prompt: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.ENRICH_PROMPT_SET, prompt),
  },

  // ── BigQuery ──────────────────────────────────────────────────────────

  bigquery: {
    /** 이번 달 무료 한도 사용량 조회 */
    getUsage: (): Promise<BigQueryUsage> =>
      ipcRenderer.invoke(IPC_CHANNELS.BIGQUERY_GET_USAGE),
  },

  // ── Prompt registry ──────────────────────────────────────────────────

  prompts: {
    list: (strategy?: StrategyType): Promise<PromptTemplate[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROMPT_LIST, strategy),

    getActive: (strategy: StrategyType): Promise<PromptTemplate | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROMPT_GET, strategy),

    save: (template: Omit<PromptTemplate, 'id' | 'createdAt'>): Promise<PromptTemplate> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROMPT_SAVE, template),

    activate: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ACTIVATE, id),
  },

  // ── Analytics ────────────────────────────────────────────────────────

  db: {
    tokenStats: (): Promise<{ total_input: number; total_output: number; count: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_TOKEN_STATS),

    recentSearches: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_RECENT_SEARCHES, limit),

    analyses: (searchId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_ANALYSES, searchId),
  },

  // ── Projects ─────────────────────────────────────────────────────────

  project: {
    list: (): Promise<Project[]> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PROJECT_LIST),

    create: (params: CreateProjectParams): Promise<Project> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PROJECT_CREATE, params),

    load: (id: number): Promise<{ project: Project | null; workspace: ProjectWorkspaceState | null }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PROJECT_LOAD, id),

    save: (params: SaveProjectParams): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PROJECT_SAVE, params),

    delete: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PROJECT_DELETE, id),
  },

  // ── PDF ───────────────────────────────────────────────────────────────

  pdf: {
    openDialog: (): Promise<string | null> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PDF_OPEN_DIALOG),

    extract: (filePath: string): Promise<PdfExtractResult> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PDF_EXTRACT, filePath),

    chunk: (pdfText: string, claimText: string, maxChars?: number): Promise<{ chunked: string; totalChars: number }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PDF_CHUNK, { pdfText, claimText, maxChars }),

    /** Read PDF as base64 string — used by renderer to create a blob: URL for iframe preview. */
    readBuffer: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.PDF_READ_BUFFER, filePath),
  },

  context: {
    fetchUrl: (url: string): Promise<{ url: string; title: string; text: string }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.CONTEXT_FETCH_URL, url),
  },

  // ── Claim-aware pipeline ─────────────────────────────────────────────

  claim: {
    /** Parse PDF into structured PatentStructure (sections + claims). */
    parseStructure: (filePath: string): Promise<PatentStructure> =>
      ipcRenderer.invoke(CLAIM_CHANNELS.PDF_PARSE_STRUCTURE, filePath),

    /** Build semantic chunks from patent sections + link figure refs. */
    semanticChunk: (
      sections: PatentStructure['sections'],
      figureRefs: PatentStructure['figureRefs'],
    ): Promise<{ chunks: SemanticChunk[]; figureRefs: PatentStructure['figureRefs'] }> =>
      ipcRenderer.invoke(CLAIM_CHANNELS.PDF_SEMANTIC_CHUNK, { sections, figureRefs }),

    /** LLM-based structured enrichment of patent claims. */
    enrich: (params: EnrichClaimsParams): Promise<EnrichmentResult> =>
      ipcRenderer.invoke(CLAIM_CHANNELS.CLAIM_ENRICH, params),

    /** Run active claims_analysis prompt on extracted claims text → formatted display text. */
    extractText: (claimsText: string): Promise<{ displayText: string }> =>
      ipcRenderer.invoke(CLAIM_CHANNELS.CLAIM_EXTRACT_TEXT, claimsText),
  },

  // ── Export ────────────────────────────────────────────────────────────

  export: {
    markdown: (projectId: number): Promise<{ success: boolean; filePath: string | null }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.EXPORT_MARKDOWN, projectId),

    json: (projectId: number): Promise<{ success: boolean; filePath: string | null }> =>
      ipcRenderer.invoke(PROJECT_CHANNELS.EXPORT_JSON, projectId),
  },

  // ── Window controls ───────────────────────────────────────────────────

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close:    () => ipcRenderer.send('window:close'),
  },

  // ── Search ────────────────────────────────────────────────────────────

  search: {
    /** Get current search settings. */
    getSettings: (): Promise<SearchSettings> =>
      ipcRenderer.invoke(SEARCH_CHANNELS.SEARCH_SETTINGS_GET),

    /** Persist partial search settings update. */
    setSettings: (patch: Partial<SearchSettings>): Promise<SearchSettings> =>
      ipcRenderer.invoke(SEARCH_CHANNELS.SEARCH_SETTINGS_SET, patch),

    /** Retrieve search history entries. */
    history: (limit?: number): Promise<Record<string, unknown>[]> =>
      ipcRenderer.invoke(SEARCH_CHANNELS.SEARCH_HISTORY_LIST, limit),

    /**
     * Start a search run.  Progress arrives via onProgress; result via onComplete.
     * Returns a cancel() function.
     */
    start: (
      query: SearchQuery,
      callbacks: {
        onProgress: (p: SearchProgress) => void
        onComplete: (r: SearchResult) => void
        onError: (msg: string) => void
      },
    ): (() => void) => {
      const onProgress = (_: unknown, p: SearchProgress) => callbacks.onProgress(p)
      const onComplete = (_: unknown, r: SearchResult) => { cleanup(); callbacks.onComplete(r) }
      const onError = (_: unknown, e: { message: string }) => { cleanup(); callbacks.onError(e.message) }

      const cleanup = () => {
        ipcRenderer.removeListener(SEARCH_CHANNELS.SEARCH_PROGRESS, onProgress)
        ipcRenderer.removeListener(SEARCH_CHANNELS.SEARCH_COMPLETE, onComplete)
        ipcRenderer.removeListener(SEARCH_CHANNELS.SEARCH_ERROR, onError)
      }

      ipcRenderer.on(SEARCH_CHANNELS.SEARCH_PROGRESS, onProgress)
      ipcRenderer.on(SEARCH_CHANNELS.SEARCH_COMPLETE, onComplete)
      ipcRenderer.on(SEARCH_CHANNELS.SEARCH_ERROR, onError)

      ipcRenderer.send(SEARCH_CHANNELS.SEARCH_START, query)

      return () => {
        cleanup()
        ipcRenderer.send(SEARCH_CHANNELS.SEARCH_CANCEL)
      }
    },
  },
}

contextBridge.exposeInMainWorld('patentAPI', patentAPI)

export type PatentAPI = typeof patentAPI

declare global {
  interface Window {
    patentAPI: PatentAPI
  }
}
