// ─── Domain objects ───────────────────────────────────────────────────────────

export interface Project {
  id: number
  name: string
  description: string
  pdfPath: string | null
  pdfText: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectWorkspaceState {
  projectId: number
  nodesJson: string       // JSON — React Flow nodes array
  edgesJson: string       // JSON — React Flow edges array
  contextJson: string     // JSON — ContextItem[] from workspaceStore
  claimText: string
  promptVersion: string
  updatedAt: string
}

export interface ProjectBundle {
  project: Project
  workspace: ProjectWorkspaceState | null
  searchHistory: unknown[]
  analyses: unknown[]
  exportedAt: string
}

// ─── IPC params ───────────────────────────────────────────────────────────────

export interface CreateProjectParams {
  name: string
  description?: string
}

export interface SaveProjectParams {
  projectId: number
  nodesJson: string
  edgesJson: string
  contextJson: string
  claimText: string
  promptVersion?: string
  pdfPath?: string
  pdfText?: string
}

export interface PdfExtractResult {
  text: string
  pageCount: number
  filePath: string
  fileName: string
}

export interface PdfChunkResult {
  chunks: string[]
  totalChars: number
}

export interface ExportResult {
  filePath: string
  success: boolean
}

// ─── IPC Channels ─────────────────────────────────────────────────────────────

export const PROJECT_CHANNELS = {
  PROJECT_LIST:        'project:list',
  PROJECT_CREATE:      'project:create',
  PROJECT_LOAD:        'project:load',
  PROJECT_SAVE:        'project:save',
  PROJECT_DELETE:      'project:delete',
  PROJECT_WORKSPACE:   'project:workspace',

  PDF_OPEN_DIALOG:     'pdf:openDialog',
  PDF_EXTRACT:         'pdf:extract',
  PDF_CHUNK:           'pdf:chunk',
  PDF_READ_BUFFER:     'pdf:readBuffer',

  EXPORT_MARKDOWN:     'export:markdown',
  EXPORT_JSON:         'export:json',
} as const

export type ProjectChannel = typeof PROJECT_CHANNELS[keyof typeof PROJECT_CHANNELS]
