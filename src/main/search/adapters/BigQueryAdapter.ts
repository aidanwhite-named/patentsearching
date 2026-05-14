/**
 * BigQueryAdapter - Google BigQuery patents-public-data search adapter.
 *
 * Cost guardrails:
 * - Tracks billed bytes locally with electron-store.
 * - Stops before the monthly soft limit is reached.
 * - Sends maximumBytesBilled on every query so BigQuery rejects a query that
 *   would exceed the remaining local safety budget.
 */

import Store from 'electron-store'
import type { CandidateDoc, SearchQuery } from '../../../shared/searchTypes'
import {
  BIGQUERY_SOFT_LIMIT_BYTES,
  type BigQueryUsage,
} from '../../../shared/searchTypes'

interface BigQueryAdapterOptions {
  projectId: string
  maxResults?: number
}

interface BigQueryQueryOptions {
  query: string
  params: Record<string, unknown>
  location: string
  jobTimeoutMs: number
  maximumBytesBilled: string
}

interface BigQueryQueryResponse {
  statistics?: {
    totalBytesBilled?: string
    totalBytesProcessed?: string
  }
}

interface BigQueryClient {
  query(options: BigQueryQueryOptions): Promise<[unknown[], unknown, BigQueryQueryResponse?]>
}

interface BigQueryConstructor {
  new (options: { projectId: string }): BigQueryClient
}

interface BigQueryModule {
  BigQuery: BigQueryConstructor
}

// @google-cloud/bigquery is CommonJS in this Electron main-process setup.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BigQuery } = require('@google-cloud/bigquery') as BigQueryModule

interface BQUsageStore {
  bigQueryUsage: BigQueryUsage
}

const usageStore = new Store<BQUsageStore>({
  name: 'bigquery-usage',
  defaults: {
    bigQueryUsage: {
      bytesUsedThisMonth: 0,
      resetMonth: new Date().toISOString().slice(0, 7),
    },
  },
})

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function getBigQueryUsage(): BigQueryUsage {
  const usage = usageStore.get('bigQueryUsage')
  const thisMonth = getCurrentMonth()
  if (usage.resetMonth !== thisMonth) {
    const reset: BigQueryUsage = { bytesUsedThisMonth: 0, resetMonth: thisMonth }
    usageStore.set('bigQueryUsage', reset)
    return reset
  }
  return usage
}

function addBytesUsed(bytes: number): void {
  const usage = getBigQueryUsage()
  usageStore.set('bigQueryUsage', {
    ...usage,
    bytesUsedThisMonth: usage.bytesUsedThisMonth + bytes,
  })
}

export class BigQueryAdapter {
  readonly sourceName = 'bigquery'
  private readonly projectId: string
  private readonly maxResults: number

  constructor(options: BigQueryAdapterOptions) {
    this.projectId  = options.projectId
    this.maxResults = options.maxResults ?? 30
  }

  async search(query: SearchQuery): Promise<CandidateDoc[]> {
    const usage = getBigQueryUsage()
    if (usage.bytesUsedThisMonth >= BIGQUERY_SOFT_LIMIT_BYTES) {
      throw new Error(
        `BigQuery monthly safety limit reached (${formatGB(usage.bytesUsedThisMonth)} GB used). ` +
        'It will reset automatically next month.',
      )
    }

    const remainingBytes = Math.max(0, BIGQUERY_SOFT_LIMIT_BYTES - usage.bytesUsedThisMonth)
    const bq = new BigQuery({ projectId: this.projectId })

    const keywords = extractKeywords(query.queryText)
    if (keywords.length === 0) return []

    const cutoffInt = query.cutoffDate
      ? parseInt(query.cutoffDate.replace(/-/g, ''), 10)
      : parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''), 10)
    const startInt = cutoffInt - 20_00_00

    const langPrimary = query.language === 'ko' ? 'ko' : 'en'
    const langFallback = langPrimary === 'ko' ? 'en' : 'ko'
    const topKeywords = keywords.slice(0, 3)

    const params: Record<string, unknown> = {
      startDate: startInt,
      cutoffDate: cutoffInt,
    }
    topKeywords.forEach((kw, i) => {
      params[`kw${i}`] = `%${kw.toLowerCase()}%`
    })

    const kwFilter = topKeywords
      .map((_, i) =>
        `((SELECT COUNT(1) FROM UNNEST(abstract_localized) WHERE LOWER(text) LIKE @kw${i}) > 0 ` +
        `OR (SELECT COUNT(1) FROM UNNEST(title_localized) WHERE LOWER(text) LIKE @kw${i}) > 0)`
      )
      .join('\n    AND ')

    const sql = `
SELECT
  publication_number,
  country_code,
  filing_date,
  priority_date,
  publication_date,
  (SELECT title FROM UNNEST(title_localized) WHERE language = '${langPrimary}' LIMIT 1) AS title_primary,
  (SELECT title FROM UNNEST(title_localized) WHERE language = '${langFallback}' LIMIT 1) AS title_fallback,
  (SELECT text FROM UNNEST(abstract_localized) WHERE language = '${langPrimary}' LIMIT 1) AS abstract_primary,
  (SELECT text FROM UNNEST(abstract_localized) WHERE language = '${langFallback}' LIMIT 1) AS abstract_fallback,
  (SELECT STRING_AGG(name, ', ') FROM UNNEST(assignee_harmonized) LIMIT 3) AS assignee,
  (SELECT STRING_AGG(code, ',') FROM UNNEST(ipc_code) LIMIT 5) AS ipc_codes
FROM \`patents-public-data.patents.publications\`
WHERE
  country_code IN ('KR', 'US', 'EP', 'WO', 'JP', 'CN')
  AND filing_date BETWEEN @startDate AND @cutoffDate
  AND filing_date > 0
  AND (${kwFilter})
LIMIT ${this.maxResults}
`

    console.log(`[BigQueryAdapter] Query keywords: ${topKeywords.join(', ')}`)

    const [rows, , resp] = await bq.query({
      query: sql,
      params,
      location: 'US',
      jobTimeoutMs: 30_000,
      maximumBytesBilled: String(remainingBytes),
    })

    const bytesProcessed = parseInt(
      resp?.statistics?.totalBytesBilled ?? resp?.statistics?.totalBytesProcessed ?? '0',
      10,
    )
    if (bytesProcessed > 0) {
      addBytesUsed(bytesProcessed)
      console.log(`[BigQueryAdapter] Billed bytes: ${formatGB(bytesProcessed)} GB`)
    }

    return rows.map((row) => this.rowToDoc(asRecord(row)))
  }

  private rowToDoc(row: Record<string, unknown>): CandidateDoc {
    const pubNum = String(row.publication_number ?? '')
    const title  = String(row.title_primary ?? row.title_fallback ?? pubNum)
    const abstr  = String(row.abstract_primary ?? row.abstract_fallback ?? '')
    const countryCode = String(row.country_code ?? 'US').toUpperCase()
    const filingDate  = formatBQDate(row.filing_date)
    const pubDate     = formatBQDate(row.publication_date)

    return {
      id:              `bigquery:${pubNum}`,
      patentNumber:    pubNum,
      title:           title || pubNum,
      abstract:        abstr,
      assignee:        row.assignee ? String(row.assignee) : undefined,
      ipcCodes:        row.ipc_codes ? String(row.ipc_codes).split(',').filter(Boolean) : undefined,
      filingDate,
      publicationDate: pubDate,
      url:             `https://patents.google.com/patent/${pubNum}`,
      source:          'bigquery',
      language:        detectLang(title),
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function formatGB(bytes: number): string {
  return (bytes / 1e9).toFixed(3)
}

function formatBQDate(val: unknown): string | undefined {
  const n = typeof val === 'number' ? val : parseInt(String(val ?? '0'), 10)
  if (!n || n <= 0) return undefined
  const s = String(n)
  if (s.length !== 8) return undefined
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function detectLang(text: string): 'ko' | 'en' {
  const koreanChars = (text.match(/\p{Script=Hangul}/gu) ?? []).length
  return koreanChars > text.length * 0.1 ? 'ko' : 'en'
}

function extractKeywords(queryText: string): string[] {
  const stopWords = new Set([
    '있는', '하는', '포함', '구성', '방법', '장치', '시스템',
    'the', 'a', 'an', 'of', 'in', 'is', 'for', 'and', 'or',
    'comprising', 'method', 'device', 'system', 'wherein',
  ])

  return [
    ...new Set(
      queryText
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !stopWords.has(token)),
    ),
  ]
}
