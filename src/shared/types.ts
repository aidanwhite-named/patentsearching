// ─── LLM Core Types ────────────────────────────────────────────────────────

export interface GenerateParams {
  prompt: string
  systemPrompt?: string
  model?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface LLMResult {
  content: string
  model: string
  provider: string
  usage: TokenUsage
  latencyMs: number
  metadata?: Record<string, unknown>
}

export interface StreamChunk {
  delta: string
  done: boolean
  usage?: TokenUsage
}

// ─── Provider Settings ─────────────────────────────────────────────────────

export type ProviderMode = 'api' | 'cli' | 'auto'

export interface ProviderSettings {
  mode: ProviderMode
  apiKey?: string
  model: string
  temperature: number
  maxTokens: number
  timeout: number
  cliPath?: string
}

// ─── Prompt Registry ───────────────────────────────────────────────────────

export type StrategyType = 'novelty' | 'inventiveness' | 'prior_art' | 'claims_analysis'

export const STRATEGY_LABELS: Record<StrategyType, string> = {
  novelty: '신규성 분석',
  inventiveness: '진보성 분석',
  prior_art: '선행기술 조사',
  claims_analysis: '청구항 분석',
}

export interface PromptTemplate {
  id: number
  name: string
  version: string
  strategy: StrategyType
  provider: string
  template: string
  variables: string[]
  isActive: boolean
  createdAt: string
}

// ─── IPC Channels ──────────────────────────────────────────────────────────

export const IPC_CHANNELS = {
  // invoke/handle (request-response)
  LLM_GENERATE: 'llm:generate',
  LLM_ANALYZE: 'llm:analyze',
  LLM_PROVIDER_CHECK: 'llm:provider:check',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PROMPT_LIST: 'prompt:list',
  PROMPT_GET: 'prompt:get',
  PROMPT_SAVE: 'prompt:save',
  PROMPT_ACTIVATE: 'prompt:activate',
  DB_TOKEN_STATS: 'db:tokenStats',
  DB_RECENT_SEARCHES: 'db:recentSearches',
  DB_ANALYSES: 'db:analyses',

  // 검색 프롬프트 템플릿 CRUD
  SEARCH_TEMPLATES_GET:  'search:templates:get',
  SEARCH_TEMPLATES_SAVE: 'search:templates:save',   // 전체 배열을 저장 (커스텀 추가/삭제)

  // ClaimEnricher 시스템 프롬프트 외부 편집
  ENRICH_PROMPT_GET: 'enrich:prompt:get',
  ENRICH_PROMPT_SET: 'enrich:prompt:set',

  // BigQuery 사용량 조회
  BIGQUERY_GET_USAGE: 'bigquery:getUsage',

  // send/on (streaming — push from main → renderer)
  STREAM_START: 'llm:stream:start',     // renderer → main
  STREAM_CANCEL: 'llm:stream:cancel',   // renderer → main
  STREAM_CHUNK: 'llm:stream:chunk',     // main → renderer
  STREAM_END: 'llm:stream:end',         // main → renderer
  STREAM_ERROR: 'llm:stream:error',     // main → renderer
} as const

// ─── Streaming types ───────────────────────────────────────────────────────

export interface StreamStartPayload {
  requestId: string
  params: GenerateParams
}

export interface StreamChunkPayload {
  requestId: string
  delta: string
}

export interface StreamEndPayload {
  requestId: string
  usage: TokenUsage | null
}

export interface StreamErrorPayload {
  requestId: string
  message: string
  code: string
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void
  onEnd: (usage: TokenUsage | null) => void
  onError: (message: string, code: string) => void
}

/** Returned by patentAPI.llm.stream() — call to cancel the in-flight stream. */
export type CancelStream = () => void

// ─── Provider check ────────────────────────────────────────────────────────

export interface ProviderCheckResult {
  available: boolean
  provider: string
  mode: ProviderMode
  error?: string
  latencyMs?: number
}

// ─── Analysis Types ────────────────────────────────────────────────────────

export interface AnalysisInput {
  inventionTitle?: string
  inventionDescription?: string
  priorArtReferences?: string
  claims?: string
  technicalField?: string
}

export interface NoveltyResult {
  novelty: 'YES' | 'NO' | 'PARTIAL'
  score: number
  differences: string[]
  similar_elements: string[]
  reasoning: string
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface InventivenessResult {
  inventiveness: 'YES' | 'NO' | 'PARTIAL'
  score: number
  technical_advantages: string[]
  combination_analysis: string
  unexpected_effects: string[]
  reasoning: string
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
}
