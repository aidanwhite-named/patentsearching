/**
 * SearchEngine — main orchestrator for the two-stage retrieval pipeline.
 *
 * Stage 1: CandidateRetriever  — BM25 + Vector + RRF
 * Stage 2: RerankerEngine      — LLM claim-element scoring
 *          ClaimChartGenerator — 대비표 + narrative report
 */

import { CandidateRetriever } from './CandidateRetriever'
import { RerankerEngine } from './RerankerEngine'
import { ClaimChartGenerator } from './ClaimChartGenerator'
import { parseClaim } from './ClaimParser'
import type {
  SearchQuery,
  SearchResult,
  SearchProgress,
  SearchSettings,
  SearchPhase,
  RerankScore,
} from '../../shared/searchTypes'

export type ProgressCallback = (progress: SearchProgress) => void

const DEFAULT_SETTINGS: SearchSettings = {
  patentsViewEnabled: true,
  kiprisEnabled: false,
  openAlexEnabled: true,
  openAlexApiKey: 'kSonohsFeEiEvt9kK6ga7o',
  maxCandidatesPerSource: 25,
  urlValidationEnabled: false,
  rerankerEnabled: true,
  rrfK: 60,
}

export class SearchEngine {
  private readonly settings: SearchSettings
  private abortFlag = false

  constructor(settings: Partial<SearchSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
  }

  cancel(): void {
    this.abortFlag = true
  }

  async run(query: SearchQuery, onProgress?: ProgressCallback): Promise<SearchResult> {
    this.abortFlag = false
    const startMs = Date.now()

    const emit = (phase: SearchPhase, message: string, found = 0, processed = 0, total = 0) => {
      onProgress?.({ queryId: query.id, phase, message, candidatesFound: found, candidatesProcessed: processed, totalCandidates: total })
    }

    // ── Parse claim ────────────────────────────────────────────────────────
    emit('parsing_claim', '청구항 구성요소 분석 중...')
    const parsedClaim = query.parsedClaim ?? parseClaim(query.queryText)

    // If enrichedClaim is already present (from ClaimEnricher), use it directly.
    // Otherwise fall back to rule-based parsedClaim.
    const enrichedQuery: SearchQuery = { ...query, parsedClaim }

    if (this.abortFlag) return this.emptyResult(query, startMs)

    // ── Stage 1: Candidate Retrieval ──────────────────────────────────────
    const retriever = new CandidateRetriever(this.settings)
    const candidates = await retriever.retrieve(enrichedQuery, (phase, message, found) => {
      emit(phase as SearchPhase, message, found)
    })

    if (this.abortFlag) return this.emptyResult(query, startMs)

    emit('retrieving', `Stage 1 완료: ${candidates.length}개 후보 (RRF 정렬)`, candidates.length, candidates.length, candidates.length)

    // ── Stage 2: LLM Reranking ────────────────────────────────────────────
    let reranked: RerankScore[] = candidates.map((c) => ({
      docId: c.doc.id,
      patentNumber: c.doc.patentNumber,
      elementScores: [],
      weightedScore: Math.round(c.rrfScore * 10000),
      noveltyThreat: false,
      inventivenessThreat: false,
      reasoning: '',
    }))

    if (this.settings.rerankerEnabled && candidates.length > 0) {
      // When enrichedClaim is present, log that we're using richer query basis
      const rerankerBasis = enrichedQuery.enrichedClaim
        ? `enriched (${enrichedQuery.enrichedClaim.components.length} components)`
        : 'rule-based'
      emit('reranking', `Stage 2: LLM 청구항 구성요소 대비 분석 중 [${rerankerBasis}]...`, candidates.length, 0, candidates.length)

      const reranker = new RerankerEngine()
      const top100 = candidates.slice(0, 100)
      reranked = await reranker.rerank(top100, parsedClaim, (processed, total) => {
        emit('reranking', `LLM 분석 중 (${processed}/${total})...`, candidates.length, processed, total)
        if (this.abortFlag) return
      })
    }

    if (this.abortFlag) return this.emptyResult(query, startMs)

    // ── Claim Chart Generation ────────────────────────────────────────────
    emit('generating_chart', '청구항 대비표 생성 중...')
    const chartGenerator = new ClaimChartGenerator()
    const top5 = candidates.slice(0, 5)
    const claimCharts = await chartGenerator.generate(top5, reranked, parsedClaim)

    // ── Prior Art Report ──────────────────────────────────────────────────
    const priorArtReport = await chartGenerator.generateReport(
      parsedClaim,
      claimCharts,
      parsedClaim.broadTerms,
    )

    emit('complete', '검색 완료', candidates.length, candidates.length, candidates.length)

    return {
      queryId: query.id,
      query: enrichedQuery,
      candidates,
      reranked,
      claimCharts,
      priorArtReport,
      broadTermWarnings: parsedClaim.broadTerms,
      executionMs: Date.now() - startMs,
    }
  }

  private emptyResult(query: SearchQuery, startMs: number): SearchResult {
    return {
      queryId: query.id,
      query,
      candidates: [],
      reranked: [],
      claimCharts: [],
      priorArtReport: '검색이 취소되었습니다.',
      broadTermWarnings: [],
      executionMs: Date.now() - startMs,
    }
  }
}
