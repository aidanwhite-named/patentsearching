/**
 * PatentDatabase — application-level DAL on top of DatabaseManager.
 * Handles search history, LLM analysis results, and patent document cache.
 */

import type { DatabaseManager } from './DatabaseManager'

// ─── Row interfaces (mirror DB schema columns) ────────────────────────────

export interface SearchRecord {
  id: number
  query: string
  strategy: string
  results_count: number
  created_at: string
}

export interface AnalysisRecord {
  id: number
  search_id: number | null
  patent_number: string | null
  strategy: string
  prompt_name: string | null
  prompt_version: string | null
  result: string
  result_parsed: string | null
  provider: string
  model: string | null
  latency_ms: number | null
  input_tokens: number
  output_tokens: number
  created_at: string
}

export interface PatentCacheRecord {
  patent_number: string
  source: string
  title: string | null
  abstract: string | null
  claims: string | null
  description: string | null
  ipc_codes: string | null
  filing_date: string | null
  pub_date: string | null
  raw_json: string
  cached_at: string
}

// ─── Input types (camelCase for application layer) ────────────────────────

export interface AddSearchInput {
  query: string
  strategy: string
  resultsCount?: number
}

export interface AddAnalysisInput {
  searchId?: number
  patentNumber?: string
  strategy: string
  promptName?: string
  promptVersion?: string
  result: string
  resultParsed?: string
  provider: string
  model?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
}

// ─── PatentDatabase ───────────────────────────────────────────────────────

export class PatentDatabase {
  constructor(private readonly db: DatabaseManager) {}

  // ─── Search history ──────────────────────────────────────────────────

  addSearch(input: AddSearchInput): SearchRecord {
    this.db.run(
      `INSERT INTO search_history (query, strategy, results_count)
       VALUES (?, ?, ?)`,
      [input.query, input.strategy, input.resultsCount ?? 0]
    )
    const id = this.db.lastInsertRowId()
    return this.db.get<SearchRecord>(
      'SELECT * FROM search_history WHERE id = ?',
      [id]
    )!
  }

  updateSearchResultCount(id: number, count: number): void {
    this.db.run(
      'UPDATE search_history SET results_count = ? WHERE id = ?',
      [count, id]
    )
  }

  getRecentSearches(limit = 20): SearchRecord[] {
    return this.db.all<SearchRecord>(
      'SELECT * FROM search_history ORDER BY created_at DESC LIMIT ?',
      [limit]
    )
  }

  // ─── Analysis results ────────────────────────────────────────────────

  addAnalysis(input: AddAnalysisInput): AnalysisRecord {
    this.db.run(
      `INSERT INTO analysis_results
         (search_id, patent_number, strategy, prompt_name, prompt_version,
          result, result_parsed, provider, model, latency_ms, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.searchId ?? null,
        input.patentNumber ?? null,
        input.strategy,
        input.promptName ?? null,
        input.promptVersion ?? null,
        input.result,
        input.resultParsed ?? null,
        input.provider,
        input.model ?? null,
        input.latencyMs ?? null,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
      ]
    )
    const id = this.db.lastInsertRowId()
    return this.db.get<AnalysisRecord>(
      'SELECT * FROM analysis_results WHERE id = ?',
      [id]
    )!
  }

  getAnalysesForSearch(searchId: number): AnalysisRecord[] {
    return this.db.all<AnalysisRecord>(
      'SELECT * FROM analysis_results WHERE search_id = ? ORDER BY created_at DESC',
      [searchId]
    )
  }

  getAnalysisForPatent(patentNumber: string): AnalysisRecord[] {
    return this.db.all<AnalysisRecord>(
      'SELECT * FROM analysis_results WHERE patent_number = ? ORDER BY created_at DESC',
      [patentNumber]
    )
  }

  /** Aggregated token usage stats for cost tracking. */
  getTokenStats(): { total_input: number; total_output: number; count: number } {
    return (
      this.db.get<{ total_input: number; total_output: number; count: number }>(
        `SELECT
           COALESCE(SUM(input_tokens),  0) AS total_input,
           COALESCE(SUM(output_tokens), 0) AS total_output,
           COUNT(*) AS count
         FROM analysis_results`
      ) ?? { total_input: 0, total_output: 0, count: 0 }
    )
  }

  // ─── Patent cache ────────────────────────────────────────────────────

  getCachedPatent(patentNumber: string): PatentCacheRecord | null {
    return (
      this.db.get<PatentCacheRecord>(
        'SELECT * FROM patent_cache WHERE patent_number = ?',
        [patentNumber]
      ) ?? null
    )
  }

  upsertPatentCache(record: Omit<PatentCacheRecord, 'cached_at'>): void {
    this.db.run(
      `INSERT INTO patent_cache
         (patent_number, source, title, abstract, claims, description,
          ipc_codes, filing_date, pub_date, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(patent_number) DO UPDATE SET
         source      = excluded.source,
         title       = excluded.title,
         abstract    = excluded.abstract,
         claims      = excluded.claims,
         description = excluded.description,
         ipc_codes   = excluded.ipc_codes,
         filing_date = excluded.filing_date,
         pub_date    = excluded.pub_date,
         raw_json    = excluded.raw_json,
         cached_at   = datetime('now')`,
      [
        record.patent_number,
        record.source,
        record.title ?? null,
        record.abstract ?? null,
        record.claims ?? null,
        record.description ?? null,
        record.ipc_codes ?? null,
        record.filing_date ?? null,
        record.pub_date ?? null,
        record.raw_json,
      ]
    )
  }
}
