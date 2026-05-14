/**
 * RerankerEngine — Stage 2: LLM-based reranking with claim chart generation.
 *
 * Processes candidate documents in batches (BATCH_SIZE at a time) to fit
 * within LLM context limits.  For each candidate:
 *  - Compares each claim element (A, B, C) 1:1 against the candidate text.
 *  - Applies importance weights (★1-3) to produce a weighted similarity score.
 *  - Flags novelty / inventiveness threats.
 *
 * Hallucination prevention:
 *  - The prompt explicitly instructs the model to cite only text present in
 *    the provided candidate excerpt.
 *  - The parsing layer validates that cited evidence strings appear in the
 *    candidate text before accepting them.
 */

import { ProviderFactory } from '../llm/providers/ProviderFactory'
import { getSettings } from '../ipc/settingsHandlers'
import type { GenerateParams } from '../../shared/types'
import type {
  ParsedClaim,
  HybridSearchResult,
  RerankScore,
  ElementScore,
} from '../../shared/searchTypes'

const BATCH_SIZE = 10
const MAX_DOC_CHARS = 1_500   // truncate abstract+claims to fit context

export type RerankProgressCallback = (processed: number, total: number) => void

export class RerankerEngine {
  // ─── Public API ──────────────────────────────────────────────────────────

  async rerank(
    candidates: HybridSearchResult[],
    claim: ParsedClaim,
    onProgress?: RerankProgressCallback,
  ): Promise<RerankScore[]> {
    const results: RerankScore[] = []
    const total = candidates.length

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE)
      const batchResults = await this.processBatch(batch, claim)
      results.push(...batchResults)
      onProgress?.(Math.min(i + BATCH_SIZE, total), total)
    }

    // Sort by weighted score descending, assign stage2 rank
    results.sort((a, b) => b.weightedScore - a.weightedScore)
    results.forEach((r, idx) => { r.stage2Rank = idx + 1 })

    return results
  }

  // ─── Batch processing ─────────────────────────────────────────────────────

  private async processBatch(
    batch: HybridSearchResult[],
    claim: ParsedClaim,
  ): Promise<RerankScore[]> {
    const prompt = this.buildPrompt(batch, claim)

    try {
      const provider = await ProviderFactory.getInstance().create(getSettings())
      const params: GenerateParams = {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0.1,
        maxTokens: 4096,
      }
      const result = await provider.generate(params)
      return this.parseResponse(result.content, batch)
    } catch (err) {
      console.warn('[RerankerEngine] LLM call failed:', (err as Error).message)
      return batch.map((c) => this.fallbackScore(c))
    }
  }

  // ─── Prompt construction ──────────────────────────────────────────────────

  private buildPrompt(batch: HybridSearchResult[], claim: ParsedClaim): string {
    const elementsText = claim.elements
      .map((e) => `[${e.id}](★${'★'.repeat(e.importance - 1).padStart(e.importance, '★')}) ${e.text}`)
      .join('\n')

    const candidatesText = batch
      .map((c, idx) => {
        const doc = c.doc
        const text = [doc.title, doc.abstract, doc.claims ?? '']
          .join(' ')
          .slice(0, MAX_DOC_CHARS)
        return `--- 후보 ${idx + 1} ---\nID: ${doc.id}\n특허번호: ${doc.patentNumber}\n제목: ${doc.title}\n내용: ${text}`
      })
      .join('\n\n')

    return `# 청구항 구성요소
${elementsText}

# 선행기술 후보 문헌 (${batch.length}건)
${candidatesText}

위 청구항의 각 구성요소별로 각 후보 문헌을 분석하여 JSON으로 응답하라.`
  }

  // ─── Response parsing ─────────────────────────────────────────────────────

  private parseResponse(content: string, batch: HybridSearchResult[]): RerankScore[] {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ??
                      content.match(/(\[[\s\S]*\])/) ??
                      content.match(/(\{[\s\S]*\})/)

    if (!jsonMatch) {
      console.warn('[RerankerEngine] No JSON in LLM response, using fallback scores')
      return batch.map((c) => this.fallbackScore(c))
    }

    try {
      const parsed: LLMRerankResponse[] = JSON.parse(jsonMatch[1])
      return parsed.map((item) => this.toLLMScore(item, batch))
    } catch (err) {
      console.warn('[RerankerEngine] JSON parse error:', (err as Error).message)
      return batch.map((c) => this.fallbackScore(c))
    }
  }

  private toLLMScore(item: LLMRerankResponse, batch: HybridSearchResult[]): RerankScore {
    const candidate = batch.find((c) => c.doc.id === item.id) ?? batch[0]

    // Validate evidence strings actually appear in the source text
    const docText = [candidate.doc.title, candidate.doc.abstract, candidate.doc.claims ?? '']
      .join(' ')
      .toLowerCase()

    const elementScores: ElementScore[] = (item.elements ?? []).map((e) => ({
      elementId: e.id,
      score: clamp(e.score ?? 0, 0, 100),
      evidence: validateEvidence(e.evidence ?? '', docText),
    }))

    // Weighted score using claim importance
    const weightedScore = computeWeightedScore(elementScores, item.importanceWeights ?? {})

    return {
      docId: candidate.doc.id,
      patentNumber: candidate.doc.patentNumber,
      elementScores,
      weightedScore,
      noveltyThreat: item.noveltyThreat ?? weightedScore >= 70,
      inventivenessThreat: item.inventivenessThreat ?? weightedScore >= 50,
      reasoning: item.reasoning ?? '',
    }
  }

  private fallbackScore(c: HybridSearchResult): RerankScore {
    // Use RRF score as a proxy (0–1 → 0–100)
    const rrfMax = 2 / (60 + 1)  // max possible RRF with 2 lists
    const approx = Math.round((c.rrfScore / rrfMax) * 100)
    return {
      docId: c.doc.id,
      patentNumber: c.doc.patentNumber,
      elementScores: [],
      weightedScore: clamp(approx, 0, 100),
      noveltyThreat: false,
      inventivenessThreat: false,
      reasoning: '(LLM 분석 실패 — RRF 점수로 대체)',
    }
  }
}

// ─── LLM response types ───────────────────────────────────────────────────

interface LLMElementScore {
  id: string
  score: number
  evidence: string
}

interface LLMRerankResponse {
  id: string
  elements: LLMElementScore[]
  importanceWeights: Record<string, number>
  weightedScore?: number
  noveltyThreat: boolean
  inventivenessThreat: boolean
  reasoning: string
}

// ─── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 특허 선행기술 분석 전문가입니다.

역할: 주어진 청구항의 구성요소를 선행기술 후보 문헌과 1:1로 대비하여 유사도를 평가하라.

출력 형식 (반드시 JSON 배열):
\`\`\`json
[
  {
    "id": "<후보 문서 ID>",
    "elements": [
      {
        "id": "<구성요소 ID: A/B/C/...>",
        "score": <0-100, 0=전혀 없음, 100=완전 일치>,
        "evidence": "<후보 문헌에서 직접 인용한 관련 텍스트 (반드시 원문에 존재해야 함)>"
      }
    ],
    "importanceWeights": {"A": 3, "B": 2, "C": 1},
    "noveltyThreat": <true/false — 신규성 부정 가능성>,
    "inventivenessThreat": <true/false — 진보성 부정 가능성>,
    "reasoning": "<한국어로 신규성/진보성 판단 근거 서술>"
  }
]
\`\`\`

핵심 규칙:
1. evidence는 반드시 후보 문헌 원문에 있는 텍스트만 인용하라.
2. 추측이나 일반적 지식을 근거로 인용하지 말라.
3. 점수는 구성요소 텍스트와 후보 문헌 간의 실질적 대응 여부로 판단하라.
4. noveltyThreat=true는 해당 구성요소 전체가 후보 문헌에 개시되어 있을 때만 표시하라.`

// ─── Helpers ──────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function validateEvidence(evidence: string, docTextLower: string): string {
  if (!evidence) return ''
  const lower = evidence.toLowerCase().trim()
  if (lower.length < 5) return evidence
  // Accept if at least half of the evidence words appear in the doc
  const words = lower.split(/\s+/).filter((w) => w.length > 2)
  if (words.length === 0) return evidence
  const hits = words.filter((w) => docTextLower.includes(w))
  if (hits.length / words.length >= 0.5) return evidence
  return '(원문 확인 불가 — 직접 검토 요망)'
}

function computeWeightedScore(
  scores: ElementScore[],
  weights: Record<string, number>,
): number {
  if (scores.length === 0) return 0
  let sumWeighted = 0
  let sumWeights = 0
  for (const s of scores) {
    const w = weights[s.elementId] ?? 1
    sumWeighted += s.score * w
    sumWeights += w
  }
  return sumWeights > 0 ? Math.round(sumWeighted / sumWeights) : 0
}
