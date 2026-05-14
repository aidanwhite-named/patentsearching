/**
 * RRFMerger — Reciprocal Rank Fusion.
 *
 * RRF(d) = Σ_r  1 / (k + rank_r(d))
 *
 * Standard k = 60 (Cormack et al., 2009).  Documents not present in a
 * ranking list are penalised with rank = N + 1 (tail penalty).
 */

import type { BM25Score, VectorScore, RRFScore, HybridSearchResult, CandidateDoc } from '../../shared/searchTypes'

const DEFAULT_K = 60

export function mergeRRF(
  docs: CandidateDoc[],
  bm25Scores: BM25Score[],
  vectorScores: VectorScore[],
  k: number = DEFAULT_K,
): HybridSearchResult[] {
  const N = docs.length

  // Build lookup maps
  const bm25Rank = new Map<string, number>()
  const bm25ScoreMap = new Map<string, number>()
  for (const s of bm25Scores) {
    bm25Rank.set(s.docId, s.rank)
    bm25ScoreMap.set(s.docId, s.score)
  }

  const vectorRank = new Map<string, number>()
  const vectorScoreMap = new Map<string, number>()
  for (const s of vectorScores) {
    vectorRank.set(s.docId, s.rank)
    vectorScoreMap.set(s.docId, s.similarity)
  }

  const rrfScores: RRFScore[] = docs.map((doc) => {
    const r1 = bm25Rank.get(doc.id) ?? N + 1
    const r2 = vectorRank.get(doc.id) ?? N + 1
    const rrf = 1 / (k + r1) + 1 / (k + r2)
    return {
      docId: doc.id,
      rrfScore: rrf,
      bm25Rank: r1,
      vectorRank: r2,
      finalRank: 0,
    }
  })

  rrfScores.sort((a, b) => b.rrfScore - a.rrfScore)
  rrfScores.forEach((s, i) => { s.finalRank = i + 1 })

  // Build final result list preserving doc reference
  const docMap = new Map(docs.map((d) => [d.id, d]))

  return rrfScores.map((s) => ({
    doc: docMap.get(s.docId)!,
    bm25Score: bm25ScoreMap.get(s.docId) ?? 0,
    vectorScore: vectorScoreMap.get(s.docId) ?? 0,
    rrfScore: s.rrfScore,
    rank: s.finalRank,
  }))
}
