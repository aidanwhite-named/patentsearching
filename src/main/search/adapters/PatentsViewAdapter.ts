/**
 * PatentsViewAdapter — USPTO PatentsView 공개 API를 사용하는 특허 검색 어댑터.
 *
 * Endpoint: https://search.patentsview.org/api/v1/patent/
 * - API 키 불필요 (공개 무료 API)
 * - 분당 45회 요청 제한
 * - POST JSON body 방식 사용 (GET URL-param 방식은 긴 쿼리에서 HTML 오류 반환)
 */

import { BaseAdapter, type AdapterOptions } from './BaseAdapter'
import type { CandidateDoc, SearchQuery } from '../../../shared/searchTypes'

interface PVInventor {
  inventor_name_first?: string
  inventor_name_last?: string
}
interface PVAssignee {
  assignee_organization?: string
}
interface PVIpcCode {
  ipc_code?: string
}
interface PVPatent {
  patent_id?: string
  patent_title?: string
  patent_abstract?: string
  patent_date?: string
  inventors?: PVInventor[]
  assignees?: PVAssignee[]
  ipc_codes?: PVIpcCode[]
}
interface PVResponse {
  patents?: PVPatent[]
  count?: number
  total_patent_count?: number
}

const BASE_URL = 'https://search.patentsview.org/api/v1/patent/'
const FIELDS = [
  'patent_id',
  'patent_title',
  'patent_abstract',
  'patent_date',
  'inventors.inventor_name_first',
  'inventors.inventor_name_last',
  'assignees.assignee_organization',
  'ipc_codes.ipc_code',
]

export class PatentsViewAdapter extends BaseAdapter {
  readonly sourceName = 'patentsview'

  constructor(options: AdapterOptions = {}) {
    super({ maxResults: 25, timeoutMs: 15_000, ...options })
  }

  async search(query: SearchQuery): Promise<CandidateDoc[]> {
    // 쿼리 텍스트 — 150자로 제한해 API 부하 최소화
    const queryText = query.queryText.slice(0, 150).trim()
    if (!queryText) return []

    const perPage = Math.min(this.maxResults, 25)

    // POST JSON body: 제목 OR 초록에서 키워드 검색
    // GET + URLSearchParams 방식은 긴 JSON이 URL에서 손상될 수 있어 POST 사용
    const body = JSON.stringify({
      q: {
        _or: [
          { _text_any: { patent_title: queryText } },
          { _text_any: { patent_abstract: queryText } },
        ],
      },
      f: FIELDS,
      o: { per_page: perPage, page: 1 },
      s: [{ patent_date: 'desc' }],
    })

    try {
      const data = await this.fetchJSON<PVResponse>(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      })
      const docs = (data.patents ?? [])
        .map((p) => this.toDoc(p))
        .filter((d): d is CandidateDoc => d !== null)
      return this.filterByDate(docs, query.cutoffDate).slice(0, this.maxResults)
    } catch (err) {
      console.warn('[PatentsView] search failed:', (err as Error).message)
      return []
    }
  }

  private toDoc(p: PVPatent): CandidateDoc | null {
    const num = p.patent_id
    if (!num) return null

    const inventors = (p.inventors ?? [])
      .map((i) => [i.inventor_name_first, i.inventor_name_last].filter(Boolean).join(' '))
      .filter(Boolean)

    const assignee = p.assignees?.[0]?.assignee_organization ?? ''
    const ipcCodes = (p.ipc_codes ?? []).map((c) => c.ipc_code ?? '').filter(Boolean)

    return {
      id: `patentsview:${num}`,
      patentNumber: `US${num}`,
      title: p.patent_title ?? '',
      abstract: p.patent_abstract ?? '',
      inventors,
      assignee,
      publicationDate: p.patent_date,
      ipcCodes,
      url: `https://patents.google.com/patent/US${num}`,
      source: 'patentsview',
      language: 'en',
    }
  }
}
