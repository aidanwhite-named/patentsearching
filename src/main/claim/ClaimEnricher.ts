/**
 * ClaimEnricher — LLM-based structured enrichment of patent claims.
 *
 * Design principles:
 *  1. Spec-grounded only: the prompt explicitly forbids the LLM from using
 *     general knowledge to expand meanings.  Only text present in the retrieved
 *     specification chunks may be used as evidence.
 *  2. Per-claim LLM calls: one call per claim, with retrieved context appended.
 *  3. Retrieval before reasoning: ChunkRetriever selects the K most relevant
 *     spec chunks for each claim before the LLM is invoked.
 *  4. Robust JSON parsing: extraction is attempted with multiple fallback paths.
 *
 * Output: EnrichedClaim[] usable directly by CandidateRetriever as multi-query
 * search input (searchQueries) and by RerankerEngine for element comparison.
 */

import { ProviderFactory } from '../llm/providers/ProviderFactory'
import { getSettings } from '../ipc/settingsHandlers'
import { ChunkRetriever } from '../retrieval/ChunkRetriever'
import type {
  PatentStructure,
  SemanticChunk,
  EnrichedClaim,
  ClaimComponent,
  EnrichmentResult,
  EnrichClaimsParams,
} from '../../shared/patentTypes'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max spec characters sent to the LLM per claim. */
const MAX_CONTEXT_CHARS = 5_000

/** Sections preferred for claim context (ordered by usefulness). */
const PREFERRED_SECTIONS = [
  'solution',
  'detailed_description',
  'examples',
  'technical_problem',
  'effects',
] as const

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildEnrichPrompt(
  claim: string,
  contextText: string,
  claimNumber: number,
  searchInstruction = '',
): string {
  const instructionBlock = searchInstruction
    ? `\n[검색 전략 지시사항]\n${searchInstruction}\n`
    : ''

  return `당신은 특허 명세서 분석 전문가입니다. 청구항의 기술적 의미를 구조화하십시오.

[절대 규칙]
1. 아래 명세서 내용에 기재된 정보만 사용하십시오.
2. LLM의 배경 지식으로 의미를 확대·추론하지 마십시오.
3. 명세서에 없는 개념은 절대 추가하지 마십시오.
4. 불확실한 경우 "명세서에서 불명확"으로 표시하십시오.
${instructionBlock}
[분석 대상 청구항 ${claimNumber}]
${claim}

[관련 명세서 내용]
${contextText || '(관련 명세서 내용 없음)'}

[출력 형식]
아래 JSON만 출력하십시오. 주석, 설명, 마크다운 코드블록 없이 순수 JSON만:
{
  "components": [
    {
      "name": "구성요소 명칭 (청구항 원문 기준)",
      "technicalConcepts": ["명세서에 기재된 기술 개념 1", "..."],
      "functionalRoles": ["이 구성요소의 구체적 기능 (명세서 근거)", "..."],
      "synonyms": ["명세서에 등장하는 동의어/유사 표현", "..."],
      "effects": ["이 구성요소가 달성하는 기술적 효과 (명세서 근거)", "..."],
      "supportingText": "이 분석의 근거가 된 명세서 원문 발췌 (50자 이내)"
    }
  ],
  "overallPurpose": "청구항 전체의 기술적 목적 (1~2문장, 명세서 근거)",
  "technicalDomain": "기술 분야 (예: 반도체/메모리, 통신/무선, 소프트웨어/AI)",
  "searchQueries": [
    "선행기술 검색에 사용할 쿼리 1 (핵심 기술 개념 조합)",
    "쿼리 2 (다른 관점)",
    "쿼리 3 (동의어 활용)",
    "쿼리 4 (기능적 표현)",
    "쿼리 5 (효과/목적 기반)"
  ]
}`
}

// ─── JSON extractor ───────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  // Try raw parse first
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) return trimmed

  // Strip markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Find first { ... } block
  const start = trimmed.indexOf('{')
  const end   = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1)

  throw new Error('LLM 응답에서 JSON을 찾을 수 없습니다')
}

function parseEnrichResponse(
  raw: string,
  originalClaim: string,
  claimNumber: number,
  isIndependent: boolean,
  parentClaimNumber: number | undefined,
  evidenceChunkIds: string[],
): EnrichedClaim {
  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(extractJSON(raw))
  } catch (err) {
    console.warn('[ClaimEnricher] JSON parse failed, returning minimal enrichment:', err)
    return minimalEnrichment(originalClaim, claimNumber, isIndependent, parentClaimNumber)
  }

  const rawComponents = (parsed['components'] as unknown[]) ?? []
  const components: ClaimComponent[] = rawComponents.map((c) => {
    const comp = c as Record<string, unknown>
    return {
      name:              String(comp['name'] ?? ''),
      technicalConcepts: toStringArray(comp['technicalConcepts']),
      functionalRoles:   toStringArray(comp['functionalRoles']),
      synonyms:          toStringArray(comp['synonyms']),
      effects:           toStringArray(comp['effects']),
      supportingText:    String(comp['supportingText'] ?? ''),
    }
  })

  // Fallback: if no components parsed, create one from full claim
  if (components.length === 0) {
    components.push({
      name: `청구항 ${claimNumber} 전체`,
      technicalConcepts: [],
      functionalRoles: [],
      synonyms: [],
      effects: [],
      supportingText: '',
    })
  }

  const searchQueries = toStringArray(parsed['searchQueries'])
  // Always include the raw claim text as a fallback query
  if (!searchQueries.includes(originalClaim.slice(0, 200))) {
    searchQueries.push(originalClaim.slice(0, 200))
  }

  return {
    claimNumber,
    originalClaim,
    isIndependent,
    parentClaimNumber,
    components,
    overallPurpose:   String(parsed['overallPurpose'] ?? ''),
    technicalDomain:  String(parsed['technicalDomain'] ?? ''),
    searchQueries:    searchQueries.slice(0, 7),
    evidenceChunkIds,
  }
}

function minimalEnrichment(
  claim: string,
  num: number,
  isIndependent: boolean,
  parentNum?: number,
): EnrichedClaim {
  return {
    claimNumber: num,
    originalClaim: claim,
    isIndependent,
    parentClaimNumber: parentNum,
    components: [{ name: `청구항 ${num}`, technicalConcepts: [], functionalRoles: [], synonyms: [], effects: [], supportingText: '' }],
    overallPurpose: '',
    technicalDomain: '',
    searchQueries: [claim.slice(0, 200)],
    evidenceChunkIds: [],
  }
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map(String).filter((s) => s.length > 0)
}

// ─── Claim metadata helpers ───────────────────────────────────────────────────

/**
 * 종속항 판별 — 아래 모든 한국어/영어 패턴을 인식:
 *   "제N항에 있어서"  "제N항에 따른"  "제N항 내지 제M항 중 어느 한 항에 있어서"
 *   "청구항 N에 있어서"  "claim N, wherein"  "claim N of"
 */
function isIndependentClaim(claimText: string): boolean {
  const depPattern =
    /(?:제\s*\d+\s*항(?:\s*내지\s*제\s*\d+\s*항)?\s*(?:중\s*어느\s*한\s*항)?\s*(?:에\s*있어서|에\s*따른|의\s*방법))|(?:청구항\s*\d+\s*(?:에\s*있어서|에\s*따른))|(?:claim\s*\d+\s*(?:,\s*wherein|of\b))/i
  return !depPattern.test(claimText)
}

function getParentClaimNumber(claimText: string): number | undefined {
  // 우선순위: "제N항에 있어서" → "청구항 N에 있어서" → "claim N, wherein"
  const m =
    claimText.match(/제\s*(\d+)\s*항(?:\s*내지\s*제\s*\d+\s*항)?\s*(?:중\s*어느\s*한\s*항)?\s*(?:에\s*있어서|에\s*따른|의\s*방법)/i) ??
    claimText.match(/청구항\s*(\d+)\s*(?:에\s*있어서|에\s*따른)/i) ??
    claimText.match(/claim\s*(\d+)\s*(?:,\s*wherein|of\b)/i)
  return m ? parseInt(m[1], 10) : undefined
}

// ─── Main enricher ────────────────────────────────────────────────────────────

export class ClaimEnricher {
  /**
   * Enrich patent claims using LLM + spec chunk retrieval.
   *
   * @param params  PatentStructure + SemanticChunks + optional claim number filter
   */
  async enrich(params: EnrichClaimsParams): Promise<EnrichmentResult> {
    const { patentStructure, chunks, targetClaimNumbers, searchInstruction } = params
    const startMs = Date.now()

    console.log(`\n${'='.repeat(70)}`)
    console.log(`[ClaimEnricher] 청구항 강화 시작`)
    console.log(`  발명 제목    : ${patentStructure.title}`)
    console.log(`  전체 청구항  : ${patentStructure.claims.length}개`)
    console.log(`  처리 대상    : ${targetClaimNumbers ? targetClaimNumbers.join(', ') : '전체'}`)
    console.log(`  청크 수      : ${chunks.length}개`)
    console.log(`  검색 전략    : ${searchInstruction ? `"${searchInstruction.slice(0, 80)}"` : '기본 (없음)'}`)
    console.log('='.repeat(70))

    const settings  = getSettings()
    const provider  = await ProviderFactory.getInstance().create(settings)
    const retriever = new ChunkRetriever(chunks)

    const claimsToProcess = targetClaimNumbers
      ? patentStructure.claims.filter((_, i) => targetClaimNumbers.includes(i + 1))
      : patentStructure.claims

    if (claimsToProcess.length === 0) {
      return {
        enrichedClaims: [],
        documentSummary: '',
        technicalField: '',
        keyTerms: [],
        processingMs: Date.now() - startMs,
      }
    }

    const enrichedClaims: EnrichedClaim[] = []

    for (let i = 0; i < claimsToProcess.length; i++) {
      const claim      = claimsToProcess[i]
      const claimNum   = targetClaimNumbers ? targetClaimNumbers[i] : i + 1
      const isIndep    = isIndependentClaim(claim)
      const parentNum  = isIndep ? undefined : getParentClaimNumber(claim)

      console.log(`[ClaimEnricher] Enriching claim ${claimNum}/${claimsToProcess.length}`)

      // ── Retrieve relevant spec chunks for this claim ──────────────────────
      const evidenceChunks = this.retrieveEvidenceChunks(claim, retriever)
      const contextText    = this.buildContextText(evidenceChunks)
      const evidenceIds    = evidenceChunks.map((c) => c.id)

      // ── LLM call ──────────────────────────────────────────────────────────
      const prompt = buildEnrichPrompt(claim, contextText, claimNum, searchInstruction)
      const systemPrompt = '당신은 특허 명세서 분석 전문가입니다. 지시한 JSON 형식으로만 응답하십시오.'

      // ── [DEBUG] 전체 프롬프트 출력 ───────────────────────────────────────
      console.log(`\n${'─'.repeat(70)}`)
      console.log(`[ClaimEnricher] 청구항 ${claimNum} — LLM 호출`)
      console.log(`\n  [시스템 프롬프트]\n${systemPrompt}\n`)
      console.log(`  [유저 프롬프트 전체]\n${prompt}`)
      console.log('─'.repeat(70))

      let rawResponse = ''
      try {
        const result = await provider.generate({
          prompt,
          systemPrompt,
          temperature: 0.1,   // low temperature for factual extraction
          maxTokens: 2_000,
        })
        rawResponse = result.content

        // ── [DEBUG] LLM 원본 응답 출력 ─────────────────────────────────────
        console.log(`\n${'─'.repeat(70)}`)
        console.log(`[ClaimEnricher] 청구항 ${claimNum} — LLM 응답 (Raw)`)
        console.log(rawResponse)
        console.log('─'.repeat(70))
      } catch (err) {
        console.error(`[ClaimEnricher] LLM 호출 실패 (청구항 ${claimNum}):`, err)
        enrichedClaims.push(minimalEnrichment(claim, claimNum, isIndep, parentNum))
        continue
      }

      // ── Parse response ────────────────────────────────────────────────────
      const enriched = parseEnrichResponse(
        rawResponse, claim, claimNum, isIndep, parentNum, evidenceIds
      )
      enrichedClaims.push(enriched)
    }

    // ── Document-level summary (from technical_field + solution) ─────────
    const techFieldSection = patentStructure.sections.find((s) => s.type === 'technical_field')
    const technicalField   = techFieldSection?.text.slice(0, 300).trim() ?? ''

    const keyTerms = [
      ...new Set(
        enrichedClaims.flatMap((ec) =>
          ec.components.flatMap((c) => [c.name, ...c.synonyms])
        ).filter((t) => t.length > 1)
      ),
    ].slice(0, 30)

    return {
      enrichedClaims,
      documentSummary: patentStructure.title,
      technicalField,
      keyTerms,
      processingMs: Date.now() - startMs,
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private retrieveEvidenceChunks(
    claim: string,
    retriever: ChunkRetriever,
  ): SemanticChunk[] {
    if (retriever.size === 0) return []

    // Multi-query: claim full text + per-section targeted queries
    const queries = [claim]
    const results = retriever.multiQueryRetrieve(queries, 8)

    // Prefer solution/description/examples sections
    const preferred = results.filter((r) =>
      (PREFERRED_SECTIONS as readonly string[]).includes(r.chunk.sectionType)
    )
    const others = results.filter((r) =>
      !(PREFERRED_SECTIONS as readonly string[]).includes(r.chunk.sectionType)
    )

    // Take up to 6 preferred + 2 others, cap at MAX_CONTEXT_CHARS
    return [...preferred, ...others]
      .slice(0, 8)
      .map((r) => r.chunk)
  }

  private buildContextText(chunks: SemanticChunk[]): string {
    let total = 0
    const parts: string[] = []

    for (const chunk of chunks) {
      if (total + chunk.text.length > MAX_CONTEXT_CHARS) break
      parts.push(`[${chunk.sectionTitle}]\n${chunk.text}`)
      total += chunk.text.length + chunk.sectionTitle.length + 4
    }

    return parts.join('\n\n---\n\n')
  }
}
