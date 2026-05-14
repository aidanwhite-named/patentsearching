/**
 * PatentStructureParser — rule-based section parser for Korean/English patents.
 *
 * Strategy:
 *   1. Normalise potential heading lines (collapse internal spaces, strip 【】).
 *   2. Match against section-type patterns (longest-match wins).
 *   3. Split document text at matched heading boundaries.
 *   4. Within the claims section, split individual claim texts.
 *
 * Handles:
 *   - Korean doc with spaced headers: "기 술 분 야"
 *   - Korean doc with bracket headers: "【기술분야】"
 *   - English headers: "TECHNICAL FIELD"
 *   - Mixed formatting from pdf-parse output
 */

import type {
  PatentSection,
  PatentSectionType,
  PatentStructure,
  FigureRef,
} from '../../shared/patentTypes'

// ─── Section heading detection ────────────────────────────────────────────────

interface SectionDef {
  type: PatentSectionType
  /** Normalised (no-space, lowercase) strings that identify this section. */
  keys: string[]
}

const SECTION_DEFS: SectionDef[] = [
  {
    type: 'claims',
    keys: ['청구범위', '청구항', '특허청구범위', 'claims', 'claimsoftheinvention'],
  },
  {
    type: 'abstract',
    keys: ['요약서', '요약', 'abstract', 'summary'],
  },
  {
    type: 'technical_field',
    keys: ['기술분야', '발명의기술분야', 'technicalfield', 'fieldoftheinvention', 'field'],
  },
  {
    type: 'background',
    keys: ['배경기술', '종래기술', '기술배경', 'backgroundart', 'background', 'priorart'],
  },
  {
    type: 'technical_problem',
    keys: [
      '기술적과제', '발명이이루고자하는기술적과제', '해결하려는과제',
      '발명의내용', '발명의목적', '과제',
      'technicalproblem', 'problemtobesolved', 'summaryoftheinvention',
    ],
  },
  {
    type: 'solution',
    keys: [
      '과제의해결수단', '해결수단', '발명의구성', '기술적수단',
      'solutiontoproblem', 'meansforsolvingtheproblem', 'disclosure',
    ],
  },
  {
    type: 'effects',
    keys: [
      '발명의효과', '효과', '유리한효과',
      'effectsoftheinvention', 'advantageouseffects',
    ],
  },
  {
    type: 'figures_description',
    keys: [
      '도면의간단한설명', '도면설명', '도면의설명',
      'briefdescriptionofdrawings', 'briefdescriptionoffigures', 'drawingsdescription',
    ],
  },
  {
    type: 'examples',
    keys: ['실시예', '실시형태', '구체적실시예', 'examples', 'embodiments', 'specificembodiment'],
  },
  {
    type: 'detailed_description',
    keys: [
      '발명을실시하기위한구체적인내용', '발명의실시를위한형태', '발명의상세한설명',
      '구체적인내용', '발명의설명', '상세한설명',
      'detaileddescription', 'bestmode', 'modeofinvention',
    ],
  },
]

/** Normalise a line for heading comparison: remove spaces, brackets, lowercase. */
function normaliseLine(line: string): string {
  return line
    .replace(/[【】\[\]【】「」『』〔〕()（）]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim()
}

function detectSectionType(line: string): PatentSectionType | null {
  const norm = normaliseLine(line)
  if (norm.length < 2 || norm.length > 60) return null

  // "청구항 1." / "Claim 1." are individual claim lines, NOT section headings.
  // Without this guard, every claim line is mistaken for a new 'claims' section
  // because "청구항1.".startsWith("청구항") is true — causing only 1 claim to be parsed.
  if (/^(?:청구항|claim)\s*\d/i.test(line.trim())) return null

  for (const def of SECTION_DEFS) {
    for (const key of def.keys) {
      if (norm === key || norm.startsWith(key) || key.startsWith(norm)) {
        return def.type
      }
    }
  }
  return null
}

// ─── Claim splitter ───────────────────────────────────────────────────────────

/** Split the raw claims text into individual claim strings. */
function splitClaims(rawClaims: string): string[] {
  dbg('청구항 분리 시작 — 원본 청구항 텍스트 길이:', rawClaims.length, '자')
  dbg('  청구항 텍스트 첫 300자:', rawClaims.slice(0, 300))

  // Pattern: "청구항 N." or "Claim N." at start of line
  const CLAIM_START = /(?:^|\n)\s*(?:청구항|Claim)\s+(\d+)[.\s]/gi
  const matches = [...rawClaims.matchAll(CLAIM_START)]

  if (matches.length === 0) {
    dbg('  "청구항 N" / "Claim N" 패턴 없음 — 번호 패턴("1. ") 폴백 시도')
    // Fallback: split on numbered lines "1. " / "1) "
    const numberedRe = /(?:^|\n)\s*(\d+)[.)]\s+/g
    const numbered = [...rawClaims.matchAll(numberedRe)]
    if (numbered.length > 0) {
      const claims = numbered.map((m, i) => {
        const start = m.index! + m[0].length
        const end = numbered[i + 1]?.index ?? rawClaims.length
        return rawClaims.slice(start, end).trim()
      }).filter((c) => c.length > 0)
      dbg(`  번호 패턴으로 ${claims.length}개 청구항 추출`)
      return claims
    }
    dbg('  구조 없음 — 전체 텍스트를 단일 청구항으로 처리')
    return rawClaims.trim() ? [rawClaims.trim()] : []
  }

  const claims = matches.map((m, i) => {
    const start = m.index! + m[0].length
    const end = matches[i + 1]?.index ?? rawClaims.length
    return rawClaims.slice(start, end).trim()
  }).filter((c) => c.length > 0)

  dbg(`  "청구항 N" 패턴으로 ${claims.length}개 청구항 추출`)
  claims.forEach((c, i) => {
    dbg(`  [청구항 ${i + 1}] 첫 80자: ${c.slice(0, 80)}`)
  })

  return claims
}

// ─── Figure reference extraction ──────────────────────────────────────────────

/**
 * Extract figure references mentioned in the figures_description section.
 * Returns refs without chunkIds (those are filled by FigureLinker later).
 */
function extractFigureRefsFromSection(figSection: string): FigureRef[] {
  const refs: FigureRef[] = []
  const seen = new Set<string>()

  // Pattern: "도 1", "도1", "도면 1", "FIG. 1", "FIG 1", "Fig.1"
  const FIG_RE = /(?:도\s*면?\s*(\d+[a-zA-Z]?))|(?:FIG\.?\s*(\d+[a-zA-Z]?))/gi

  // Split figure section into lines and look for "도 N은/는/: ..." descriptions
  const lines = figSection.split('\n')
  for (const line of lines) {
    const m = line.match(
      /^(?:도\s*면?\s*(\d+[a-zA-Z]?))\s*(?:은|는|이|가|:)\s*(.{0,200})/
    )
    if (m) {
      const num = m[1]
      const key = `도 ${num}`
      if (!seen.has(key)) {
        seen.add(key)
        refs.push({ number: key, description: m[2].trim(), relatedChunkIds: [] })
      }
      continue
    }
    // English: "FIG. 1 is/shows ..."
    const mEn = line.match(
      /^FIG\.?\s*(\d+[a-zA-Z]?)\s+(?:is|shows|illustrates)\s+(.{0,200})/i
    )
    if (mEn) {
      const key = `FIG. ${mEn[1]}`
      if (!seen.has(key)) {
        seen.add(key)
        refs.push({ number: key, description: mEn[2].trim(), relatedChunkIds: [] })
      }
    }
  }

  // Collect any remaining figure numbers that appear but have no description
  const allFigs = [...figSection.matchAll(FIG_RE)]
  for (const m of allFigs) {
    const num = m[1] ?? m[2]
    const key = m[1] ? `도 ${num}` : `FIG. ${num}`
    if (!seen.has(key)) {
      seen.add(key)
      refs.push({ number: key, description: '', relatedChunkIds: [] })
    }
  }

  return refs
}

// ─── Debug logger ─────────────────────────────────────────────────────────────

function dbg(label: string, ...rest: unknown[]): void {
  const prefix = `[PatentParser] ${label}`
  if (rest.length === 0) {
    console.log(prefix)
  } else {
    console.log(prefix, ...rest)
  }
}

// ─── Date extraction ─────────────────────────────────────────────────────────

/**
 * 특허 서지사항에서 날짜를 추출해 YYYY-MM-DD 형식으로 반환.
 *
 * 우선순위:
 *   1순위 — (30) 우선권주장 항목의 날짜
 *   2순위 — (22) 심사청구일자 / 출원일자 항목의 날짜
 *   3순위 — 공개일·등록일·Filing Date 등 일반 키워드
 *   폴백  — 헤더에 등장하는 첫 번째 ISO-like 날짜
 */
function extractPatentDate(rawText: string): string | undefined {
  // 서지사항은 보통 앞 6,000자 이내에 위치
  const header = rawText.slice(0, 6000)

  function normalize(y: string, m: string, d: string): string {
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD
  const isoRe = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/

  function findDate(keyword: string, searchLen = 120): string | undefined {
    const idx = header.indexOf(keyword)
    if (idx < 0) return undefined
    const nearby = header.slice(idx, idx + searchLen)
    const m = nearby.match(isoRe)
    if (!m) return undefined
    const year = parseInt(m[1])
    if (year > 1980 && year <= new Date().getFullYear() + 1) {
      return normalize(m[1], m[2], m[3])
    }
    return undefined
  }

  // 1순위: (30) 우선권주장 — WIPO 서지코드 (30)
  const d30 = findDate('(30)') ?? findDate('우선권주장')
  if (d30) { dbg('날짜 추출 성공 [1순위 우선권주장]:', d30); return d30 }

  // 2순위: (22) 심사청구일자 / 출원일자 — WIPO 서지코드 (22)
  const d22 =
    findDate('(22)') ??
    findDate('심사청구일자') ??
    findDate('출원일자')
  if (d22) { dbg('날짜 추출 성공 [2순위 출원일]:', d22); return d22 }

  // 3순위: 공개일·등록일 등 일반 키워드
  for (const kw of [
    '공개일', '공고일', '등록일', '출원일',
    'Publication Date', 'Filing Date', 'Date of Patent',
  ]) {
    const d = findDate(kw)
    if (d) { dbg(`날짜 추출 성공 [3순위 키워드="${kw}"]`, d); return d }
  }

  // 폴백: 헤더 첫 번째 ISO-like 날짜
  const m = header.match(isoRe)
  if (m) {
    const year = parseInt(m[1])
    if (year > 1980 && year <= new Date().getFullYear() + 1) {
      const fallback = normalize(m[1], m[2], m[3])
      dbg('날짜 추출 성공 [폴백 ISO 날짜]:', fallback)
      return fallback
    }
  }
  dbg('날짜 추출 실패 — 서지사항에서 날짜를 찾을 수 없음')
  dbg('  헤더 샘플 (처음 500자):', header.slice(0, 500))
  return undefined
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse raw PDF text into a structured PatentStructure.
 *
 * @param rawText  Full text from pdf-parse (may have extra whitespace).
 * @param filePath Original PDF file path.
 * @param pageCount From pdf-parse numpages.
 */
export function parsePatentStructure(
  rawText: string,
  filePath = '',
  pageCount = 0,
): PatentStructure {
  // ── 원본 텍스트 디버깅 ──────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`)
  console.log(`[PatentParser] PDF 파싱 시작`)
  console.log(`  파일: ${filePath}`)
  console.log(`  페이지: ${pageCount}`)
  console.log(`  전체 텍스트 길이: ${rawText.length}자`)
  console.log(`  줄 수: ${rawText.split('\n').length}줄`)
  console.log(`\n  [원본 텍스트 — 처음 1500자]\n`)
  console.log(rawText.slice(0, 1_500))
  console.log('='.repeat(70))

  const lines = rawText.split('\n')
  const sections: PatentSection[] = []

  let currentType: PatentSectionType = 'unknown'
  let currentTitle = ''
  let currentLines: string[] = []

  const flush = () => {
    const text = currentLines.join('\n').trim()
    if (text.length > 0) {
      sections.push({ type: currentType, title: currentTitle, text })
    }
    currentLines = []
  }

  for (const line of lines) {
    const detected = detectSectionType(line)
    if (detected) {
      flush()
      currentType = detected
      currentTitle = line.trim()
    } else {
      currentLines.push(line)
    }
  }
  flush()

  // Extract title from first non-empty line if not already captured
  const titleSection = sections.find((s) => s.type === 'title')
  let title = titleSection?.text.trim() ?? ''
  if (!title) {
    // Try first line of document
    title = rawText.split('\n').find((l) => l.trim().length > 5)?.trim() ?? ''
  }

  // Find claims section — merge multiple in case the parser split them
  const claimsSections = sections.filter((s) => s.type === 'claims')
  const claimsRaw = claimsSections.map((s) => s.text).join('\n')
  const claims = claimsRaw.trim() ? splitClaims(claimsRaw) : []

  // Extract figure refs from figures_description section
  const figSection = sections.find((s) => s.type === 'figures_description')
  const figureRefs = figSection ? extractFigureRefsFromSection(figSection.text) : []

  const publicationDate = extractPatentDate(rawText)

  // ── 파싱 결과 요약 ─────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`[PatentParser] 파싱 결과 요약`)
  console.log(`  발명 제목: ${title.slice(0, 80)}`)
  console.log(`  섹션 수  : ${sections.length}개`)
  sections.forEach((s) =>
    console.log(`    - [${s.type.padEnd(20)}] ${s.title.slice(0, 50)} (${s.text.length}자)`),
  )
  console.log(`  청구항 수: ${claims.length}개`)
  console.log(`  도면 참조: ${figureRefs.length}개`)
  console.log(`  날짜     : ${publicationDate ?? '추출 실패'}`)
  console.log('─'.repeat(70))

  return {
    title,
    sections,
    claims,
    figureRefs,
    rawText,
    pageCount,
    filePath,
    ...(publicationDate ? { publicationDate } : {}),
  }
}
