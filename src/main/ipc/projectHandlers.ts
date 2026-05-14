/**
 * projectHandlers — IPC for:
 *   - Project CRUD (list, create, load, save, delete)
 *   - PDF (open dialog, text extract, context chunk)
 *   - Export (Markdown, JSON)
 */

import { ipcMain, dialog, BrowserWindow, net } from 'electron'
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
import { PromptRegistry } from '../llm/PromptRegistry'
import { ProviderFactory } from '../llm/providers/ProviderFactory'
import { getSettings } from './settingsHandlers'

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

  ipcMain.handle(PROJECT_CHANNELS.CONTEXT_FETCH_URL, async (_e, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('HTTP 또는 HTTPS URL만 사용할 수 있습니다.')
    }

    const response = await net.fetch(parsed.toString())
    if (!response.ok) {
      throw new Error(`URL을 불러오지 못했습니다. HTTP ${response.status}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const raw = await response.text()
    const text = contentType.includes('html')
      ? raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      : raw.replace(/\s+/g, ' ').trim()

    return {
      url: parsed.toString(),
      title: parsed.hostname,
      text: text.slice(0, 20_000),
    }
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
    const enricher = new ClaimEnricher(db)
    return await enricher.enrich(params)
  })

  // ── LLM-based claim text extraction using claims_analysis prompt ─────────────
  // Takes raw claims text (or full PDF text as fallback) and runs it through the
  // active claims_analysis prompt to produce a structured, human-readable output.
  ipcMain.handle(CLAIM_CHANNELS.CLAIM_EXTRACT_TEXT, async (_e, claimsText: string) => {
    const settings  = getSettings()
    const provider  = await ProviderFactory.getInstance().create(settings)
    const registry  = new PromptRegistry(db)
    const template  = registry.getActive('claims_analysis')

    const inputText = claimsText.slice(0, 12_000)

    const prompt = template
      ? registry.render(template, {
          claims_text:          inputText,
          claims:               inputText,
          prior_art_references: '',
          invention_title:      '',
          invention_description: '',
          technical_field:      '',
        })
      : `다음 특허 청구항 텍스트를 분석하고 독립항을 구성요소별로 정리하세요:\n\n${inputText}`

    console.log(`[ClaimExtract] claims_analysis 프롬프트 실행 — 입력 ${inputText.length}자`)

    const result = await provider.generate({
      prompt,
      systemPrompt: '당신은 특허 청구항을 분석하는 전문가입니다. 사용자가 설정한 프롬프트의 지시를 최우선으로 따르십시오.',
      temperature: 0.1,
      maxTokens:   3_000,
    })

    console.log(`[ClaimExtract] LLM 응답 ${result.content.length}자`)
    return { displayText: result.content }
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
