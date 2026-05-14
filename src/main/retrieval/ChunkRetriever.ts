/**
 * ChunkRetriever — BM25-based retrieval over a SemanticChunk corpus.
 *
 * Used by ClaimEnricher to find the most relevant description sections
 * for each claim component before sending to the LLM.
 *
 * Reuses the existing BM25Engine (same scoring as the external patent retriever)
 * so there is a single, consistent scoring implementation.
 */

import { BM25Engine, type BM25Doc } from '../search/BM25Engine'
import type { SemanticChunk, PatentSectionType } from '../../shared/patentTypes'

export interface ChunkScore {
  chunk: SemanticChunk
  score: number
  rank: number
}

export class ChunkRetriever {
  private readonly bm25: BM25Engine
  private readonly chunkMap: Map<string, SemanticChunk>

  constructor(private readonly chunks: SemanticChunk[]) {
    const docs: BM25Doc[] = chunks.map((c) => ({ id: c.id, text: c.text }))
    this.bm25     = new BM25Engine(docs)
    this.chunkMap = new Map(chunks.map((c) => [c.id, c]))
  }

  // ─── Query methods ────────────────────────────────────────────────────────

  /**
   * Retrieve the top-K most relevant chunks for a query string.
   */
  retrieve(query: string, topK = 5): ChunkScore[] {
    const scores = this.bm25.score(query)
    return scores
      .slice(0, topK)
      .map((s, i) => {
        const chunk = this.chunkMap.get(s.docId)
        if (!chunk) return null
        return { chunk, score: s.score, rank: i + 1 }
      })
      .filter((x): x is ChunkScore => x !== null)
  }

  /**
   * Retrieve top-K chunks filtered to specific section types.
   * Useful when you want description or effects chunks only.
   */
  retrieveFromSections(
    query: string,
    sectionTypes: PatentSectionType[],
    topK = 5,
  ): ChunkScore[] {
    const allowed = new Set(sectionTypes)
    const filtered = this.chunks.filter((c) => allowed.has(c.sectionType))
    if (filtered.length === 0) return []

    const docs: BM25Doc[] = filtered.map((c) => ({ id: c.id, text: c.text }))
    const engine = new BM25Engine(docs)
    const scores = engine.score(query)

    return scores
      .slice(0, topK)
      .map((s, i) => {
        const chunk = this.chunkMap.get(s.docId)
        if (!chunk) return null
        return { chunk, score: s.score, rank: i + 1 }
      })
      .filter((x): x is ChunkScore => x !== null)
  }

  /**
   * Retrieve ALL chunks of a given section type (ordered by position).
   * Used to fetch the full effects or technical_problem section.
   */
  getSection(sectionType: PatentSectionType): SemanticChunk[] {
    return this.chunks
      .filter((c) => c.sectionType === sectionType)
      .sort((a, b) => a.charStart - b.charStart)
  }

  /**
   * Multi-query retrieval: run one query per component term and merge by RRF.
   * Returns deduplicated chunks ranked by combined relevance.
   */
  multiQueryRetrieve(queries: string[], topK = 8): ChunkScore[] {
    if (queries.length === 0) return []

    // Collect scores per doc from all queries
    const scoreAccum = new Map<string, number>()
    const K = 60  // RRF constant

    for (const q of queries) {
      const results = this.retrieve(q, Math.min(topK * 2, 20))
      results.forEach((r, i) => {
        const prev = scoreAccum.get(r.chunk.id) ?? 0
        scoreAccum.set(r.chunk.id, prev + 1 / (K + i + 1))
      })
    }

    // Sort by combined score
    const sorted = [...scoreAccum.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, topK)

    return sorted.map(([id, score], i) => {
      const chunk = this.chunkMap.get(id)!
      return { chunk, score, rank: i + 1 }
    })
  }

  get size(): number { return this.chunks.length }
}
