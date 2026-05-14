/**
 * BM25Engine — Okapi BM25 scoring over an in-memory document corpus.
 *
 * k1 = 1.5, b = 0.75 (Robertson/Sparck Jones defaults)
 *
 * Korean text is tokenised with a syllable bigram strategy so that
 * morpheme-boundary ignorance doesn't prevent matching.  Latin tokens
 * use simple whitespace + punctuation splitting.
 */

import type { BM25Score } from '../../shared/searchTypes'

export interface BM25Doc {
  id: string
  text: string   // concatenated title + abstract + claims
}

const K1 = 1.5
const B  = 0.75

// ─── Tokeniser ─────────────────────────────────────────────────────────────

const KOREAN_RE  = /[가-힯]/       // single Hangul syllable
const STOPWORDS = new Set([
  // Korean
  '의', '을', '를', '이', '가', '은', '는', '에', '에서', '로', '으로',
  '와', '과', '도', '만', '에게', '부터', '까지', '하는', '있는', '되는',
  '하여', '하고', '되고', '있고', '위한', '따른', '관한',
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'that', 'this', 'with', 'from', 'by', 'as', 'it', 'its',
])

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const normalized = text
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words = normalized.split(' ')
  for (const word of words) {
    if (!word || STOPWORDS.has(word)) continue

    if (KOREAN_RE.test(word)) {
      // Korean bigrams: '특허청' → ['특허', '허청']
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2))
      }
      if (word.length >= 2) tokens.push(word)  // also include full word
    } else {
      if (word.length >= 2) tokens.push(word)
    }
  }
  return tokens
}

// ─── BM25 Index ────────────────────────────────────────────────────────────

export class BM25Engine {
  private readonly docs: BM25Doc[]
  private readonly tf: Map<string, Map<string, number>>  // docId → term → tf
  private readonly df: Map<string, number>               // term → doc freq
  private readonly docLengths: Map<string, number>       // docId → token count
  private readonly avgDocLen: number
  private readonly N: number

  constructor(docs: BM25Doc[]) {
    this.docs = docs
    this.N = docs.length
    this.tf = new Map()
    this.df = new Map()
    this.docLengths = new Map()

    let totalLen = 0
    for (const doc of docs) {
      const tokens = tokenize(doc.text)
      this.docLengths.set(doc.id, tokens.length)
      totalLen += tokens.length

      const freqMap = new Map<string, number>()
      for (const t of tokens) {
        freqMap.set(t, (freqMap.get(t) ?? 0) + 1)
      }
      this.tf.set(doc.id, freqMap)

      for (const t of freqMap.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1)
      }
    }

    this.avgDocLen = this.N > 0 ? totalLen / this.N : 1
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0
    return Math.log((this.N - df + 0.5) / (df + 0.5) + 1)
  }

  score(queryText: string): BM25Score[] {
    const qTerms = tokenize(queryText)
    if (qTerms.length === 0) return []

    const scores: BM25Score[] = []

    for (const doc of this.docs) {
      const dl = this.docLengths.get(doc.id) ?? 1
      const freqMap = this.tf.get(doc.id) ?? new Map()
      let docScore = 0

      for (const term of qTerms) {
        const f = freqMap.get(term) ?? 0
        if (f === 0) continue
        const idf = this.idf(term)
        const numerator = f * (K1 + 1)
        const denominator = f + K1 * (1 - B + B * (dl / this.avgDocLen))
        docScore += idf * (numerator / denominator)
      }

      scores.push({ docId: doc.id, score: docScore, rank: 0 })
    }

    // assign ranks (1-based, descending score)
    scores.sort((a, b) => b.score - a.score)
    scores.forEach((s, i) => { s.rank = i + 1 })

    return scores
  }
}
