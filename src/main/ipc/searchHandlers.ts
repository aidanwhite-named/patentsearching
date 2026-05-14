/**
 * searchHandlers — IPC handlers for the two-stage retrieval engine.
 *
 * Search runs asynchronously; progress is pushed via webContents.send().
 * The renderer initiates with SEARCH_START and can cancel with SEARCH_CANCEL.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { SearchEngine } from '../search/SearchEngine'
import type { DatabaseManager } from '../db/DatabaseManager'
import type {
  SearchQuery,
  SearchSettings,
  SearchProgress,
  SearchResult,
} from '../../shared/searchTypes'
import { SEARCH_CHANNELS } from '../../shared/searchTypes'
import ElectronStore from 'electron-store'

const store = new ElectronStore<{ searchSettings: SearchSettings }>({ name: 'search-settings' })

const DEFAULT_SETTINGS: SearchSettings = {
  patentsViewEnabled: true,
  kiprisEnabled: false,
  openAlexEnabled: true,
  openAlexApiKey: 'kSonohsFeEiEvt9kK6ga7o',
  bigQueryEnabled: false,
  bigQueryProjectId: '',
  maxCandidatesPerSource: 25,
  urlValidationEnabled: false,
  rerankerEnabled: true,
  rrfK: 60,
}

// One active engine per renderer window (keyed by webContentsId)
const activeEngines = new Map<number, SearchEngine>()

function getSettings(): SearchSettings {
  return store.get('searchSettings', DEFAULT_SETTINGS)
}

function getSender(wcId: number): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => w.webContents.id === wcId) ?? null
}

export function registerSearchHandlers(db: DatabaseManager): void {
  // ── Settings ──────────────────────────────────────────────────────────

  ipcMain.handle(SEARCH_CHANNELS.SEARCH_SETTINGS_GET, () => getSettings())

  ipcMain.handle(SEARCH_CHANNELS.SEARCH_SETTINGS_SET, (_e, patch: Partial<SearchSettings>) => {
    const current = getSettings()
    const updated = { ...current, ...patch }
    store.set('searchSettings', updated)
    return updated
  })

  // ── History ───────────────────────────────────────────────────────────

  ipcMain.handle(SEARCH_CHANNELS.SEARCH_HISTORY_LIST, (_e, limit = 20) => {
    return db.all<Record<string, unknown>>(
      `SELECT id, query, claim_text, sources, cutoff_date, results_count, created_at
       FROM search_history
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    )
  })

  // ── Main search flow ───────────────────────────────────────────────────

  ipcMain.on(SEARCH_CHANNELS.SEARCH_START, async (event, query: SearchQuery) => {
    const wcId = event.sender.id
    const win = getSender(wcId)
    if (!win) return

    const send = (channel: string, payload: unknown) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }

    // Cancel any previous engine
    activeEngines.get(wcId)?.cancel()

    const settings = getSettings()
    const engine = new SearchEngine(settings)
    activeEngines.set(wcId, engine)

    // Persist search record
    let searchId: number | null = null
    try {
      db.run(
        `INSERT INTO search_history (query, claim_text, sources, cutoff_date, strategy, results_count)
         VALUES (?, ?, ?, ?, 'prior_art', 0)`,
        [
          query.queryText,
          query.parsedClaim?.raw ?? '',
          query.sources.join(','),
          query.cutoffDate ?? '',
        ],
      )
      searchId = db.lastInsertRowId()
    } catch (err) {
      console.warn('[searchHandlers] Failed to insert search_history:', (err as Error).message)
    }

    try {
      const result = await engine.run(query, (progress: SearchProgress) => {
        send(SEARCH_CHANNELS.SEARCH_PROGRESS, progress)
      })

      // Persist candidates
      if (searchId) {
        persistResults(db, searchId, result)
      }

      send(SEARCH_CHANNELS.SEARCH_COMPLETE, result)
    } catch (err) {
      const msg = (err as Error).message
      console.error('[searchHandlers] Search error:', msg)
      send(SEARCH_CHANNELS.SEARCH_ERROR, { queryId: query.id, message: msg })
    } finally {
      activeEngines.delete(wcId)
    }
  })

  ipcMain.on(SEARCH_CHANNELS.SEARCH_CANCEL, (event) => {
    const wcId = event.sender.id
    activeEngines.get(wcId)?.cancel()
    activeEngines.delete(wcId)
  })
}

// ─── Persistence helpers ───────────────────────────────────────────────────

function persistResults(db: DatabaseManager, searchId: number, result: SearchResult): void {
  try {
    db.transaction(() => {
      // Update result count
      db.run(
        'UPDATE search_history SET results_count = ? WHERE id = ?',
        [result.candidates.length, searchId],
      )

      // Store top 50 candidates
      for (const c of result.candidates.slice(0, 50)) {
        db.run(
          `INSERT OR IGNORE INTO search_candidates
           (search_id, patent_number, source, title, abstract, url, url_valid,
            publication_date, filing_date, bm25_score, vector_score, rrf_score,
            stage1_rank, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            searchId,
            c.doc.patentNumber,
            c.doc.source,
            c.doc.title,
            c.doc.abstract,
            c.doc.url,
            c.doc.urlValid ? 1 : 0,
            c.doc.publicationDate ?? '',
            c.doc.filingDate ?? '',
            c.bm25Score,
            c.vectorScore,
            c.rrfScore,
            c.rank,
            JSON.stringify(c.doc),
          ],
        )
      }

      // Store claim charts
      for (const chart of result.claimCharts) {
        db.run(
          `INSERT INTO claim_charts (search_id, patent_number, chart_json)
           VALUES (?, ?, ?)`,
          [searchId, chart.patentNumber, JSON.stringify(chart)],
        )
      }
    })
  } catch (err) {
    console.warn('[searchHandlers] Persist error:', (err as Error).message)
  }
}
