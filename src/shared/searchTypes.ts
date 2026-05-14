// ─── Claim Types ──────────────────────────────────────────────────────────────

export interface ClaimElement {
  id: string            // 'A', 'B', 'C' or '1', '2', '3'
  text: string
  importance: 1 | 2 | 3  // ★ weight for scoring
  isEssential: boolean
}

export interface ParsedClaim {
  raw: string
  elements: ClaimElement[]
  broadTerms: string[]       // flagged ambiguous/broad expressions
  technicalField: string
}

// ─── Candidate Document ────────────────────────────────────────────────────

export type SourceType = 'patentsview' | 'kipris' | 'openalex'
export type DocLanguage = 'ko' | 'en' | 'ja' | 'de' | 'fr' | 'unknown'

export interface CandidateDoc {
  id: string                 // dedup key: `${source}:${patentNumber}`
  patentNumber: string
  title: string
  abstract: string
  claims?: string
  description?: string
  inventors?: string[]
  assignee?: string
  filingDate?: string
  publicationDate?: string
  ipcCodes?: string[]
  url: string
  urlValid?: boolean         // populated by URLValidator
  source: SourceType
  language: DocLanguage
}

// ─── Scoring ───────────────────────────────────────────────────────────────

export interface BM25Score {
  docId: string
  score: number
  rank: number
}

export interface VectorScore {
  docId: string
  similarity: number
  rank: number
}

export interface RRFScore {
  docId: string
  rrfScore: number
  bm25Rank: number
  vectorRank: number
  finalRank: number
}

export interface HybridSearchResult {
  doc: CandidateDoc
  bm25Score: number
  vectorScore: number
  rrfScore: number
  rank: number
}

// ─── Claim Chart (대비표) ──────────────────────────────────────────────────

export type Verdict = 'COVERED' | 'PARTIAL' | 'NOT_COVERED'

export interface ClaimChartRow {
  element: ClaimElement
  priorArtText: string
  similarity: number         // 0–1
  verdict: Verdict
  reasoning: string
}

export interface ClaimChart {
  patentNumber: string
  title: string
  url: string
  claimElements: ClaimElement[]
  rows: ClaimChartRow[]
  overallSimilarity: number
  noveltyRisk: 'HIGH' | 'MEDIUM' | 'LOW'
  inventivenessRisk: 'HIGH' | 'MEDIUM' | 'LOW'
  summary: string
}

// ─── LLM Rerank Result ────────────────────────────────────────────────────

export interface ElementScore {
  elementId: string
  score: number              // 0–100
  evidence: string
}

export interface RerankScore {
  docId: string
  patentNumber: string
  elementScores: ElementScore[]
  weightedScore: number      // importance-weighted, 0–100
  noveltyThreat: boolean
  inventivenessThreat: boolean
  reasoning: string
  stage2Rank?: number
}

// ─── Search Prompt Template ────────────────────────────────────────────────

/**
 * 다중 검색 전략 템플릿 — 사용자가 드롭다운에서 선택.
 * 선택된 템플릿의 instruction이 ClaimEnricher 프롬프트에 삽입된다.
 */
export interface SearchPromptTemplate {
  id: string
  name: string
  description: string
  /** ClaimEnricher 프롬프트에 추가될 검색 전략 지시사항 */
  instruction: string
  isBuiltIn?: boolean   // true면 삭제 불가
}

export const DEFAULT_SEARCH_TEMPLATES: SearchPromptTemplate[] = [
  {
    id: 'auto',
    name: '자동 (기본)',
    description: '구성요소·기능·효과를 균형있게 분석하여 종합적 검색',
    instruction: '',
    isBuiltIn: true,
  },
  {
    id: 'structural',
    name: '구성요소 중심',
    description: '기술적 구성요소(부품·장치·수단)와 연결 관계에 집중',
    instruction:
      '검색 쿼리 생성 시 청구항의 기술적 구성요소(부품, 장치, 수단)와 그들의 연결·작동 관계를 특히 강조하십시오. ' +
      '구성요소 명칭, 하위 구성요소, 상호 연결 방식을 중심으로 검색 쿼리를 작성하십시오.',
    isBuiltIn: true,
  },
  {
    id: 'functional',
    name: '기능/효과 중심',
    description: '발명이 달성하는 기술적 효과와 기능적 목적에 집중',
    instruction:
      '검색 쿼리 생성 시 청구항이 달성하는 기술적 효과, 기능적 목적, 해결 과제를 특히 강조하십시오. ' +
      '동일한 효과나 기능을 다른 구성으로 달성하는 선행기술까지 넓게 탐색하는 쿼리를 작성하십시오.',
    isBuiltIn: true,
  },
  {
    id: 'application',
    name: '응용분야 중심',
    description: '발명의 적용 분야·산업 분야·사용 환경에 집중',
    instruction:
      '검색 쿼리 생성 시 청구항의 응용 분야, 산업 분야, 사용 환경, 용도를 특히 강조하십시오. ' +
      '해당 응용 분야에서 유사한 문제를 해결하는 기존 기술을 탐색하는 쿼리를 작성하십시오.',
    isBuiltIn: true,
  },
  {
    id: 'broad',
    name: '광범위 검색',
    description: '동의어·상위개념·관련 기술 분야까지 포함한 넓은 탐색',
    instruction:
      '검색 쿼리를 최대한 넓게 설정하십시오. 구성요소의 동의어, 상위 개념, ' +
      '기능적으로 동등한 표현, 인접 기술 분야까지 포함하여 선행기술을 폭넓게 탐색하십시오.',
    isBuiltIn: true,
  },
]

// ─── Search Query ──────────────────────────────────────────────────────────

export type SearchSource = 'patentsview' | 'kipris' | 'openalex'
  // 추후 추가 예정: | 'semantic_scholar' | 'espacenet' | 'bigquery'

export interface SearchQuery {
  id: string
  queryText: string
  parsedClaim?: ParsedClaim
  /** Structured LLM-enriched claim — takes priority over parsedClaim for retrieval. */
  enrichedClaim?: import('./patentTypes').EnrichedClaim
  cutoffDate?: string        // ISO date string — only docs before this date
  sources: SearchSource[]
  maxCandidatesPerSource: number
  language: 'ko' | 'en' | 'both'
  /** 사용자가 선택한 검색 전략 템플릿 ID */
  promptTemplateId?: string
}

// ─── Search Progress ───────────────────────────────────────────────────────

export type SearchPhase =
  | 'idle'
  | 'parsing_claim'
  | 'retrieving'
  | 'validating_urls'
  | 'reranking'
  | 'generating_chart'
  | 'complete'
  | 'error'

export interface SearchProgress {
  queryId: string
  phase: SearchPhase
  message: string
  candidatesFound: number
  candidatesProcessed: number
  totalCandidates: number
}

// ─── Full Search Result ────────────────────────────────────────────────────

export interface SearchResult {
  queryId: string
  query: SearchQuery
  candidates: HybridSearchResult[]
  reranked: RerankScore[]
  claimCharts: ClaimChart[]
  priorArtReport: string
  broadTermWarnings: string[]
  executionMs: number
}

// ─── Search Settings ───────────────────────────────────────────────────────

export interface SearchSettings {
  // ── 소스 토글 ─────────────────────────────────────────────────
  patentsViewEnabled: boolean
  kiprisEnabled: boolean
  openAlexEnabled: boolean
  // 추후 추가: espacenetEnabled, semanticScholarEnabled, bigQueryEnabled

  // ── API 자격증명 ──────────────────────────────────────────────
  kiprisApiKey?: string
  openAlexApiKey?: string
  // 추후 추가: espacenetClientId, espacenetClientSecret, bigQueryProjectId

  // ── 검색 파라미터 ─────────────────────────────────────────────
  maxCandidatesPerSource: number
  urlValidationEnabled: boolean
  rerankerEnabled: boolean
  rrfK: number               // default 60
}

// ─── IPC Channels ─────────────────────────────────────────────────────────

export const SEARCH_CHANNELS = {
  SEARCH_START:            'search:start',
  SEARCH_CANCEL:           'search:cancel',
  SEARCH_PROGRESS:         'search:progress',
  SEARCH_CANDIDATES_BATCH: 'search:candidates:batch',
  SEARCH_COMPLETE:         'search:complete',
  SEARCH_ERROR:            'search:error',
  SEARCH_HISTORY_LIST:     'search:history:list',
  SEARCH_SETTINGS_GET:     'search:settings:get',
  SEARCH_SETTINGS_SET:     'search:settings:set',
} as const

export type SearchChannelKey = keyof typeof SEARCH_CHANNELS
