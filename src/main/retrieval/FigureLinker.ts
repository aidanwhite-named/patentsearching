/**
 * FigureLinker — connects figure references to semantic chunks.
 *
 * Two passes:
 *   1. Scan every chunk for figure-number mentions → populate chunk.figureRefs
 *   2. Update PatentStructure.figureRefs[].relatedChunkIds
 *
 * Supported formats:
 *   Korean : 도 1, 도1, 도면 1, 도면1, 도 1a, (도 1)
 *   English: FIG. 1, FIG 1, Fig.1, Fig 1, FIG. 1A, (FIG. 1)
 */

import type { SemanticChunk, FigureRef, PatentStructure } from '../../shared/patentTypes'

// ─── Regex ────────────────────────────────────────────────────────────────────

const FIGURE_RE = /(?:\(?\s*도\s*면?\s*(\d+[a-zA-Z]?)\s*\)?)|(?:\(?\s*FIG\.?\s*(\d+[a-zA-Z]?)\s*\)?)/gi

function normFigKey(raw: string): string {
  // Normalise "도1" → "도 1", "FIG.1A" → "FIG. 1A"
  const m = raw.match(/도\s*면?\s*(\d+[a-zA-Z]?)/i)
  if (m) return `도 ${m[1]}`
  const me = raw.match(/FIG\.?\s*(\d+[a-zA-Z]?)/i)
  if (me) return `FIG. ${me[1]}`
  return raw.trim()
}

// ─── Link figures into chunks ─────────────────────────────────────────────────

/**
 * Mutates chunks in-place: fills chunk.figureRefs.
 * Returns an updated figureRefs list with relatedChunkIds populated.
 */
export function linkFiguresToChunks(
  chunks: SemanticChunk[],
  figureRefs: FigureRef[],
): FigureRef[] {
  // Build a mutable map keyed by normalised figure number
  const refMap = new Map<string, FigureRef>()
  for (const ref of figureRefs) {
    refMap.set(normFigKey(ref.number), { ...ref, relatedChunkIds: [] })
  }

  // Pass 1 — scan chunks, fill chunk.figureRefs and refMap.relatedChunkIds
  for (const chunk of chunks) {
    const mentions = new Set<string>()
    const matches = [...chunk.text.matchAll(FIGURE_RE)]

    for (const m of matches) {
      const raw = m[0]
      const key = normFigKey(raw)
      mentions.add(key)

      // Auto-register figure if not already in the list
      if (!refMap.has(key)) {
        refMap.set(key, { number: key, description: '', relatedChunkIds: [] })
      }
      const ref = refMap.get(key)!
      if (!ref.relatedChunkIds.includes(chunk.id)) {
        ref.relatedChunkIds.push(chunk.id)
      }
    }

    chunk.figureRefs = [...mentions]
  }

  // Sort by figure number
  return [...refMap.values()].sort((a, b) => {
    const na = parseInt(a.number.replace(/\D/g, ''), 10) || 0
    const nb = parseInt(b.number.replace(/\D/g, ''), 10) || 0
    return na - nb
  })
}

/**
 * Apply figure linking to a full PatentStructure + its chunks.
 * Mutates both chunks (figureRefs) and structure.figureRefs (relatedChunkIds).
 */
export function applyFigureLinks(
  structure: PatentStructure,
  chunks: SemanticChunk[],
): void {
  structure.figureRefs = linkFiguresToChunks(chunks, structure.figureRefs)
}
