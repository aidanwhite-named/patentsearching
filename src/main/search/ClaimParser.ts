/**
 * ClaimParser — extracts structured elements from a patent claim text.
 *
 * Strategy:
 *  1. Split the claim on semicolons, line breaks, and numbered/lettered
 *     list markers to identify individual elements.
 *  2. Assign importance weights heuristically (independent claims get ★★★;
 *     terms in preamble get lower weight than characterising part).
 *  3. Detect broad/ambiguous language patterns and flag them.
 */

import type { ClaimElement, ParsedClaim } from '../../shared/searchTypes'

// ─── Broad / ambiguous language patterns ──────────────────────────────────

const BROAD_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(any|every|all)\b/i,                        label: 'over-broad quantifier' },
  { re: /\b(substantially|approximately|about|nearly)\b/i, label: 'functional approximation' },
  { re: /\b(suitable|appropriate|various|plurality of)\b/i, label: 'vague modifier' },
  { re: /\b(or the like|and so on|etc\.?)\b/i,         label: 'open-ended enumeration' },
  { re: /\b(means for|configured to|adapted to)\b/i,   label: 'means-plus-function language' },
  { re: /유사한|관련된|적합한|적절한|다양한|등의?/,               label: '광범위 수식어' },
  { re: /또는 이와 유사한|기타 등등/,                           label: '개방형 열거' },
  { re: /수단으로서|하도록 구성된|위한 수단/,                       label: '기능적 한정' },
]

// ─── Element splitters ────────────────────────────────────────────────────

// Matches: "(a)", "(b)", "1.", "A.", "- ", "• "
const ELEMENT_SPLIT_RE = /(?:\n|\s*[;；]\s*)(?=[（(（][가-힣a-zA-Z\d][)）]|\d+\.\s|[A-Z]\.\s|[-•·]\s)/

// Matches: "(a) text", "A. text", "1. text"
const ELEMENT_PREFIX_RE = /^[（(（]([가-힣a-zA-Z\d])[)）]\s*|^([A-Z\d])\.\s+|^[-•·]\s+/

function detectTechnicalField(text: string): string {
  const patterns: [RegExp, string][] = [
    [/반도체|집적회로|트랜지스터|메모리|DRAM|NAND/i, '반도체/전자'],
    [/통신|네트워크|프로토콜|무선|LTE|5G|WiFi/i, '통신/네트워크'],
    [/소프트웨어|알고리즘|인공지능|머신러닝|AI|ML/i, '소프트웨어/AI'],
    [/의약|화합물|약물|치료|임상|therapeut/i, '바이오/의약'],
    [/기계|구동|모터|엔진|기어|베어링/i, '기계/동력'],
    [/화학|촉매|반응|합성|polymer/i, '화학/소재'],
    [/디스플레이|LCD|OLED|화면|픽셀/i, '디스플레이'],
  ]
  for (const [re, field] of patterns) {
    if (re.test(text)) return field
  }
  return '기술분야 불명'
}

// ─── Main parser ──────────────────────────────────────────────────────────

export function parseClaim(rawClaim: string): ParsedClaim {
  const trimmed = rawClaim.trim()
  const elements: ClaimElement[] = []
  const broadTerms: string[] = []

  // Detect broad language across full claim
  for (const { re, label } of BROAD_PATTERNS) {
    if (re.test(trimmed)) {
      const match = trimmed.match(re)
      if (match) broadTerms.push(`"${match[0]}" — ${label}`)
    }
  }

  // Split into candidate elements
  const parts = trimmed.split(ELEMENT_SPLIT_RE).filter((p) => p.trim().length > 0)

  if (parts.length <= 1) {
    // Fallback: split on semicolons and common Korean connectors
    const fallback = trimmed
      .split(/[;；]|,\s*(?=(?:그리고|및|또는|wherein|and|comprising))/i)
      .filter((p) => p.trim().length > 10)

    const ids = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    fallback.forEach((part, idx) => {
      elements.push({
        id: ids[idx] ?? String(idx + 1),
        text: part.trim(),
        importance: idx === 0 ? 3 : 2,
        isEssential: idx <= 2,
      })
    })
  } else {
    parts.forEach((part, idx) => {
      const prefixMatch = part.match(ELEMENT_PREFIX_RE)
      const id = prefixMatch?.[1] ?? prefixMatch?.[2] ?? String.fromCharCode(65 + idx)
      const text = part.replace(ELEMENT_PREFIX_RE, '').trim()

      if (!text) return

      // Independent claim preamble (first element) is essential
      elements.push({
        id,
        text,
        importance: idx === 0 ? 3 : (idx <= 2 ? 2 : 1),
        isEssential: idx <= 1,
      })
    })
  }

  // Ensure at least one element
  if (elements.length === 0) {
    elements.push({ id: 'A', text: trimmed, importance: 3, isEssential: true })
  }

  return {
    raw: trimmed,
    elements,
    broadTerms,
    technicalField: detectTechnicalField(trimmed),
  }
}

// ─── Query generation from parsed claim ───────────────────────────────────

/** Generate BM25/vector query strings — one per element + combined. */
export function buildSearchQueries(claim: ParsedClaim): string[] {
  const queries: string[] = []

  // Full claim (weighted toward high-importance elements)
  const highImportance = claim.elements
    .filter((e) => e.importance >= 2)
    .map((e) => e.text)
  if (highImportance.length > 0) queries.push(highImportance.join(' '))

  // Per-element queries for essential elements
  for (const el of claim.elements) {
    if (el.isEssential) queries.push(el.text)
  }

  return Array.from(new Set(queries)).slice(0, 5)
}
