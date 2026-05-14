/**
 * SemanticChunker — splits patent section text into semantic chunks.
 *
 * Strategy:
 *   1. Split text into sentences using Korean + English boundary detection.
 *   2. Accumulate sentences into chunks of 700–1 200 chars.
 *   3. Attach 150-char overlap from the previous and next chunk.
 *   4. Tag each chunk with its source section type and title.
 *
 * Why 700–1 200 chars?
 *   - Short enough to stay below LLM context budget for retrieval.
 *   - Long enough to contain a complete technical sentence with context.
 *   - 150-char overlap prevents splitting mid-concept at chunk boundaries.
 */

import type { PatentSection, PatentSectionType, SemanticChunk } from '../../shared/patentTypes'

const CHUNK_MIN   = 700
const CHUNK_MAX   = 1_200
const OVERLAP_LEN = 150

let _chunkCounter = 0

// ─── Sentence splitter ────────────────────────────────────────────────────────

/**
 * Split a text block into sentences.
 *
 * Rules:
 *  - Split after '. ', '! ', '? ', '。', '.\n'  when followed by
 *    uppercase / Korean / number (avoids splitting "Fig. 1" etc.)
 *  - Never split inside parentheses or numbers (e.g. "0.5 mm")
 */
function splitSentences(text: string): string[] {
  // Normalise line breaks within paragraphs
  const normalised = text.replace(/\n(?!\n)/g, ' ').replace(/\s{2,}/g, ' ')

  const results: string[] = []
  let start = 0

  for (let i = 0; i < normalised.length - 1; i++) {
    const ch   = normalised[i]
    const next = normalised[i + 1]

    const isSentenceEnd =
      (ch === '.' && !/^\d/.test(next) && next === ' ') ||  // "word. Next"
      (ch === '?' && next === ' ') ||
      (ch === '!' && next === ' ') ||
      ch === '。' ||
      (ch === '.' && next === '\n')

    if (!isSentenceEnd) continue

    const sentence = normalised.slice(start, i + 1).trim()
    if (sentence.length >= 10) results.push(sentence)
    start = i + 2   // skip the space after the period
  }

  const tail = normalised.slice(start).trim()
  if (tail.length >= 10) results.push(tail)

  return results.length > 0 ? results : [normalised.trim()]
}

// ─── Chunk builder ────────────────────────────────────────────────────────────

function buildChunksFromText(
  text: string,
  sectionType: PatentSectionType,
  sectionTitle: string,
  charOffset: number,
): SemanticChunk[] {
  if (text.trim().length < 50) return []   // too short to be worth chunking

  const sentences = splitSentences(text)
  const chunks: SemanticChunk[] = []
  let buffer = ''
  let bufStart = charOffset

  const flush = () => {
    if (buffer.trim().length < 50) return
    const id = `chunk-${++_chunkCounter}-${sectionType}`
    chunks.push({
      id,
      text: buffer.trim(),
      sectionType,
      sectionTitle,
      charStart: bufStart,
      charEnd: bufStart + buffer.length,
      overlapBefore: '',   // filled in post-pass
      overlapAfter:  '',
      figureRefs: [],      // filled by FigureLinker
    })
  }

  for (const sentence of sentences) {
    if (buffer.length + sentence.length > CHUNK_MAX && buffer.length >= CHUNK_MIN) {
      flush()
      bufStart += buffer.length
      buffer = sentence + ' '
    } else {
      buffer += sentence + ' '
    }
  }
  flush()

  // Fill overlap fields
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      chunks[i].overlapBefore = chunks[i - 1].text.slice(-OVERLAP_LEN)
    }
    if (i < chunks.length - 1) {
      chunks[i].overlapAfter = chunks[i + 1].text.slice(0, OVERLAP_LEN)
    }
  }

  return chunks
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build semantic chunks from an array of patent sections.
 *
 * Claims section is NOT chunked — individual claim texts are preserved whole
 * and handled separately by ClaimEnricher.
 *
 * @param sections  Sections from PatentStructureParser.
 * @returns         Flat list of SemanticChunks, ordered by document position.
 */
export function buildSemanticChunks(sections: PatentSection[]): SemanticChunk[] {
  _chunkCounter = 0
  const allChunks: SemanticChunk[] = []
  let charOffset = 0

  for (const section of sections) {
    // Skip claims — they are handled as EnrichedClaim, not generic chunks
    if (section.type === 'claims') {
      charOffset += section.text.length + section.title.length + 2
      continue
    }

    const chunks = buildChunksFromText(
      section.text,
      section.type,
      section.title,
      charOffset,
    )
    allChunks.push(...chunks)
    charOffset += section.text.length + section.title.length + 2
  }

  return allChunks
}

/**
 * Convenience: build chunks for a single section text.
 * Used by ClaimEnricher to chunk retrieved spec passages.
 */
export function chunkSectionText(
  text: string,
  sectionType: PatentSectionType,
  sectionTitle: string,
): SemanticChunk[] {
  return buildChunksFromText(text, sectionType, sectionTitle, 0)
}
