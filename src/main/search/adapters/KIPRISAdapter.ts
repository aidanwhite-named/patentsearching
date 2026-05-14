/**
 * KIPRISAdapter — Korean Intellectual Property Rights Information Service.
 *
 * REST OpenAPI endpoint (requires free API key from KIPRIS Plus):
 *   https://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice/patentFreeSearch
 *
 * Docs: https://plus.kipris.or.kr/portal/html/guide/OpenApiIntroGuide.html
 */

import { BaseAdapter, type AdapterOptions } from './BaseAdapter'
import type { CandidateDoc, SearchQuery } from '../../../shared/searchTypes'

const BASE = 'https://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice/patentFreeSearch'

interface KIPRISItem {
  applicationNumber?: string
  registrationNumber?: string
  inventionTitle?: string
  astrtCont?: string           // abstract
  applicantName?: string
  inventorName?: string
  ipcNumber?: string
  applicationDate?: string
  openDate?: string            // publication date
  registerDate?: string
}

interface KIPRISResponse {
  response?: {
    body?: {
      items?: {
        item?: KIPRISItem | KIPRISItem[]
      }
      totalCount?: number
    }
  }
}

export class KIPRISAdapter extends BaseAdapter {
  readonly sourceName = 'kipris'
  private readonly apiKey: string

  constructor(options: AdapterOptions & { apiKey: string }) {
    super({ maxResults: 100, ...options })
    this.apiKey = options.apiKey
  }

  async search(query: SearchQuery): Promise<CandidateDoc[]> {
    if (!this.apiKey) {
      console.warn('[KIPRIS] No API key — skipping KIPRIS search')
      return []
    }

    const docs: CandidateDoc[] = []
    const pageSize = 20
    const maxPages = Math.ceil(this.maxResults / pageSize)

    for (let page = 1; page <= maxPages; page++) {
      try {
        const params = new URLSearchParams({
          ServiceKey: this.apiKey,
          word: query.queryText,
          numOfRows: String(pageSize),
          pageNo: String(page),
          type: 'json',
        })

        const data = await this.fetchJSON<KIPRISResponse>(`${BASE}?${params}`)
        const items = this.extractItems(data)
        for (const item of items) {
          const doc = this.toDoc(item)
          if (doc) docs.push(doc)
        }
        if (items.length < pageSize) break
      } catch (err) {
        console.warn(`[KIPRIS] page ${page} failed:`, (err as Error).message)
        break
      }
    }

    return this.filterByDate(docs, query.cutoffDate).slice(0, this.maxResults)
  }

  private extractItems(data: KIPRISResponse): KIPRISItem[] {
    const raw = data?.response?.body?.items?.item
    if (!raw) return []
    return Array.isArray(raw) ? raw : [raw]
  }

  private toDoc(item: KIPRISItem): CandidateDoc | null {
    const num = item.registrationNumber ?? item.applicationNumber
    if (!num) return null

    const pubDate = normalizeKoDate(item.openDate)
    const fileDate = normalizeKoDate(item.applicationDate)

    return {
      id: `kipris:${num}`,
      patentNumber: num,
      title: item.inventionTitle ?? '',
      abstract: item.astrtCont ?? '',
      assignee: item.applicantName ?? '',
      inventors: item.inventorName ? item.inventorName.split('|') : [],
      filingDate: fileDate,
      publicationDate: pubDate,
      ipcCodes: item.ipcNumber ? item.ipcNumber.split('|') : [],
      url: `https://doi.kipris.or.kr/patentsearch/detail.do?number=${num}`,
      source: 'kipris',
      language: 'ko',
    }
  }
}

// KIPRIS dates are 'YYYYMMDD' or 'YYYY-MM-DD'
function normalizeKoDate(raw?: string): string | undefined {
  if (!raw) return undefined
  const d = raw.replace(/\D/g, '')
  if (d.length === 8) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`
  return raw
}
