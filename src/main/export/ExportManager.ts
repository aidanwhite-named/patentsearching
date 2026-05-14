/**
 * ExportManager — Markdown patent analysis report + JSON project bundle.
 *
 * Markdown format follows standard Korean patent analysis report conventions:
 *   1. 기본 정보 (project metadata)
 *   2. 청구항 목록
 *   3. 선행기술 검색 결과
 *   4. 대비표 (claim chart)
 *   5. LLM 분석 결과
 */

import fs from 'fs'
import path from 'path'
import { dialog, BrowserWindow } from 'electron'
import type { DatabaseManager } from '../db/DatabaseManager'
import type { ProjectManager } from '../project/ProjectManager'
import type { Project, ProjectWorkspaceState } from '../../shared/projectTypes'

interface SearchHistoryRow {
  id: number
  query: string
  strategy: string
  results_count: number
  claim_text: string
  created_at: string
}

interface CandidateRow {
  patent_number: string
  title: string
  source: string
  rrf_score: number
  stage1_rank: number
  url: string
}

interface RerankRow {
  patent_number: string
  weighted_score: number
  novelty_threat: number
  inventive_threat: number
  reasoning: string
  stage2_rank: number
}

interface ClaimChartRow {
  patent_number: string
  chart_json: string
}

interface AnalysisRow {
  strategy: string
  patent_number: string
  result: string
  model: string
  created_at: string
}

export class ExportManager {
  constructor(
    private readonly db: DatabaseManager,
    private readonly projects: ProjectManager
  ) {}

  // ─── Markdown export ────────────────────────────────────────────────────────

  async exportMarkdown(projectId: number): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: '분석 보고서 저장',
      defaultPath: `patent-analysis-project${projectId}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (canceled || !filePath) return null

    const content = this.buildMarkdown(projectId)
    fs.writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  private buildMarkdown(projectId: number): string {
    const project  = this.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const workspace = this.projects.loadWorkspace(projectId)
    const searches  = this.getProjectSearches(projectId)

    const lines: string[] = []

    lines.push(`# 특허 분석 보고서`)
    lines.push(``)
    lines.push(`| 항목 | 내용 |`)
    lines.push(`|------|------|`)
    lines.push(`| 프로젝트명 | ${project.name} |`)
    lines.push(`| 설명 | ${project.description || '—'} |`)
    lines.push(`| 생성일 | ${project.createdAt} |`)
    lines.push(`| 내보낸 날짜 | ${new Date().toLocaleString('ko-KR')} |`)
    lines.push(``)

    // Claims
    if (workspace?.claimText) {
      lines.push(`---`)
      lines.push(``)
      lines.push(`## 1. 청구항`)
      lines.push(``)
      lines.push('```')
      lines.push(workspace.claimText.trim())
      lines.push('```')
      lines.push(``)
    }

    // Search results
    if (searches.length > 0) {
      lines.push(`---`)
      lines.push(``)
      lines.push(`## 2. 선행기술 검색 결과`)
      lines.push(``)
      for (const search of searches) {
        lines.push(`### 검색 #${search.id} — ${search.query}`)
        lines.push(``)
        lines.push(`- **전략:** ${search.strategy}`)
        lines.push(`- **결과 수:** ${search.results_count}`)
        lines.push(`- **검색일:** ${search.created_at}`)
        lines.push(``)

        const candidates = this.getCandidates(search.id)
        const reranked   = this.getReranked(search.id)

        if (candidates.length > 0) {
          lines.push(`#### 상위 후보 특허`)
          lines.push(``)
          lines.push(`| 순위 | 특허번호 | 제목 | 출처 | RRF Score |`)
          lines.push(`|------|----------|------|------|-----------|`)
          for (const c of candidates.slice(0, 10)) {
            const title = (c.title || '').replace(/\|/g, '｜').slice(0, 60)
            lines.push(`| ${c.stage1_rank} | ${c.patent_number} | ${title} | ${c.source} | ${c.rrf_score?.toFixed(4) ?? '—'} |`)
          }
          lines.push(``)
        }

        if (reranked.length > 0) {
          lines.push(`#### LLM 재순위 결과`)
          lines.push(``)
          lines.push(`| 순위 | 특허번호 | LLM Score | 신규성 위협 | 진보성 위협 |`)
          lines.push(`|------|----------|-----------|------------|------------|`)
          for (const r of reranked.slice(0, 5)) {
            const novelty = r.novelty_threat ? '⚠️ HIGH' : '✅ LOW'
            const invent  = r.inventive_threat ? '⚠️ HIGH' : '✅ LOW'
            lines.push(`| ${r.stage2_rank} | ${r.patent_number} | ${r.weighted_score?.toFixed(3) ?? '—'} | ${novelty} | ${invent} |`)
          }
          lines.push(``)
        }

        // Claim charts
        const charts = this.getClaimCharts(search.id)
        if (charts.length > 0) {
          lines.push(`#### 대비표 (Claim Chart)`)
          lines.push(``)
          for (const chart of charts) {
            lines.push(`##### ${chart.patent_number}`)
            lines.push(``)
            try {
              const parsed = JSON.parse(chart.chart_json)
              if (Array.isArray(parsed?.elements)) {
                lines.push(`| 구성요소 | 청구항 기재 | 선행기술 대응 | 판단 |`)
                lines.push(`|----------|-------------|---------------|------|`)
                for (const el of parsed.elements) {
                  const elem   = String(el.element || '').replace(/\|/g, '｜').slice(0, 50)
                  const claim  = String(el.claimText || '').replace(/\|/g, '｜').slice(0, 60)
                  const prior  = String(el.priorArtText || '').replace(/\|/g, '｜').slice(0, 60)
                  const verdict = el.verdict === 'PRESENT' ? '✅ 저촉' : el.verdict === 'ABSENT' ? '❌ 미해당' : '⚠️ 부분'
                  lines.push(`| ${elem} | ${claim} | ${prior} | ${verdict} |`)
                }
                lines.push(``)
              }
              if (parsed?.summary) {
                lines.push(`**요약:** ${parsed.summary}`)
                lines.push(``)
              }
            } catch { /* malformed JSON */ }
          }
        }

        // LLM analyses
        const analyses = this.getAnalyses(search.id)
        if (analyses.length > 0) {
          lines.push(`#### LLM 분석 결과`)
          lines.push(``)
          const strategyLabel: Record<string, string> = {
            novelty: '신규성',
            inventiveness: '진보성',
            prior_art: '선행기술',
            claims_analysis: '청구항 분석',
          }
          for (const a of analyses) {
            lines.push(`##### ${strategyLabel[a.strategy] ?? a.strategy}${a.patent_number ? ` — ${a.patent_number}` : ''}`)
            lines.push(``)
            try {
              const parsed = JSON.parse(a.result)
              if (parsed?.reasoning) {
                lines.push(`**추론:** ${parsed.reasoning}`)
                lines.push(``)
              }
              if (parsed?.risk_level) {
                const emoji = parsed.risk_level === 'HIGH' ? '🔴' : parsed.risk_level === 'MEDIUM' ? '🟡' : '🟢'
                lines.push(`**위험도:** ${emoji} ${parsed.risk_level}`)
                lines.push(``)
              }
            } catch {
              lines.push(a.result.slice(0, 500))
              lines.push(``)
            }
            lines.push(`> 모델: ${a.model} | 일시: ${a.created_at}`)
            lines.push(``)
          }
        }
      }
    }

    lines.push(`---`)
    lines.push(``)
    lines.push(`*이 보고서는 Patent Search AI에 의해 자동 생성되었습니다.*`)

    return lines.join('\n')
  }

  // ─── JSON bundle export ─────────────────────────────────────────────────────

  async exportJson(projectId: number): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: '프로젝트 번들 저장',
      defaultPath: `patent-project-${projectId}-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return null

    const bundle = this.projects.buildBundle(projectId)
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf-8')
    return filePath
  }

  // ─── JSON bundle import (restore) ──────────────────────────────────────────

  async importJson(): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: '프로젝트 번들 열기',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  }

  // ─── DB helpers ─────────────────────────────────────────────────────────────

  private getProjectSearches(projectId: number): SearchHistoryRow[] {
    return this.db.all<SearchHistoryRow>(
      `SELECT sh.id, sh.query, sh.strategy, sh.results_count, sh.claim_text, sh.created_at
       FROM search_history sh
       JOIN project_searches ps ON ps.search_id = sh.id
       WHERE ps.project_id = ?
       ORDER BY sh.created_at DESC`,
      [projectId]
    )
  }

  private getCandidates(searchId: number): CandidateRow[] {
    return this.db.all<CandidateRow>(
      `SELECT patent_number, title, source, rrf_score, stage1_rank, url
       FROM search_candidates WHERE search_id = ? ORDER BY stage1_rank ASC LIMIT 20`,
      [searchId]
    )
  }

  private getReranked(searchId: number): RerankRow[] {
    return this.db.all<RerankRow>(
      `SELECT patent_number, weighted_score, novelty_threat, inventive_threat, reasoning, stage2_rank
       FROM rerank_results WHERE search_id = ? ORDER BY stage2_rank ASC LIMIT 10`,
      [searchId]
    )
  }

  private getClaimCharts(searchId: number): ClaimChartRow[] {
    return this.db.all<ClaimChartRow>(
      `SELECT patent_number, chart_json FROM claim_charts WHERE search_id = ? LIMIT 5`,
      [searchId]
    )
  }

  private getAnalyses(searchId: number): AnalysisRow[] {
    return this.db.all<AnalysisRow>(
      `SELECT strategy, patent_number, result, model, created_at
       FROM analysis_results WHERE search_id = ? ORDER BY created_at DESC LIMIT 20`,
      [searchId]
    )
  }

  /** Build export path in app's userData directory as fallback. */
  static defaultExportPath(filename: string): string {
    return path.join(process.cwd(), filename)
  }
}
