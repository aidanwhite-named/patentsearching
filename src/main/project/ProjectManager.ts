/**
 * ProjectManager — CRUD for projects and workspace snapshots.
 *
 * Persistence: sql.js SQLite (DatabaseManager), tables added in migration v3.
 * All workspace state (React Flow nodes/edges, context items, claim text)
 * is stored as JSON blobs — simple to read back without migrations on schema
 * changes to the UI-side types.
 */

import type { DatabaseManager } from '../db/DatabaseManager'
import type {
  Project,
  ProjectWorkspaceState,
  CreateProjectParams,
  SaveProjectParams,
  ProjectBundle,
} from '../../shared/projectTypes'

// ─── Raw DB row shapes ────────────────────────────────────────────────────────

interface ProjectRow {
  id: number
  name: string
  description: string
  pdf_path: string | null
  pdf_text: string | null
  created_at: string
  updated_at: string
}

interface WorkspaceRow {
  project_id: number
  nodes_json: string
  edges_json: string
  context_json: string
  claim_text: string
  prompt_version: string
  updated_at: string
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    pdfPath: r.pdf_path,
    pdfText: r.pdf_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToWorkspace(r: WorkspaceRow): ProjectWorkspaceState {
  return {
    projectId: r.project_id,
    nodesJson: r.nodes_json,
    edgesJson: r.edges_json,
    contextJson: r.context_json,
    claimText: r.claim_text,
    promptVersion: r.prompt_version,
    updatedAt: r.updated_at,
  }
}

// ─── ProjectManager ───────────────────────────────────────────────────────────

export class ProjectManager {
  constructor(private readonly db: DatabaseManager) {}

  // ── Project CRUD ────────────────────────────────────────────────────────────

  list(): Project[] {
    const rows = this.db.all<ProjectRow>(
      `SELECT id, name, description, pdf_path, pdf_text, created_at, updated_at
       FROM projects ORDER BY updated_at DESC`
    )
    return rows.map(rowToProject)
  }

  create(params: CreateProjectParams): Project {
    this.db.run(
      `INSERT INTO projects (name, description) VALUES (?, ?)`,
      [params.name, params.description ?? '']
    )
    const id = this.db.lastInsertRowId()
    const row = this.db.get<ProjectRow>(
      `SELECT id, name, description, pdf_path, pdf_text, created_at, updated_at FROM projects WHERE id = ?`,
      [id]
    )
    if (!row) throw new Error('Project not created')
    return rowToProject(row)
  }

  getById(id: number): Project | null {
    const row = this.db.get<ProjectRow>(
      `SELECT id, name, description, pdf_path, pdf_text, created_at, updated_at FROM projects WHERE id = ?`,
      [id]
    )
    return row ? rowToProject(row) : null
  }

  delete(id: number): void {
    this.db.run(`DELETE FROM projects WHERE id = ?`, [id])
  }

  // ── Workspace save/load ─────────────────────────────────────────────────────

  /**
   * Save the full workspace state for a project.
   * Also updates the project's pdf_path/pdf_text if provided.
   */
  saveWorkspace(params: SaveProjectParams): void {
    this.db.transaction(() => {
      // Update project meta
      this.db.run(
        `UPDATE projects
         SET updated_at = datetime('now')
             ${params.pdfPath !== undefined ? ", pdf_path = ?" : ""}
             ${params.pdfText !== undefined ? ", pdf_text = ?" : ""}
         WHERE id = ?`,
        [
          ...(params.pdfPath !== undefined ? [params.pdfPath] : []),
          ...(params.pdfText !== undefined ? [params.pdfText] : []),
          params.projectId,
        ]
      )

      // Upsert workspace snapshot
      this.db.run(
        `INSERT INTO project_workspace
           (project_id, nodes_json, edges_json, context_json, claim_text, prompt_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_id) DO UPDATE SET
           nodes_json     = excluded.nodes_json,
           edges_json     = excluded.edges_json,
           context_json   = excluded.context_json,
           claim_text     = excluded.claim_text,
           prompt_version = excluded.prompt_version,
           updated_at     = excluded.updated_at`,
        [
          params.projectId,
          params.nodesJson,
          params.edgesJson,
          params.contextJson,
          params.claimText,
          params.promptVersion ?? '',
        ]
      )
    })
  }

  loadWorkspace(projectId: number): ProjectWorkspaceState | null {
    const row = this.db.get<WorkspaceRow>(
      `SELECT project_id, nodes_json, edges_json, context_json, claim_text, prompt_version, updated_at
       FROM project_workspace WHERE project_id = ?`,
      [projectId]
    )
    return row ? rowToWorkspace(row) : null
  }

  // ── Project bundle (for JSON export) ────────────────────────────────────────

  buildBundle(projectId: number): ProjectBundle {
    const project = this.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const workspace = this.loadWorkspace(projectId)

    const searchHistory = this.db.all<Record<string, unknown>>(
      `SELECT sh.* FROM search_history sh
       JOIN project_searches ps ON ps.search_id = sh.id
       WHERE ps.project_id = ? ORDER BY sh.created_at DESC`,
      [projectId]
    )

    const searchIds = searchHistory.map((r) => r['id'] as number)
    let analyses: Record<string, unknown>[] = []
    if (searchIds.length > 0) {
      const placeholders = searchIds.map(() => '?').join(',')
      analyses = this.db.all<Record<string, unknown>>(
        `SELECT * FROM analysis_results WHERE search_id IN (${placeholders}) ORDER BY created_at DESC`,
        searchIds
      )
    }

    return {
      project,
      workspace,
      searchHistory,
      analyses,
      exportedAt: new Date().toISOString(),
    }
  }

  /** Link an existing search_history row to a project. */
  linkSearch(projectId: number, searchId: number): void {
    try {
      this.db.run(
        `INSERT OR IGNORE INTO project_searches (project_id, search_id) VALUES (?, ?)`,
        [projectId, searchId]
      )
    } catch { /* ignore duplicate */ }
  }
}
