/**
 * PdfProcessor — PDF text extraction using @opendataloader/pdf.
 * Writes converted output to a temp directory, reads back text, then cleans up.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { convert } = require('@opendataloader/pdf')

export interface PdfExtractResult {
  text: string
  pageCount: number
  filePath: string
  fileName: string
}

export interface ScoredParagraph {
  text: string
  score: number
  index: number
}

// ─── Text extraction ──────────────────────────────────────────────────────────

export async function extractPdfText(filePath: string): Promise<PdfExtractResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF 파일을 찾을 수 없습니다: ${filePath}`)
  }

  const tempDir = path.join(os.tmpdir(), `patent-pdf-${crypto.randomUUID()}`)
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    await convert([filePath], {
      outputDir: tempDir,
      format: 'json',
    })

    const outputFiles = fs.readdirSync(tempDir)
    const jsonFile = outputFiles.find((f) => f.endsWith('.json'))

    if (!jsonFile) {
      throw new Error('@opendataloader/pdf: JSON 출력 파일이 생성되지 않았습니다')
    }

    const raw = fs.readFileSync(path.join(tempDir, jsonFile), 'utf-8')
    const data = JSON.parse(raw)

    const { text, pageCount } = parseOutputJson(data)

    return {
      text,
      pageCount,
      filePath,
      fileName: path.basename(filePath),
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/** @opendataloader/pdf JSON 출력에서 텍스트와 페이지 수를 추출한다. */
function parseOutputJson(data: unknown): { text: string; pageCount: number } {
  if (typeof data !== 'object' || data === null) {
    return { text: String(data), pageCount: 0 }
  }

  const d = data as Record<string, unknown>

  // @opendataloader/pdf 형식: { "file name": "...", "number of pages": N, "kids": [...] }
  if (Array.isArray(d['kids']) && typeof d['number of pages'] === 'number') {
    const text = extractOpenDataLoaderText(d)
    return { text, pageCount: d['number of pages'] as number }
  }

  // pages 배열 형식: { pages: [{ text, content, ... }, ...] }
  if (Array.isArray(d.pages)) {
    const text = (d.pages as Record<string, unknown>[])
      .map((p) => (p.text ?? p.content ?? '') as string)
      .join('\n\n')
    return { text, pageCount: d.pages.length }
  }

  // 단일 텍스트 형식: { text, pageCount }
  if (typeof d.text === 'string') {
    return {
      text: d.text,
      pageCount: typeof d.pageCount === 'number' ? d.pageCount : 0,
    }
  }

  // content 필드 형식
  if (typeof d.content === 'string') {
    return {
      text: d.content,
      pageCount: typeof d.totalPages === 'number' ? d.totalPages : 0,
    }
  }

  // sections 배열 형식
  if (Array.isArray(d.sections)) {
    const text = (d.sections as Record<string, unknown>[])
      .map((s) => (s.text ?? s.content ?? '') as string)
      .join('\n\n')
    return { text, pageCount: 0 }
  }

  console.warn('[PdfProcessor] 알 수 없는 JSON 구조:', Object.keys(d))
  return { text: '', pageCount: 0 }
}

/**
 * @opendataloader/pdf 고유 형식에서 텍스트를 추출한다.
 *
 * 구조: { kids: [ { type, content?, "list items"?, kids? }, ... ] }
 * - type: "paragraph" | "heading" | "list" | "image" | "header" | "footer" | ...
 * - 텍스트 노드: content 필드
 * - 리스트 노드: "list items" 배열, 각 항목에 content + kids
 * - image / header / footer: 무시
 */
function extractOpenDataLoaderText(root: Record<string, unknown>): string {
  const lines: string[] = []

  // 무시할 타입
  const SKIP_TYPES = new Set(['image'])

  function visit(node: Record<string, unknown>): void {
    const type = String(node['type'] ?? '')

    if (SKIP_TYPES.has(type)) return

    // 헤더·푸터는 페이지 번호/제목 반복이라 건너뜀
    if (type === 'header' || type === 'footer') return

    // 텍스트 노드
    if (type === 'paragraph' || type === 'heading') {
      const content = String(node['content'] ?? '').trim()
      if (content) lines.push(content)
    }

    // 리스트 노드
    if (type === 'list') {
      const items = (node['list items'] as Record<string, unknown>[]) ?? []
      for (const item of items) {
        const content = String(item['content'] ?? '').trim()
        if (content) lines.push(content)
        // 리스트 항목 내부의 kids(중첩 문단 등)
        const itemKids = (item['kids'] as Record<string, unknown>[]) ?? []
        for (const k of itemKids) visit(k)
      }
      return  // list kids는 list items로만 처리
    }

    // 그 외 노드의 kids 재귀 처리
    const kids = (node['kids'] as Record<string, unknown>[]) ?? []
    for (const k of kids) visit(k)
  }

  const topKids = (root['kids'] as Record<string, unknown>[]) ?? []
  for (const kid of topKids) visit(kid)

  return lines.join('\n')
}

// ─── Context chunking ─────────────────────────────────────────────────────────

export function extractRelevantChunks(
  pdfText: string,
  claimText: string,
  maxChars = 6000,
): string {
  const paragraphs = splitIntoParagraphs(pdfText)
  const keywords   = extractKeywords(claimText)

  if (keywords.length === 0) return pdfText.slice(0, maxChars).trim()

  const scored: ScoredParagraph[] = paragraphs.map((text, index) => {
    const lc = text.toLowerCase()
    const score = keywords.reduce((acc, kw) => acc + (lc.includes(kw) ? 1 : 0), 0)
    return { text, score, index }
  })

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const selected: string[] = []
  let total = 0
  for (const item of scored) {
    if (item.score === 0) break
    if (total + item.text.length > maxChars) continue
    selected.push(item.text)
    total += item.text.length + 2
  }

  selected.sort((a, b) => paragraphs.indexOf(a) - paragraphs.indexOf(b))
  return selected.join('\n\n') || pdfText.slice(0, maxChars).trim()
}

function splitIntoParagraphs(text: string, minLen = 80): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length >= minLen)
}

function extractKeywords(claimText: string): string[] {
  const STOP_WORDS = new Set([
    '있어서', '있는', '하는', '하여', '포함하는', '포함', '구성', '구성되는',
    '방법', '장치', '시스템', '단계', '청구항', '항',
    'the', 'a', 'an', 'of', 'in', 'is', 'are', 'for', 'to', 'and', 'or',
    'wherein', 'comprising', 'claim', 'method', 'device', 'system',
  ])
  const tokens = claimText
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
  return [...new Set(tokens)]
}
