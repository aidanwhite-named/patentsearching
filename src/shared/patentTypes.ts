/**
 * patentTypes — types for the claim-aware retrieval pipeline (Part 6 refactor).
 *
 * Flow:
 *   PDF → PatentStructureParser → PatentStructure
 *       → SemanticChunker      → SemanticChunk[]
 *       → FigureLinker         → FigureRef[] (linked to chunks)
 *       → ClaimEnricher (LLM)  → EnrichedClaim[]
 *       → CandidateRetriever   → uses enrichedClaim.searchQueries + components
 */

// ─── Patent document structure ────────────────────────────────────────────────

export type PatentSectionType =
  | 'title'
  | 'abstract'
  | 'technical_field'
  | 'background'
  | 'technical_problem'
  | 'solution'
  | 'effects'
  | 'figures_description'
  | 'detailed_description'
  | 'examples'
  | 'claims'
  | 'unknown'

export const SECTION_LABEL: Record<PatentSectionType, string> = {
  title:                '발명의 명칭',
  abstract:             '요약서',
  technical_field:      '기술분야',
  background:           '배경기술',
  technical_problem:    '기술적 과제',
  solution:             '해결수단',
  effects:              '발명의 효과',
  figures_description:  '도면 설명',
  detailed_description: '발명의 설명',
  examples:             '실시예',
  claims:               '청구항',
  unknown:              '기타',
}

export interface PatentSection {
  type: PatentSectionType
  title: string          // actual heading text as found in document
  text: string
}

export interface FigureRef {
  number: string         // "도 1", "FIG. 1"
  description: string    // from figures_description section
  relatedChunkIds: string[]
}

export interface PatentStructure {
  title: string
  sections: PatentSection[]
  claims: string[]       // individual claim texts (청구항 1, 2, 3 split)
  figureRefs: FigureRef[]
  rawText: string
  pageCount: number
  filePath: string
  publicationDate?: string  // YYYY-MM-DD 형식으로 정규화된 공개/출원일
  filingDate?: string       // YYYY-MM-DD 형식으로 정규화된 출원일 (별도 추출 시)
}

// ─── Semantic chunks ──────────────────────────────────────────────────────────

export interface SemanticChunk {
  id: string
  text: string
  sectionType: PatentSectionType
  sectionTitle: string
  charStart: number
  charEnd: number
  overlapBefore: string   // last 150 chars of preceding chunk
  overlapAfter: string    // first 150 chars of following chunk
  figureRefs: string[]    // figure numbers referenced in this chunk
}

// ─── Enriched claim ───────────────────────────────────────────────────────────

/**
 * One structural component within a claim.
 * All fields are grounded in the patent specification — no LLM hallucination.
 */
export interface ClaimComponent {
  name: string                  // component label from claim ("제어부", "센서")
  importance?: 1 | 2 | 3         // LLM-assigned weight for reranking
  technicalConcepts: string[]   // technology concepts from spec
  functionalRoles: string[]     // what it does ("입력 신호를 수신하여...")
  synonyms: string[]            // equivalent terms found in spec
  effects: string[]             // technical effects linked to this component
  supportingText: string        // verbatim spec excerpt used as evidence
}

/**
 * LLM-enriched representation of a single patent claim.
 * Used as the primary query object for prior art retrieval.
 */
export interface EnrichedClaim {
  claimNumber: number
  originalClaim: string
  isIndependent: boolean
  parentClaimNumber?: number
  components: ClaimComponent[]
  overallPurpose: string        // one-sentence summary of claim intent
  technicalDomain: string       // e.g. "반도체/메모리", "통신/무선"
  searchQueries: string[]       // 5-7 optimised prior-art search queries
  evidenceChunkIds: string[]    // IDs of SemanticChunks used as grounding
}

export interface EnrichmentResult {
  enrichedClaims: EnrichedClaim[]
  documentSummary: string
  technicalField: string
  keyTerms: string[]
  processingMs: number
  /** 프롬프트 커스터마이즈 등으로 인해 일부 필드를 파싱하지 못했을 때 발생하는 경고 목록 */
  warnings: string[]
}

// ─── IPC params ───────────────────────────────────────────────────────────────

export interface ParseStructureParams {
  filePath: string
}

export interface EnrichClaimsParams {
  patentStructure: PatentStructure
  chunks: SemanticChunk[]
  targetClaimNumbers?: number[]   // if omitted, enrich all claims
  /** 선택된 검색 전략 템플릿의 추가 지시사항 — ClaimEnricher 프롬프트에 삽입됨 */
  searchInstruction?: string
  /** User-provided supplemental context such as notes, URL text, or reference PDFs. */
  additionalContext?: string
}

// ─── IPC channels ─────────────────────────────────────────────────────────────

export const CLAIM_CHANNELS = {
  PDF_PARSE_STRUCTURE: 'pdf:parseStructure',
  PDF_SEMANTIC_CHUNK:  'pdf:semanticChunk',
  CLAIM_ENRICH:        'claim:enrich',
  CLAIM_EXTRACT_TEXT:  'claim:extractText',
} as const

export type ClaimChannel = typeof CLAIM_CHANNELS[keyof typeof CLAIM_CHANNELS]
