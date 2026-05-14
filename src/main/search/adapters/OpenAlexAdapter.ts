/**
 * OpenAlexAdapter — OpenAlex 학술논문 검색 어댑터.
 *
 * Endpoint: https://api.openalex.org/works
 * API Key:  api_key 쿼리 파라미터로 전달 (기관 인증)
 * 무료 공개 DB: 250M+ 학술 문헌, 특허 인용 포함
 *
 * 주요 특이사항:
 * [1] abstract_inverted_index — OpenAlex는 초록을 역색인 형태로 제공한다.
 *     { "word": [pos1, pos2, …], … } → 위치 배열로 텍스트 재구성
 * [2] 한국어 쿼리 정제 — 영어 기술 용어만 추출하여 검색 품질 향상
 * [3] 10분 TTL 모듈 캐시 — 동일 쿼리 반복 요청 방지
 */

import { BaseAdapter, type AdapterOptions } from './BaseAdapter'
import type { CandidateDoc, SearchQuery } from '../../../shared/searchTypes'

const BASE_URL = 'https://api.openalex.org/works'

// ─── 역색인 → 평문 변환 ──────────────────────────────────────────────────────
// [1] OpenAlex abstract_inverted_index: { word: [pos, …], … }
function invertedIndexToText(
  invertedIndex: Record<string, number[]> | null | undefined,
): string {
  if (!invertedIndex) return ''
  const entries = Object.entries(invertedIndex)
  if (entries.length === 0) return ''

  // 최대 위치 계산
  let maxPos = 0
  for (const [, positions] of entries) {
    for (const p of positions) { if (p > maxPos) maxPos = p }
  }

  const words = new Array<string>(maxPos + 1).fill('')
  for (const [word, positions] of entries) {
    for (const pos of positions) {
      words[pos] = word
    }
  }

  return words.filter(Boolean).join(' ')
}

// ─── 한국어 쿼리 정제 ────────────────────────────────────────────────────────
// [2] OpenAlex는 영어 학술 DB이므로 영어 기술 용어만 추출한다.
function buildEnglishQuery(rawQuery: string): string {
  const words = rawQuery.split(/\s+/)
  const englishTerms = words.filter((w) => {
    if (w.length <= 2) return false
    const asciiCount = (w.match(/[a-zA-Z0-9-]/g) ?? []).length
    return asciiCount / w.length > 0.6
  })
  const extracted = englishTerms.slice(0, 20).join(' ')
  if (extracted.length >= 10) return extracted.slice(0, 300)
  return rawQuery.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

// ─── 모듈 레벨 캐시 ──────────────────────────────────────────────────────────
// [3] 인스턴스가 매 검색마다 새로 생성되므로 모듈 스코프에 캐시를 둔다.
interface CacheEntry { docs: CandidateDoc[]; expiresAt: number }
const resultCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1_000
const MAX_CACHE_SIZE = 100

function cacheGet(key: string): CandidateDoc[] | null {
  const e = resultCache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { resultCache.delete(key); return null }
  return e.docs
}

function cacheSet(key: string, docs: CandidateDoc[]): void {
  if (resultCache.size >= MAX_CACHE_SIZE) {
    const oldest = resultCache.keys().next().value
    if (oldest !== undefined) resultCache.delete(oldest)
  }
  resultCache.set(key, { docs, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── OpenAlex API 타입 ────────────────────────────────────────────────────────

interface OAAuthorship {
  author?: { display_name?: string }
}

interface OAWork {
  id?: string
  doi?: string
  title?: string
  abstract_inverted_index?: Record<string, number[]>
  publication_date?: string
  publication_year?: number
  authorships?: OAAuthorship[]
  host_venue?: { display_name?: string }
  primary_location?: { source?: { display_name?: string } }
  type?: string
}

interface OAResponse {
  results?: OAWork[]
  meta?: { count?: number; per_page?: number; page?: number }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class OpenAlexAdapter extends BaseAdapter {
  readonly sourceName = 'openalex'
  private readonly apiKey: string

  constructor(options: AdapterOptions & { apiKey?: string } = {}) {
    super({ maxResults: 25, timeoutMs: 15_000, ...options })
    this.apiKey = options.apiKey ?? ''
  }

  async search(query: SearchQuery): Promise<CandidateDoc[]> {
    const queryText = buildEnglishQuery(query.queryText)
    if (queryText.length === 0) {
      console.warn('[OpenAlex] query empty after sanitization — skipping')
      return []
    }

    const perPage = Math.min(this.maxResults, 25)
    const cacheKey = `${perPage}:${queryText}`
    const cached = cacheGet(cacheKey)
    if (cached) {
      console.log(`[OpenAlex] cache hit — "${queryText.slice(0, 60)}" (${cached.length} docs)`)
      return this.filterByDate(cached, query.cutoffDate)
    }

    const params = new URLSearchParams({
      search: queryText,
      'per-page': String(perPage),
      select: 'id,doi,title,abstract_inverted_index,publication_date,publication_year,authorships,primary_location',
    })
    if (this.apiKey) params.set('api_key', this.apiKey)

    try {
      const data = await this.fetchJSON<OAResponse>(`${BASE_URL}?${params}`)
      const docs = (data.results ?? [])
        .map((w) => this.toDoc(w))
        .filter((d): d is CandidateDoc => d !== null)

      cacheSet(cacheKey, docs)
      return this.filterByDate(docs, query.cutoffDate).slice(0, this.maxResults)
    } catch (err) {
      console.warn('[OpenAlex] search failed:', (err as Error).message)
      return []
    }
  }

  private toDoc(work: OAWork): CandidateDoc | null {
    const id = work.id?.replace('https://openalex.org/', '')
    if (!id || !work.title) return null

    const abstract = invertedIndexToText(work.abstract_inverted_index)
    const pubDate = work.publication_date
      ?? (work.publication_year ? `${work.publication_year}-01-01` : undefined)

    const authors = (work.authorships ?? [])
      .map((a) => a.author?.display_name ?? '')
      .filter(Boolean)

    const venue = work.primary_location?.source?.display_name ?? ''
    const doi = work.doi?.replace('https://doi.org/', '')
    const url = doi
      ? `https://doi.org/${doi}`
      : `https://openalex.org/${id}`

    return {
      id: `openalex:${id}`,
      patentNumber: doi ?? id,
      title: work.title,
      abstract,
      inventors: authors,
      assignee: venue,
      publicationDate: pubDate,
      url,
      source: 'openalex',
      language: 'en',
    }
  }
}
