/**
 * ClaimChartGenerator — 청구항 대비표 (Claim Chart) 생성.
 *
 * For each top-ranked candidate, produces a structured claim chart showing
 * element-by-element comparison with prior art text.
 * Also generates the prior-art narrative report using the LLM.
 */

import { ProviderFactory } from '../llm/providers/ProviderFactory'
import { getSettings } from '../ipc/settingsHandlers'
import type { GenerateParams } from '../../shared/types'
import type {
  ParsedClaim,
  HybridSearchResult,
  RerankScore,
  ClaimChart,
  ClaimChartRow,
  Verdict,
} from '../../shared/searchTypes'

const MAX_CHARTS = 5     // top N candidates get full claim charts
const MAX_DOC_CHARS = 2_500

export class ClaimChartGenerator {
  async generate(
    topCandidates: HybridSearchResult[],
    reranked: RerankScore[],
    claim: ParsedClaim,
  ): Promise<ClaimChart[]> {
    const charts: ClaimChart[] = []
    const rerankedMap = new Map(reranked.map((r) => [r.docId, r]))

    const targets = topCandidates.slice(0, MAX_CHARTS)

    for (const candidate of targets) {
      const rerankScore = rerankedMap.get(candidate.doc.id)
      const chart = await this.buildChart(candidate, rerankScore, claim)
      charts.push(chart)
    }

    return charts
  }

  // ─── Single chart ──────────────────────────────────────────────────────

  private async buildChart(
    candidate: HybridSearchResult,
    reranked: RerankScore | undefined,
    claim: ParsedClaim,
  ): Promise<ClaimChart> {
    // Build rows from rerank element scores (fast path if available)
    if (reranked && reranked.elementScores.length === claim.elements.length) {
      return this.fromRerankScore(candidate, reranked, claim)
    }

    // Slow path: ask LLM specifically for this document
    return this.fromLLM(candidate, claim)
  }

  private fromRerankScore(
    candidate: HybridSearchResult,
    reranked: RerankScore,
    claim: ParsedClaim,
  ): ClaimChart {
    const rows: ClaimChartRow[] = claim.elements.map((el) => {
      const es = reranked.elementScores.find((e) => e.elementId === el.id)
      const sim = (es?.score ?? 0) / 100
      return {
        element: el,
        priorArtText: es?.evidence ?? '',
        similarity: sim,
        verdict: scoreToVerdict(sim),
        reasoning: reranked.reasoning,
      }
    })

    const overallSimilarity = computeOverallSimilarity(rows)

    return {
      patentNumber: candidate.doc.patentNumber,
      title: candidate.doc.title,
      url: candidate.doc.url,
      claimElements: claim.elements,
      rows,
      overallSimilarity,
      noveltyRisk: riskLevel(overallSimilarity, 0.75, 0.5),
      inventivenessRisk: riskLevel(overallSimilarity, 0.55, 0.35),
      summary: reranked.reasoning,
    }
  }

  private async fromLLM(
    candidate: HybridSearchResult,
    claim: ParsedClaim,
  ): Promise<ClaimChart> {
    const doc = candidate.doc
    const docText = [doc.title, doc.abstract, doc.claims ?? '']
      .join('\n')
      .slice(0, MAX_DOC_CHARS)

    const elementsText = claim.elements
      .map((e) => `[${e.id}] ${e.text}`)
      .join('\n')

    const prompt = `# 청구항 구성요소
${elementsText}

# 선행기술 문헌
특허번호: ${doc.patentNumber}
제목: ${doc.title}
내용:
${docText}

위 청구항의 각 구성요소([A], [B], [C] 등)가 이 선행기술 문헌에 개시되어 있는지 분석하라.`

    try {
      const provider = await ProviderFactory.getInstance().create(getSettings())
      const params: GenerateParams = {
        prompt,
        systemPrompt: CHART_SYSTEM_PROMPT,
        temperature: 0.1,
        maxTokens: 3000,
      }
      const result = await provider.generate(params)
      return this.parseLLMChart(result.content, candidate, claim)
    } catch {
      return this.emptyChart(candidate, claim)
    }
  }

  // ─── LLM chart response parsing ────────────────────────────────────────

  private parseLLMChart(
    content: string,
    candidate: HybridSearchResult,
    claim: ParsedClaim,
  ): ClaimChart {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ??
                      content.match(/(\{[\s\S]*\})/)

    if (!jsonMatch) return this.emptyChart(candidate, claim)

    try {
      const parsed: LLMChartResponse = JSON.parse(jsonMatch[1])
      const doc = candidate.doc

      const rows: ClaimChartRow[] = claim.elements.map((el) => {
        const row = parsed.rows?.find((r: LLMChartRow) => r.elementId === el.id)
        const sim = ((row?.similarity ?? 0) / 100)
        return {
          element: el,
          priorArtText: row?.priorArtText ?? '',
          similarity: sim,
          verdict: (row?.verdict as Verdict) ?? scoreToVerdict(sim),
          reasoning: row?.reasoning ?? '',
        }
      })

      const overallSimilarity = computeOverallSimilarity(rows)

      return {
        patentNumber: doc.patentNumber,
        title: doc.title,
        url: doc.url,
        claimElements: claim.elements,
        rows,
        overallSimilarity,
        noveltyRisk: riskLevel(overallSimilarity, 0.75, 0.5),
        inventivenessRisk: riskLevel(overallSimilarity, 0.55, 0.35),
        summary: parsed.summary ?? '',
      }
    } catch {
      return this.emptyChart(candidate, claim)
    }
  }

  private emptyChart(candidate: HybridSearchResult, claim: ParsedClaim): ClaimChart {
    const rows: ClaimChartRow[] = claim.elements.map((el) => ({
      element: el,
      priorArtText: '',
      similarity: 0,
      verdict: 'NOT_COVERED' as Verdict,
      reasoning: '(분석 실패)',
    }))
    return {
      patentNumber: candidate.doc.patentNumber,
      title: candidate.doc.title,
      url: candidate.doc.url,
      claimElements: claim.elements,
      rows,
      overallSimilarity: 0,
      noveltyRisk: 'LOW',
      inventivenessRisk: 'LOW',
      summary: '',
    }
  }

  // ─── Prior art narrative report ────────────────────────────────────────

  async generateReport(
    claim: ParsedClaim,
    charts: ClaimChart[],
    broadTermWarnings: string[],
  ): Promise<string> {
    if (charts.length === 0) {
      return '선행기술 후보 문헌이 없어 보고서를 생성할 수 없습니다.'
    }

    const chartsText = charts
      .map((c, i) => {
        const rows = c.rows
          .map((r) => `  [${r.element.id}] 유사도 ${Math.round(r.similarity * 100)}% — ${r.verdict}: ${r.priorArtText.slice(0, 200)}`)
          .join('\n')
        return `## ${i + 1}. ${c.title} (${c.patentNumber})\n${rows}\n종합 위험도: 신규성 ${c.noveltyRisk} / 진보성 ${c.inventivenessRisk}`
      })
      .join('\n\n')

    const broadWarningsText = broadTermWarnings.length > 0
      ? `\n\n## 광범위/중의적 표현 경고\n${broadTermWarnings.map((w) => `- ${w}`).join('\n')}`
      : ''

    const prompt = `# 청구항
${claim.raw}

# 대비표 분석 결과
${chartsText}${broadWarningsText}

위 분석을 바탕으로 선행기술 조사 보고서를 작성하라.`

    try {
      const provider = await ProviderFactory.getInstance().create(getSettings())
      const params: GenerateParams = {
        prompt,
        systemPrompt: REPORT_SYSTEM_PROMPT,
        temperature: 0.3,
        maxTokens: 3000,
      }
      const result = await provider.generate(params)
      return result.content
    } catch (err) {
      return `(보고서 생성 실패: ${(err as Error).message})`
    }
  }
}

// ─── LLM response types ───────────────────────────────────────────────────

interface LLMChartRow {
  elementId: string
  priorArtText: string
  similarity: number
  verdict: string
  reasoning: string
}

interface LLMChartResponse {
  rows?: LLMChartRow[]
  summary?: string
}

// ─── System prompts ────────────────────────────────────────────────────────

const CHART_SYSTEM_PROMPT = `당신은 특허 선행기술 대비표 작성 전문가입니다.

출력 형식 (반드시 JSON):
\`\`\`json
{
  "rows": [
    {
      "elementId": "<구성요소 ID>",
      "priorArtText": "<선행기술 문헌에서 해당 요소에 대응하는 원문 인용>",
      "similarity": <0-100>,
      "verdict": "<COVERED|PARTIAL|NOT_COVERED>",
      "reasoning": "<판단 근거>"
    }
  ],
  "summary": "<전체 신규성/진보성 판단 요약>"
}
\`\`\`

규칙:
- COVERED: 구성요소가 선행기술에 실질적으로 개시됨 (신규성 부정)
- PARTIAL: 일부만 개시되거나 균등 범위에 해당
- NOT_COVERED: 해당 구성요소가 선행기술에 없음
- priorArtText는 반드시 제공된 선행기술 원문의 실제 텍스트여야 함`

const REPORT_SYSTEM_PROMPT = `당신은 특허법 전문 변리사입니다.

선행기술 조사 보고서를 작성하라. 다음 항목을 포함하라:

1. **조사 개요** — 조사 대상 청구항 및 기술분야 요약
2. **광범위/중의적 표현 검토** — 발견된 불명확 표현과 그 위험성
3. **선행기술 대비 분석** — 각 상위 선행기술별 신규성/진보성 부정 여부
4. **신규성 판단** (특허법 제29조 제1항) — 단일 선행기술 대비 신규성 부정 가능성
5. **진보성 판단** (특허법 제29조 제2항) — 결합 용이성 및 효과의 자명성 분석
6. **결론 및 권고사항** — 청구항 보정 또는 출원 전략 제안

중요: 확인된 사실(선행기술 원문)만 근거로 서술하고, 추측은 명확히 구분하라.`

// ─── Helpers ──────────────────────────────────────────────────────────────

function scoreToVerdict(sim: number): Verdict {
  if (sim >= 0.75) return 'COVERED'
  if (sim >= 0.4) return 'PARTIAL'
  return 'NOT_COVERED'
}

function computeOverallSimilarity(rows: ClaimChartRow[]): number {
  if (rows.length === 0) return 0
  const totalWeight = rows.reduce((s, r) => s + r.element.importance, 0)
  const weightedSum = rows.reduce((s, r) => s + r.similarity * r.element.importance, 0)
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

function riskLevel(
  sim: number,
  highThreshold: number,
  medThreshold: number,
): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (sim >= highThreshold) return 'HIGH'
  if (sim >= medThreshold) return 'MEDIUM'
  return 'LOW'
}
