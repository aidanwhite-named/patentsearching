/**
 * PdfProcessor — PDF text extraction + claim-aware context chunking.
 *
 * Context chunking strategy (Part 6.3):
 *   1. Split PDF text into ~500-char paragraphs.
 *   2. Score each paragraph by keyword overlap with claim elements.
 *   3. Return top-K scored paragraphs (up to maxChars total).
 *   4. This keeps LLM context small while preserving the most relevant evidence.
 */

import fs from 'fs'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse')

// pdf-parse v2 uses Web Workers internally — passing a Buffer causes
// "Unable to deserialize cloned data". Use file:// URL instead.

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
    throw new Error(`PDF file not found: ${filePath}`)
  }

  // pdf-parse v2: pass file:// URL to avoid Buffer Worker serialization error
  const fileUrl = 'file:///' + filePath.replace(/\\/g, '/')
  const parser = new PDFParse({ url: fileUrl })
  const [textResult, infoResult] = await Promise.all([
    parser.getText() as Promise<{ text: string }>,
    parser.getInfo() as Promise<{ total: number }>,
  ])
  await parser.destroy()

  return {
    text: textResult.text,
    pageCount: infoResult.total ?? 0,
    filePath,
    fileName: path.basename(filePath),
  }
}

// ─── Context chunking ─────────────────────────────────────────────────────────

/**
 * Extract claim-relevant paragraphs from PDF text.
 *
 * @param pdfText   Full extracted PDF text.
 * @param claimText The patent claim(s) to match against.
 * @param maxChars  Max total characters to return (default 6 000).
 * @returns Concatenated top-scoring paragraphs, separated by '\n\n'.
 */
export function extractRelevantChunks(
  pdfText: string,
  claimText: string,
  maxChars = 6000
): string {
  const paragraphs = splitIntoParagraphs(pdfText)
  const keywords   = extractKeywords(claimText)

  if (keywords.length === 0) {
    // No keywords — return first maxChars of text
    return pdfText.slice(0, maxChars).trim()
  }

  const scored: ScoredParagraph[] = paragraphs.map((text, index) => {
    const lc = text.toLowerCase()
    const score = keywords.reduce((acc, kw) => acc + (lc.includes(kw) ? 1 : 0), 0)
    return { text, score, index }
  })

  // Sort: highest score first, then original order for equal scores
  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  // Build result up to maxChars
  const selected: string[] = []
  let total = 0
  for (const item of scored) {
    if (item.score === 0) break          // no relevance — stop early
    if (total + item.text.length > maxChars) continue
    selected.push(item.text)
    total += item.text.length + 2        // +2 for '\n\n'
  }

  // Re-sort selected by original order for coherent reading
  selected.sort((a, b) => {
    const ai = paragraphs.indexOf(a)
    const bi = paragraphs.indexOf(b)
    return ai - bi
  })

  return selected.join('\n\n') || pdfText.slice(0, maxChars).trim()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitIntoParagraphs(text: string, minLen = 80): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length >= minLen)
}

/**
 * Pull meaningful keywords from claim text.
 * Filters stop-words and very short tokens.
 */
function extractKeywords(claimText: string): string[] {
  const STOP_WORDS = new Set([
    // Korean function words
    '있어서', '있는', '하는', '하여', '포함하는', '포함', '구성', '구성되는',
    '방법', '장치', '시스템', '단계', '청구항', '항',
    // English
    'the', 'a', 'an', 'of', 'in', 'is', 'are', 'for', 'to', 'and', 'or',
    'wherein', 'comprising', 'claim', 'method', 'device', 'system',
  ])

  const tokens = claimText
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))

  // Deduplicate
  return [...new Set(tokens)]
}
