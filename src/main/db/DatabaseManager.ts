/**
 * DatabaseManager — sql.js(WASM) SQLite wrapper for Electron main process.
 *
 * Why sql.js instead of better-sqlite3:
 *   better-sqlite3 requires native compilation (node-gyp + VS Build Tools).
 *   sql.js ships a pre-compiled WASM binary — zero native dependencies.
 *   API is kept similar to better-sqlite3 (sync-style after async init).
 *
 * Persistence model:
 *   sql.js is in-memory at runtime; we read from / write to a .db file
 *   on disk. Writes are debounced (100 ms) to avoid thrashing on rapid mutations.
 */

import initSqlJs, { type Database, type SqlJsStatic, type BindParams } from 'sql.js'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import fs from 'fs'
import path from 'path'

export class DatabaseManager {
  private static _instance: DatabaseManager | null = null

  private db!: Database
  private readonly dbPath: string
  private saveHandle: NodeJS.Timeout | null = null

  private constructor(filename: string) {
    this.dbPath = path.join(app.getPath('userData'), filename)
  }

  // ─── Singleton / lifecycle ────────────────────────────────────────────

  static async getInstance(filename = 'patent-search.db'): Promise<DatabaseManager> {
    if (!DatabaseManager._instance) {
      const mgr = new DatabaseManager(filename)
      await mgr.init()
      DatabaseManager._instance = mgr
    }
    return DatabaseManager._instance
  }

  private async init(): Promise<void> {
    const SQL: SqlJsStatic = await initSqlJs({
      locateFile: (filename: string) => this.wasmPath(filename),
    })

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath)
      this.db = new SQL.Database(buffer)
    } else {
      this.db = new SQL.Database()
    }

    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA foreign_keys = ON')
    this.applyMigrations()
    console.log('[DB] Initialized at', this.dbPath)
  }

  private wasmPath(filename: string): string {
    // In dev: resolve through node_modules; in production: next to main bundle
    if (is.dev) {
      return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', filename)
    }
    // electron-builder must copy sql-wasm.wasm to app.asar.unpacked/sql.js/
    return path.join(process.resourcesPath, 'sql.js', filename)
  }

  // ─── Query API (sync after init, mirrors better-sqlite3 style) ───────

  /** Execute SQL that modifies data (INSERT / UPDATE / DELETE / DDL). */
  run(sql: string, params: BindParams = []): void {
    this.db.run(sql, params)
    this.scheduleSave()
  }

  /** Run a transaction — all statements inside are atomic. */
  transaction(fn: () => void): void {
    this.db.run('BEGIN')
    try {
      fn()
      this.db.run('COMMIT')
      this.scheduleSave()
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
  }

  /** Return the first matching row as a plain object, or undefined. */
  get<T>(
    sql: string,
    params: BindParams = []
  ): T | undefined {
    const stmt = this.db.prepare(sql)
    stmt.bind(params)
    const result = stmt.step() ? (stmt.getAsObject() as unknown as T) : undefined
    stmt.free()
    return result
  }

  /** Return all matching rows as plain objects. */
  all<T>(
    sql: string,
    params: BindParams = []
  ): T[] {
    const stmt = this.db.prepare(sql)
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as T)
    }
    stmt.free()
    return rows
  }

  /** Execute DDL / multi-statement SQL (no params). */
  exec(sql: string): void {
    this.db.exec(sql)
    this.scheduleSave()
  }

  /** Get the rowid of the last INSERT. */
  lastInsertRowId(): number {
    const row = this.get<{ id: number }>('SELECT last_insert_rowid() AS id')
    return row?.id ?? 0
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  /** Flush in-memory database to disk immediately. */
  save(): void {
    if (this.saveHandle) {
      clearTimeout(this.saveHandle)
      this.saveHandle = null
    }
    const data = this.db.export()
    fs.writeFileSync(this.dbPath, Buffer.from(data))
  }

  private scheduleSave(): void {
    if (this.saveHandle) clearTimeout(this.saveHandle)
    this.saveHandle = setTimeout(() => {
      this.save()
      this.saveHandle = null
    }, 100)
  }

  // ─── Schema migrations ────────────────────────────────────────────────

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_versions (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    const row = this.get<{ v: number }>(
      "SELECT COALESCE(MAX(version), 0) AS v FROM _schema_versions"
    )
    const currentVersion = row?.v ?? 0

    if (currentVersion < 1) this.migrateV1()
    if (currentVersion < 2) this.migrateV2()
    if (currentVersion < 3) this.migrateV3()
  }

  private migrateV1(): void {
    this.db.exec(`
      -- Prompt template registry with full versioning
      CREATE TABLE IF NOT EXISTS prompts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        version    TEXT    NOT NULL,
        strategy   TEXT    NOT NULL,
        provider   TEXT    NOT NULL DEFAULT 'all',
        template   TEXT    NOT NULL,
        variables  TEXT    NOT NULL DEFAULT '[]',
        is_active  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name, version)
      );
      CREATE INDEX IF NOT EXISTS idx_prompts_strategy ON prompts(strategy, is_active);

      -- Patent search execution history
      CREATE TABLE IF NOT EXISTS search_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        query         TEXT    NOT NULL,
        strategy      TEXT    NOT NULL,
        results_count INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_search_created ON search_history(created_at DESC);

      -- LLM analysis results linked to searches
      CREATE TABLE IF NOT EXISTS analysis_results (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        search_id      INTEGER REFERENCES search_history(id) ON DELETE CASCADE,
        patent_number  TEXT,
        strategy       TEXT NOT NULL,
        prompt_name    TEXT,
        prompt_version TEXT,
        result         TEXT NOT NULL,       -- raw JSON from LLM
        result_parsed  TEXT,               -- validated/normalised JSON
        provider       TEXT NOT NULL,
        model          TEXT,
        latency_ms     INTEGER,
        input_tokens   INTEGER DEFAULT 0,
        output_tokens  INTEGER DEFAULT 0,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_search  ON analysis_results(search_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_patent  ON analysis_results(patent_number);
      CREATE INDEX IF NOT EXISTS idx_analysis_strategy ON analysis_results(strategy);

      -- Patent documents cache (avoid redundant API calls)
      CREATE TABLE IF NOT EXISTS patent_cache (
        patent_number TEXT PRIMARY KEY,
        source        TEXT NOT NULL,
        title         TEXT,
        abstract      TEXT,
        claims        TEXT,
        description   TEXT,
        ipc_codes     TEXT,
        filing_date   TEXT,
        pub_date      TEXT,
        raw_json      TEXT NOT NULL,
        cached_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO _schema_versions (version) VALUES (1);
    `)
    this.scheduleSave()
    console.log('[DB] Migration v1 applied')
  }

  private migrateV2(): void {
    // Extend search_history with claim text and source metadata
    try {
      this.db.exec(`ALTER TABLE search_history ADD COLUMN claim_text TEXT DEFAULT ''`)
    } catch { /* column already exists */ }
    try {
      this.db.exec(`ALTER TABLE search_history ADD COLUMN sources TEXT DEFAULT ''`)
    } catch { /* column already exists */ }
    try {
      this.db.exec(`ALTER TABLE search_history ADD COLUMN cutoff_date TEXT DEFAULT ''`)
    } catch { /* column already exists */ }

    this.db.exec(`
      -- Stage 1 candidate documents per search
      CREATE TABLE IF NOT EXISTS search_candidates (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        search_id        INTEGER NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
        patent_number    TEXT    NOT NULL,
        source           TEXT    NOT NULL,
        title            TEXT,
        abstract         TEXT,
        url              TEXT,
        url_valid        INTEGER,
        publication_date TEXT,
        filing_date      TEXT,
        bm25_score       REAL    DEFAULT 0,
        vector_score     REAL    DEFAULT 0,
        rrf_score        REAL    DEFAULT 0,
        stage1_rank      INTEGER,
        raw_json         TEXT    NOT NULL DEFAULT '{}',
        created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(search_id, patent_number)
      );
      CREATE INDEX IF NOT EXISTS idx_candidates_search ON search_candidates(search_id, stage1_rank);
      CREATE INDEX IF NOT EXISTS idx_candidates_patent ON search_candidates(patent_number);

      -- Stage 2 LLM rerank results
      CREATE TABLE IF NOT EXISTS rerank_results (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        search_id        INTEGER NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
        candidate_id     INTEGER REFERENCES search_candidates(id) ON DELETE CASCADE,
        patent_number    TEXT    NOT NULL,
        element_scores   TEXT    NOT NULL DEFAULT '[]',
        weighted_score   REAL    NOT NULL DEFAULT 0,
        novelty_threat   INTEGER NOT NULL DEFAULT 0,
        inventive_threat INTEGER NOT NULL DEFAULT 0,
        reasoning        TEXT,
        stage2_rank      INTEGER,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_rerank_search ON rerank_results(search_id, stage2_rank);

      -- Claim charts (대비표)
      CREATE TABLE IF NOT EXISTS claim_charts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        search_id        INTEGER NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
        patent_number    TEXT    NOT NULL,
        chart_json       TEXT    NOT NULL,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_charts_search ON claim_charts(search_id);

      INSERT INTO _schema_versions (version) VALUES (2);
    `)
    this.scheduleSave()
    console.log('[DB] Migration v2 applied')
  }

  private migrateV3(): void {
    this.db.exec(`
      -- Project containers (PDF + metadata)
      CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        pdf_path    TEXT,
        pdf_text    TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

      -- Serialized React Flow workspace state per project
      CREATE TABLE IF NOT EXISTS project_workspace (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        nodes_json     TEXT    NOT NULL DEFAULT '[]',
        edges_json     TEXT    NOT NULL DEFAULT '[]',
        context_json   TEXT    NOT NULL DEFAULT '[]',
        claim_text     TEXT    NOT NULL DEFAULT '',
        prompt_version TEXT    NOT NULL DEFAULT '',
        updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id)
      );

      -- Link searches to projects
      CREATE TABLE IF NOT EXISTS project_searches (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        search_id  INTEGER NOT NULL REFERENCES search_history(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, search_id)
      );
      CREATE INDEX IF NOT EXISTS idx_proj_searches ON project_searches(project_id, created_at DESC);

      INSERT INTO _schema_versions (version) VALUES (3);
    `)
    this.scheduleSave()
    console.log('[DB] Migration v3 applied')
  }
}
