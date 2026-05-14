/**
 * VectorEngine — TF-IDF cosine similarity for semantic matching.
 *
 * Uses the same tokenizer as BM25Engine.  Builds a TF-IDF vector for each
 * document and the query, then computes cosine similarity.
 *
 * This is a practical approximation of embedding-based vector search that
 * runs entirely in the main process without any external embedding API calls.
 */

import { tokenize } from './BM25Engine'
import type { VectorScore } from '../../shared/searchTypes'

export interface VectorDoc {
  id: string
  text: string
}

export class VectorEngine {
  private readonly docs: VectorDoc[]
  private readonly N: number
  private readonly df: Map<string, number>
  private readonly vocabulary: string[]
  private readonly docVectors: Map<string, Float64Array>

  constructor(docs: VectorDoc[]) {
    this.docs = docs
    this.N = docs.length
    this.df = new Map()
    this.docVectors = new Map()

    // Build document frequency
    for (const doc of docs) {
      const terms = new Set(tokenize(doc.text))
      for (const t of terms) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1)
      }
    }

    this.vocabulary = Array.from(this.df.keys())

    // Build TF-IDF vectors for each document
    for (const doc of docs) {
      this.docVectors.set(doc.id, this.buildVector(tokenize(doc.text)))
    }
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0
    if (df === 0) return 0
    return Math.log((this.N + 1) / (df + 1)) + 1  // smooth IDF
  }

  private buildVector(tokens: string[]): Float64Array {
    const tf = new Map<string, number>()
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1)
    }
    const maxTf = Math.max(1, ...tf.values())

    const vec = new Float64Array(this.vocabulary.length)
    for (let i = 0; i < this.vocabulary.length; i++) {
      const term = this.vocabulary[i]
      const termTf = tf.get(term) ?? 0
      if (termTf > 0) {
        vec[i] = (termTf / maxTf) * this.idf(term)
      }
    }
    return vec
  }

  private cosineSimilarity(a: Float64Array, b: Float64Array): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  score(queryText: string): VectorScore[] {
    const qTokens = tokenize(queryText)
    if (qTokens.length === 0) return []

    const qVec = this.buildVector(qTokens)
    const scores: VectorScore[] = []

    for (const doc of this.docs) {
      const docVec = this.docVectors.get(doc.id)!
      const sim = this.cosineSimilarity(qVec, docVec)
      scores.push({ docId: doc.id, similarity: sim, rank: 0 })
    }

    scores.sort((a, b) => b.similarity - a.similarity)
    scores.forEach((s, i) => { s.rank = i + 1 })

    return scores
  }
}
