/**
 * projectHandlers — IPC for:
 *   - Project CRUD (list, create, load, save, delete)
 *   - PDF (open dialog, text extract, context chunk)
 *   - Export (Markdown, JSON)
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import { PROJECT_CHANNELS } from '../../shared/projectTypes'
import { CLAIM_CHANNELS } from '../../shared/patentTypes'
import type { CreateProjectParams, SaveProjectParams } from '../../shared/projectTypes'
import type { EnrichClaimsParams } from '../../shared/patentTypes'
import type { DatabaseManager } from '../db/DatabaseManager'
import { ProjectManager } from '../project/ProjectManager'
import { ExportManager } from '../export/ExportManager'
import { extractPdfText } from '../pdf/PdfProcessor'
import { parsePatentStructure } from '../pdf/PatentStructureParser'
import { buildSemanticChunks } from '../pdf/SemanticChunker'
import { applyFigureLinks } from '../retrieval/FigureLinker'
import { ClaimEnricher } from '../claim/ClaimEnricher'

export function registerProjectHandlers(db: DatabaseManager): void {
  const projects = new ProjectManager(db)
  const exporter = new ExportManager(db, projects)

  // ── Project list ────────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PROJECT_LIST, () => {
    return projects.list()
  })

  // ── Project create ──────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PROJECT_CREATE, (_e, params: CreateProjectParams) => {
    return projects.create(params)
  })

  // ── Project load (project + workspace) ─────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PROJECT_LOAD, (_e, id: number) => {
    const project   = projects.getById(id)
    const workspace = projects.loadWorkspace(id)
    return { project, workspace }
  })

  // ── Project save ────────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PROJECT_SAVE, (_e, params: SaveProjectParams) => {
    projects.saveWorkspace(params)
    return { success: true }
  })

  // ── Project delete ──────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PROJECT_DELETE, (_e, id: number) => {
    projects.delete(id)
    return { success: true }
  })

  // ── PDF open dialog ─────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PDF_OPEN_DIALOG, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: 'PDF 파일 선택',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  // ── PDF text extraction ─────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.PDF_EXTRACT, async (_e, filePath: string) => {
    return await extractPdfText(filePath)
  })

  // ── PDF raw buffer → base64 (for renderer-side blob URL preview) ────────────
  ipcMain.handle(PROJECT_CHANNELS.PDF_READ_BUFFER, (_e, filePath: string) => {
    return fs.readFileSync(filePath).toString('base64')
  })

  // ── PDF → PatentStructure (structured section parse) ────────────────────────
  ipcMain.handle(CLAIM_CHANNELS.PDF_PARSE_STRUCTURE, async (_e, filePath: string) => {
    const extracted = await extractPdfText(filePath)
    const structure = parsePatentStructure(extracted.text, filePath, extracted.pageCount)
    return structure
  })

  // ── PatentStructure sections → SemanticChunks (+ figure linking) ────────────
  ipcMain.handle(
    CLAIM_CHANNELS.PDF_SEMANTIC_CHUNK,
    (
      _e,
      { sections, figureRefs }: {
        sections: import('../../shared/patentTypes').PatentSection[]
        figureRefs: import('../../shared/patentTypes').FigureRef[]
      }
    ) => {
      const chunks = buildSemanticChunks(sections)
      const patialStructure = { figureRefs } as import('../../shared/patentTypes').PatentStructure
      applyFigureLinks(patialStructure, chunks)
      return { chunks, figureRefs: patialStructure.figureRefs }
    }
  )

  // ── Claim enrichment (LLM) ───────────────────────────────────────────────────
  ipcMain.handle(CLAIM_CHANNELS.CLAIM_ENRICH, async (_e, params: EnrichClaimsParams) => {
    const enricher = new ClaimEnricher()
    return await enricher.enrich(params)
  })

  // ── Markdown export ─────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.EXPORT_MARKDOWN, async (_e, projectId: number) => {
    const filePath = await exporter.exportMarkdown(projectId)
    return filePath ? { success: true, filePath } : { success: false, filePath: null }
  })

  // ── JSON export ─────────────────────────────────────────────────────────────
  ipcMain.handle(PROJECT_CHANNELS.EXPORT_JSON, async (_e, projectId: number) => {
    const filePath = await exporter.exportJson(projectId)
    return filePath ? { success: true, filePath } : { success: false, filePath: null }
  })
}
