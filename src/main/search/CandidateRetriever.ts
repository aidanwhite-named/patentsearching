/**
 * CandidateRetriever — Stage 1 of the two-stage retrieval pipeline.
 *
 * 어댑터 추가는 AdapterRegistry.ts에서만 수행한다.
 * 이 파일은 파이프라인 오케스트레이션만 담당한다.
 *
 * 처리 순서:
 *  1. AdapterRegistry에서 활성 어댑터 목록 생성
 *  2. 순차 실행 (429/503 봇 감지 방지)
 *  3. 중복 제거 (patentNumber 기준)
 *  4. 날짜 컷오프 필터
 *  5. BM25 + TF-IDF 하이브리드 스코어링
 *  6. RRF 퓨전 → 정렬된 HybridSearchResult[]
 *  7. URL 유효성 검증 (선택)
 *
 * Claim-aware retrieval (enrichedClaim 있을 때):
 *  - enrichedClaim.searchQueries 기반 multi-query BM25 → RRF
 *  - 없으면 raw queryText fallback
 */

import { BM25Engine, type BM25Doc } from './BM25Engine'
import { VectorEngine, type VectorDoc } from './VectorEngine'
import { mergeRRF } from './RRFMerger'
import { URLValidator } from './URLValidator'
import { getEnabledAdapters } from './adapters/AdapterRegistry'
import type {
  CandidateDoc,
  HybridSearchResult,
  SearchQuery,
  SearchSettings,
} from '../../shared/searchTypes'
import type { EnrichedClaim } from '../../shared/patentTypes'

export type ProgressCallback = (phase: string, message: string, found: number) => void

export class CandidateRetriever {
  private readonly settings: SearchSettings
  private readonly validator: URLValidator

  constructor(settings: SearchSettings) {
    this.settings  = settings
    this.validator = new URLValidator(settings.urlValidationEnabled)
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async retrieve(
    query: SearchQuery,
    onProgress?: ProgressCallback,
  ): Promise<HybridSearchResult[]> {
    onProgress?.('retrieving', '소스 어댑터에서 후보 문헌 수집 중...', 0)

    // ── 1. Parallel adapter queries (실제론 순차 실행) ─────────────────────
    const expandedQuery = this.expandQuery(query)
    const rawDocs = await this.fetchFromAdapters(expandedQuery, onProgress)

    onProgress?.('retrieving', `${rawDocs.length}개 후보 수집 완료. 중복 제거 중...`, rawDocs.length)

    // ── 2. Deduplication ─────────────────────────────────────────────────
    const unique = dedup(rawDocs)

    // ── 3. Date filter ───────────────────────────────────────────────────
    const filtered = filterByDate(unique, query.cutoffDate)

    if (filtered.length === 0) return []

    onProgress?.('retrieving', `${filtered.length}개 중복 제거 후 BM25/벡터 스코어링 중...`, filtered.length)

    // ── 4. Hybrid scoring ─────────────────────────────────────────────────
    const corpus = filtered.map((d): BM25Doc & VectorDoc => ({
      id: d.id,
      text: buildDocText(d),
    }))

    const bm25Engine   = new BM25Engine(corpus)
    const vectorEngine = new VectorEngine(corpus)

    let bm25Scores:   ReturnType<typeof bm25Engine.score>
    let vectorScores: ReturnType<typeof vectorEngine.score>

    if (query.enrichedClaim) {
      bm25Scores   = this.multiQueryBM25(bm25Engine, query.enrichedClaim)
      vectorScores = vectorEngine.score(this.buildVectorQuery(query.enrichedClaim))
    } else {
      const queryText =
        query.queryText +
        ' ' +
        (query.parsedClaim?.elements.map((e) => e.text).join(' ') ?? '')
      bm25Scores   = bm25Engine.score(queryText)
      vectorScores = vectorEngine.score(queryText)
    }

    // ── 5. RRF fusion ─────────────────────────────────────────────────────
    const k      = this.settings.rrfK ?? 60
    const merged = mergeRRF(filtered, bm25Scores, vectorScores, k)

    // ── 6. URL validation ─────────────────────────────────────────────────
    if (this.settings.urlValidationEnabled) {
      onProgress?.('validating_urls', 'URL 유효성 검증 중...', merged.length)
      await this.validateURLs(merged)
    }

    return merged
  }

  // ─── Enriched-claim scoring ───────────────────────────────────────────────

  private expandQuery(query: SearchQuery): SearchQuery {
    if (!query.enrichedClaim) return query
    const ec = query.enrichedClaim
    const extra = [
      ...ec.searchQueries.slice(0, 3),
      ...ec.components.map((c) => c.name),
    ].join(' ')
    return { ...query, queryText: `${query.queryText} ${extra}`.trim() }
  }

  private multiQueryBM25(
    engine: BM25Engine,
    ec: EnrichedClaim,
  ): ReturnType<typeof engine.score> {
    const queries: string[] = [
      ...ec.searchQueries,
      ...ec.components.map((c) =>
        [c.name, ...c.technicalConcepts, ...c.synonyms].join(' ')
      ),
    ].filter((q) => q.trim().length > 0)

    if (queries.length === 0) return engine.score(ec.originalClaim)

    const K = 60
    const rrfAccum = new Map<string, number>()

    for (const q of queries) {
      const scores = engine.score(q)
      scores.forEach((s, rank) => {
        const prev = rrfAccum.get(s.docId) ?? 0
        rrfAccum.set(s.docId, prev + 1 / (K + rank + 1))
      })
    }

    return [...rrfAccum.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([docId, score], rank) => ({ docId, score, rank: rank + 1 }))
  }

  private buildVectorQuery(ec: EnrichedClaim): string {
    return [
      ec.overallPurpose,
      ...ec.components.flatMap((c) => [
        ...c.technicalConcepts,
        ...c.functionalRoles,
        ...c.synonyms,
      ]),
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1_000)
  }

  // ─── Adapter dispatch (AdapterRegistry 사용) ─────────────────────────────

  private async fetchFromAdapters(
    query: SearchQuery,
    onProgress?: ProgressCallback,
  ): Promise<CandidateDoc[]> {
    // 활성화된 어댑터 목록 (settings + query.sources 교집합)
    const enabledSources = query.sources.filter((s) => {
      switch (s) {
        case 'patentsview': return this.settings.patentsViewEnabled
        case 'kipris':      return this.settings.kiprisEnabled
        case 'openalex':    return this.settings.openAlexEnabled
        default:            return false
      }
    })

    const adapters = getEnabledAdapters(enabledSources, this.settings)

    // 순차 실행: 어댑터 간 800ms 간격 (동시 요청 부하 감소)
    const allDocs: CandidateDoc[] = []
    for (let i = 0; i < adapters.length; i++) {
      if (i > 0) await sleep(800)
      const { source, adapter } = adapters[i]
      try {
        const docs = await adapter.search(query)
        allDocs.push(...docs)
        onProgress?.('retrieving', `${source} 수집 완료 (${allDocs.length}건)`, allDocs.length)
      } catch (err) {
        console.warn(`[CandidateRetriever] ${source} 오류:`, (err as Error).message)
      }
    }

    return allDocs
  }

  // ─── URL validation ───────────────────────────────────────────────────────

  private async validateURLs(results: HybridSearchResult[]): Promise<void> {
    const urls     = results.map((r) => r.doc.url)
    const validMap = await this.validator.validateBatch(urls)
    for (const r of results) {
      r.doc.urlValid = validMap.get(r.doc.url) ?? false
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildDocText(doc: CandidateDoc): string {
  return [doc.title, doc.abstract, doc.claims ?? ''].filter(Boolean).join(' ')
}

function dedup(docs: CandidateDoc[]): CandidateDoc[] {
  const seen = new Set<string>()
  return docs.filter((d) => {
    const key = d.patentNumber.toUpperCase().replace(/\s+/g, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function filterByDate(docs: CandidateDoc[], cutoffDate?: string): CandidateDoc[] {
  if (!cutoffDate) return docs
  const cutoff = new Date(cutoffDate)
  return docs.filter((d) => {
    const dateStr = d.publicationDate ?? d.filingDate
    if (!dateStr) return true
    try { return new Date(dateStr) <= cutoff } catch { return true }
  })
}
