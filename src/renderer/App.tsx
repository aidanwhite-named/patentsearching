import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import ProviderSettings from './components/ProviderSettings'
import SearchPanel from './components/SearchPanel'
import ErrorBoundary from './components/ErrorBoundary'
import ToastContainer from './components/ToastContainer'
import { useSearchStore } from './store/searchStore'
import { useProjectStore } from './store/projectStore'
import { useWorkspaceStore } from './store/workspaceStore'
import { toast } from './store/toastStore'
import type { SearchQuery } from '../shared/searchTypes'
import type { EnrichedClaim } from '../shared/patentTypes'

// ─── Electron File 타입 확장 (드래그앤드롭 경로 접근용) ──────────────────────

interface ElectronFile extends File {
  path: string
}

// ─── Icon Buttons ─────────────────────────────────────────────────────────────

function IconBtn({ onClick, title, children, danger }: {
  onClick: () => void; title: string; children: React.ReactNode; danger?: boolean
}): React.ReactElement {
  return (
    <button onClick={onClick} title={title}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors
                 ${danger
                   ? 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                   : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}

function GearIcon(): React.ReactElement {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066
           c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756
           2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724
           1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0
           00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572
           c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826
           -3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

// ─── Source chips label map ────────────────────────────────────────────────────

const SOURCE_LABELS: Record<SearchQuery['sources'][number], string> = {
  patentsview: 'USPTO',
  kipris: 'KIPRIS',
  openalex: 'OpenAlex',
}

// ─── PDF Pipeline ─────────────────────────────────────────────────────────────

type PipelineStep = 'idle' | 'parsing' | 'chunking' | 'enriching' | 'building' | 'done' | 'error'

const STEP_LABELS: Record<PipelineStep, string> = {
  idle: '',
  parsing: '구조 파싱 중...',
  chunking: '청킹 중...',
  enriching: 'LLM 분석 중...',
  building: '트리 생성 중...',
  done: '분석 완료',
  error: '오류 발생',
}

const STEP_PCT: Record<PipelineStep, number> = {
  idle: 0, parsing: 20, chunking: 45, enriching: 75, building: 95, done: 100, error: 0,
}

// ─── PDF Upload Area (클릭 + 드래그앤드롭) ────────────────────────────────────

function PdfUploadArea(): React.ReactElement {
  const { pdfPath, pdfPageCount, pdfLoading, setPdf, clearPdf, setPdfLoading } = useProjectStore()
  const {
    patentStructure, enrichedClaims,
    setPatentStructure, setSemanticChunks, setEnrichedClaims,
    setEnrichmentLoading, initFromClaimText,
  } = useWorkspaceStore()
  const { setClaimText, setCutoffDate, getSelectedTemplate } = useSearchStore()

  const [step, setStep] = useState<PipelineStep>('idle')
  const [isDragging, setIsDragging] = useState(false)

  // 핵심 PDF 처리 로직 — 경로를 받아 파이프라인 실행
  const processPdf = useCallback(async (filePath: string) => {
    setStep('parsing')
    setPdfLoading(true)
    setSemanticChunks([])
    setEnrichedClaims([])
    setPatentStructure(null)

    try {
      const structure = await window.patentAPI.claim.parseStructure(filePath)
      setPdf(filePath, structure.rawText, structure.pageCount)
      setPatentStructure(structure)

      // 추출된 날짜를 기준일로 자동 설정 (우선권주장 > 심사청구일자 순)
      if (structure.publicationDate) {
        setCutoffDate(structure.publicationDate)
        toast.info(`기준일 자동 설정: ${structure.publicationDate}`)
      }

      setStep('chunking')
      const { chunks, figureRefs } = await window.patentAPI.claim.semanticChunk(
        structure.sections, structure.figureRefs,
      )
      setSemanticChunks(chunks)
      setPatentStructure({ ...structure, figureRefs })

      setStep('enriching')
      setEnrichmentLoading(true)
      const selectedTemplate = getSelectedTemplate()
      const enrichResult = await window.patentAPI.claim.enrich({
        patentStructure: { ...structure, figureRefs },
        chunks,
        searchInstruction: selectedTemplate?.instruction ?? '',
      })
      setEnrichedClaims(enrichResult.enrichedClaims)
      setEnrichmentLoading(false)

      setStep('building')
      const claimText = structure.claims.join('\n\n')
      if (claimText) {
        initFromClaimText(claimText)
        setClaimText(claimText)
      }

      setStep('done')
      toast.success(
        `분석 완료 — ${structure.claims.length}개 청구항, ${chunks.length}개 청크, ` +
        `${enrichResult.enrichedClaims.length}개 강화`,
      )
    } catch (err) {
      setStep('error')
      setEnrichmentLoading(false)
      toast.error(`PDF 처리 실패: ${String(err)}`)
    } finally {
      setPdfLoading(false)
    }
  }, [
    setPdf, setPdfLoading, setPatentStructure, setSemanticChunks,
    setEnrichedClaims, setEnrichmentLoading, initFromClaimText, setClaimText, setCutoffDate,
  ])

  // 클릭으로 파일 선택
  const handleOpenPdf = useCallback(async () => {
    const filePath = await window.patentAPI.pdf.openDialog()
    if (filePath) processPdf(filePath)
  }, [processPdf])

  // 드래그앤드롭 이벤트 핸들러
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files[0] as ElectronFile | undefined
    if (!file) return
    // Electron은 File 객체에 .path 속성을 제공
    const filePath = file.path
    if (!filePath || !filePath.toLowerCase().endsWith('.pdf')) {
      toast.error('PDF 파일만 지원합니다')
      return
    }
    processPdf(filePath)
  }, [processPdf])

  const handleClear = useCallback(() => {
    clearPdf()
    setPatentStructure(null)
    setSemanticChunks([])
    setEnrichedClaims([])
    setStep('idle')
  }, [clearPdf, setPatentStructure, setSemanticChunks, setEnrichedClaims])

  const fileName = pdfPath?.split(/[\\/]/).pop()
  const isRunning = pdfLoading

  return (
    <div className="flex flex-col h-full justify-between p-4">
      <button
        onClick={handleOpenPdf}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isRunning}
        className={`flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed
                   transition-all disabled:opacity-60 disabled:cursor-not-allowed min-h-[120px]
                   ${isDragging
                     ? 'border-blue-400 bg-blue-50 text-blue-600 scale-[1.01]'
                     : 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50'
                   }`}
      >
        {isRunning ? (
          <>
            <span className="text-2xl">⏳</span>
            <span className="text-xs font-medium">{STEP_LABELS[step]}</span>
          </>
        ) : isDragging ? (
          <>
            <span className="text-2xl">📥</span>
            <span className="text-xs font-medium">여기에 놓으세요</span>
          </>
        ) : fileName ? (
          <>
            <span className="text-2xl">📄</span>
            <span className="text-xs text-center font-mono truncate max-w-[160px]">{fileName}</span>
            <span className="text-[10px] text-gray-400">
              {pdfPageCount}p
              {patentStructure && ` · ${patentStructure.claims.length}개 청구항`}
              {enrichedClaims.length > 0 && ` · 분석 ${enrichedClaims.length}개`}
            </span>
          </>
        ) : (
          <>
            <span className="text-2xl opacity-40">📄</span>
            <span className="text-xs">PDF 업로드</span>
            <span className="text-[10px] text-gray-400">클릭 또는 드래그</span>
          </>
        )}
      </button>

      {isRunning && (
        <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all duration-500"
            style={{ width: `${STEP_PCT[step]}%` }}
          />
        </div>
      )}

      {fileName && !isRunning && (
        <div className="mt-2 flex items-center justify-between">
          <span className={`text-[10px] ${
            step === 'done' ? 'text-green-500' : step === 'error' ? 'text-red-400' : 'text-gray-400'
          }`}>
            {step === 'done' ? '✓ 분석 완료' : step === 'error' ? '✕ 오류' : ''}
          </span>
          <button onClick={handleClear} className="text-[10px] text-gray-400 hover:text-red-400">
            초기화
          </button>
        </div>
      )}
    </div>
  )
}

// ─── 수동 입력 청구항 간이 파서 ────────────────────────────────────────────────

interface BasicClaim {
  num: number
  isIndependent: boolean
  parentNum?: number
  text: string
}

function parseManualClaims(text: string): BasicClaim[] {
  const CLAIM_RE = /(?:^|\n)\s*(?:청구항|Claim)\s+(\d+)[.\s:]/gi
  const matches = [...text.matchAll(CLAIM_RE)]
  if (matches.length === 0) return []

  return matches.map((m, i) => {
    const num = parseInt(m[1])
    const start = m.index! + m[0].length
    const end = matches[i + 1]?.index ?? text.length
    const claimText = text.slice(start, end).trim()

    const depRe = /(?:제\s*(\d+)\s*항|청구항\s*(\d+))\s*(?:에\s*있어서|에\s*따른|내지)/i
    const depMatch = claimText.match(depRe)
    const isIndependent = !depMatch
    const parentNum = depMatch ? parseInt(depMatch[1] ?? depMatch[2] ?? '0') : undefined

    return { num, isIndependent, parentNum, text: claimText }
  })
}

// ─── 청구항 구조 우측 패널 ────────────────────────────────────────────────────

function ClaimStructurePanel(): React.ReactElement {
  const { enrichedClaims } = useWorkspaceStore()
  const { claimText } = useSearchStore()
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [expandedComponents, setExpandedComponents] = useState<Set<number>>(new Set())

  const manualClaims = useMemo(
    () => (enrichedClaims.length > 0 ? [] : parseManualClaims(claimText)),
    [claimText, enrichedClaims.length],
  )

  const toggle = (num: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })

  const toggleComp = (num: number) =>
    setExpandedComponents((prev) => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })

  const indepCount = enrichedClaims.filter((c) => c.isIndependent).length
  const depCount   = enrichedClaims.length - indepCount
  const hasContent = enrichedClaims.length > 0 || manualClaims.length > 0

  // ── 강화된 청구항 트리 노드 ─────────────────────────────────────────────
  function renderEnrichedNode(claim: EnrichedClaim, depth: number): React.ReactNode {
    const children = enrichedClaims.filter((c) => c.parentClaimNumber === claim.claimNumber)
    const isCollapsed    = collapsed.has(claim.claimNumber)
    const isCompExpanded = expandedComponents.has(claim.claimNumber)
    const hasChildren    = children.length > 0
    const hasComponents  = claim.components.length > 0
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    return (
      <div key={claim.claimNumber}>
        {/* 청구항 행 */}
        <div
          className={`flex items-start gap-1.5 py-1.5 pr-3 rounded-lg transition-colors group
                      ${claim.isIndependent ? 'hover:bg-blue-50/60' : 'hover:bg-gray-50'}`}
          style={{ paddingLeft: `${10 + depth * 20}px` }}
        >
          {/* 접힘 토글 */}
          <button
            onClick={() => hasChildren && toggle(claim.claimNumber)}
            className={`mt-0.5 text-[10px] text-gray-300 w-3 shrink-0
                        ${!hasChildren ? 'invisible' : 'hover:text-gray-500'}`}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>

          {/* 번호 뱃지 */}
          <span
            onClick={() => hasComponents && toggleComp(claim.claimNumber)}
            className={`text-[11px] font-bold rounded px-1.5 py-0.5 shrink-0 leading-none cursor-pointer
                        ${claim.isIndependent
                          ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                          : 'bg-gray-100 text-gray-500'}`}
          >
            {claim.claimNumber}
          </span>

          {/* 본문 요약 */}
          <div className="flex-1 min-w-0">
            <p
              onClick={() => hasComponents && toggleComp(claim.claimNumber)}
              className="text-[11px] text-gray-700 leading-snug truncate cursor-pointer"
            >
              {claim.overallPurpose || claim.originalClaim.slice(0, 80)}
            </p>

            {/* 구성요소 (A)(B)(C) */}
            {isCompExpanded && hasComponents && (
              <div className="mt-1 space-y-0.5">
                {claim.components.map((comp, ci) => (
                  <div key={ci} className="flex items-start gap-1 text-[10px]">
                    <span className="shrink-0 font-bold text-blue-500 w-5">
                      ({ALPHA[ci] ?? ci})
                    </span>
                    <span className="text-gray-500 leading-snug">{comp.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 독립항 뱃지 */}
          {claim.isIndependent && (
            <span className="text-[9px] text-blue-400 shrink-0 opacity-0 group-hover:opacity-100 mt-0.5">
              독립항
            </span>
          )}
        </div>

        {/* 종속항 자식 */}
        {!isCollapsed && children.map((c) => renderEnrichedNode(c, depth + 1))}
      </div>
    )
  }

  // ── 수동 입력 청구항 트리 노드 ──────────────────────────────────────────
  function renderBasicNode(claim: BasicClaim, allClaims: BasicClaim[], depth: number): React.ReactNode {
    const children = allClaims.filter((c) => c.parentNum === claim.num)
    const isCollapsed = collapsed.has(claim.num)
    const hasChildren = children.length > 0

    return (
      <div key={claim.num}>
        <div
          className={`flex items-start gap-1.5 py-1.5 pr-3 rounded-lg transition-colors
                      ${claim.isIndependent ? 'hover:bg-blue-50/60' : 'hover:bg-gray-50'}`}
          style={{ paddingLeft: `${10 + depth * 20}px` }}
        >
          <button
            onClick={() => hasChildren && toggle(claim.num)}
            className={`mt-0.5 text-[10px] text-gray-300 w-3 shrink-0
                        ${!hasChildren ? 'invisible' : 'hover:text-gray-500'}`}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span
            className={`text-[11px] font-bold rounded px-1.5 py-0.5 shrink-0 leading-none
                        ${claim.isIndependent
                          ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                          : 'bg-gray-100 text-gray-500'}`}
          >
            {claim.num}
          </span>
          <p className="flex-1 min-w-0 text-[11px] text-gray-600 leading-snug line-clamp-2">
            {claim.text.slice(0, 100)}
          </p>
        </div>
        {!isCollapsed && children.map((c) => renderBasicNode(c, allClaims, depth + 1))}
      </div>
    )
  }

  const enrichedRoots = enrichedClaims.filter((c) => c.isIndependent)
  const basicRoots    = manualClaims.filter((c) => c.isIndependent)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-2.5 border-b border-gray-100 shrink-0 bg-gray-50/80">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-600">청구항 구조</span>
          {enrichedClaims.length > 0 ? (
            <span className="text-[10px] text-gray-400">
              독립항 {indepCount}개 · 종속항 {depCount}개
              <span className="ml-1 text-blue-400">(LLM 분석)</span>
            </span>
          ) : manualClaims.length > 0 ? (
            <span className="text-[10px] text-gray-400">
              독립항 {basicRoots.length}개 · 종속항 {manualClaims.length - basicRoots.length}개
              <span className="ml-1 text-amber-400">(텍스트 파싱)</span>
            </span>
          ) : null}
        </div>
        {enrichedClaims.length > 0 && (
          <p className="text-[9px] text-gray-400 mt-0.5">번호 클릭 → 구성요소 (A)(B)(C) 펼치기</p>
        )}
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto py-1">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-3xl opacity-20">📋</span>
            <p className="text-[11px] text-center text-gray-400 px-4 leading-relaxed">
              청구항을 입력하거나<br />PDF를 업로드하면<br />구조가 표시됩니다
            </p>
          </div>
        ) : enrichedClaims.length > 0 ? (
          <div className="px-1">
            {enrichedRoots.map((c) => renderEnrichedNode(c, 0))}
          </div>
        ) : (
          <div className="px-1">
            {basicRoots.map((c) => renderBasicNode(c, manualClaims, 0))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Home View ────────────────────────────────────────────────────────────────

function HomeView(): React.ReactElement {
  const store = useSearchStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    store.loadSearchTemplates()
  }, [])

  const handleSearch = useCallback(() => {
    if (!store.claimText.trim()) return
    store.startSearch()
  }, [store])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSearch()
  }, [handleSearch])

  const toggleSource = useCallback((src: SearchQuery['sources'][number]) => {
    const active = store.selectedSources.includes(src)
    const next = active
      ? store.selectedSources.filter((s) => s !== src)
      : [...store.selectedSources, src]
    store.setSelectedSources(next as typeof store.selectedSources)
  }, [store])

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── 좌측: 로고 + 입력 카드 ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center pb-8 px-5 overflow-y-auto min-w-0">

        {/* 로고 */}
        <div className="mb-5 text-center">
          <h1 className="text-3xl font-light text-gray-800 tracking-tight">Patent Search</h1>
          <p className="mt-1 text-xs text-gray-400">AI 기반 선행기술 검색 및 신규성·진보성 분석</p>
        </div>

        {/* 입력 카드 */}
        <div className="w-full max-w-xl shadow-sm hover:shadow-md transition-shadow
                        border border-gray-200 rounded-2xl bg-white overflow-hidden">
          <div className="flex divide-x divide-gray-100" style={{ minHeight: 150 }}>
            {/* 청구항 입력 */}
            <div className="flex-1 flex flex-col">
              <textarea
                ref={textareaRef}
                value={store.claimText}
                onChange={(e) => store.setClaimText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="특허 청구항을 직접 입력하세요&#10;예) 청구항 1. 방법에 있어서,&#10;제1항에 있어서 …"
                className="flex-1 w-full px-4 pt-3 pb-2 text-sm text-gray-800 placeholder-gray-400
                           resize-none focus:outline-none bg-transparent leading-relaxed"
              />
            </div>

            {/* PDF 업로드 */}
            <div className="w-44 shrink-0">
              <PdfUploadArea />
            </div>
          </div>

          {/* 하단 컨트롤 바 */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50/50">
            {/* 소스 토글 */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 mr-0.5">소스</span>
              {(['patentsview', 'kipris', 'openalex'] as const).map((src) => {
                const active = store.selectedSources.includes(src)
                return (
                  <button key={src} onClick={() => toggleSource(src)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-blue-50 border-blue-300 text-blue-600'
                        : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}>
                    {SOURCE_LABELS[src]}
                  </button>
                )
              })}
            </div>

            {/* 검색 전략 + 날짜 + 검색버튼 */}
            <div className="flex items-center gap-1.5">
              <select
                value={store.selectedTemplateId}
                onChange={(e) => store.setSelectedTemplateId(e.target.value)}
                title={
                  store.searchTemplates.find((t) => t.id === store.selectedTemplateId)?.description
                    ?? '검색 전략 선택'
                }
                className="text-[11px] text-gray-600 border border-gray-200 rounded-lg px-1.5 py-1
                           focus:outline-none focus:border-blue-400 bg-white cursor-pointer max-w-[110px]"
              >
                {store.searchTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              <input
                type="date"
                value={store.cutoffDate}
                onChange={(e) => store.setCutoffDate(e.target.value)}
                title="기준일 이전 특허만 검색"
                className="text-[11px] text-gray-500 border border-gray-200 rounded-lg px-2 py-1
                           focus:outline-none focus:border-blue-400 bg-transparent"
              />
              <button
                onClick={handleSearch}
                disabled={!store.claimText.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg font-medium
                           hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                검색
              </button>
            </div>
          </div>
        </div>

        <p className="mt-2.5 text-[10px] text-gray-400">Ctrl+Enter로 빠르게 검색</p>
      </div>

      {/* ── 우측: 청구항 구조 패널 (항상 표시) ─────────────────────────── */}
      <div className="w-[46%] shrink-0 border-l border-gray-200 bg-white overflow-hidden flex flex-col">
        <ClaimStructurePanel />
      </div>

    </div>
  )
}

// ─── Settings Modal (탭 없이 ProviderSettings 직접 표시) ─────────────────────

function SettingsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
         onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] h-[82vh] flex flex-col overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <span className="text-sm font-semibold text-gray-700">설정</span>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center
                       rounded hover:bg-gray-100 text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-hidden bg-sky-50 text-gray-800">
          <ProviderSettings />
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App(): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false)

  const store = useSearchStore()

  const isRunning  = store.phase !== 'idle' && store.phase !== 'complete' && store.phase !== 'error'
  const hasResults = store.result !== null || isRunning

  useEffect(() => { store.loadSettings() }, [])

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-slate-50 text-gray-900 overflow-hidden">

        {/* ── 헤더 ──────────────────────────────────────────────────────── */}
        <header className="drag-region shrink-0 h-10 border-b border-gray-200 bg-white
                           flex items-center px-3 gap-2">
          <span className="text-blue-600 font-semibold text-sm no-drag">Patent Search</span>

          {/* 결과 화면에서 뒤로 가기 버튼 */}
          {hasResults && (
            <button
              onClick={store.goHome}
              title="홈으로 돌아가기"
              className="no-drag flex items-center gap-1 text-[11px] text-gray-500
                         hover:text-blue-600 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 19l-7-7 7-7" />
              </svg>
              뒤로
            </button>
          )}

          {/* 검색 결과 있을 때 compact 검색바 */}
          {hasResults && (
            <div className="no-drag flex-1 max-w-lg mx-1">
              <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50
                              focus-within:border-blue-400 transition-colors h-7 px-2 gap-1">
                <input
                  type="text"
                  value={store.claimText}
                  onChange={(e) => store.setClaimText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') store.startSearch() }}
                  placeholder="청구항 텍스트..."
                  className="flex-1 text-xs text-gray-700 bg-transparent focus:outline-none placeholder-gray-400"
                />
                {isRunning ? (
                  <button onClick={store.cancelSearch}
                    className="text-[11px] text-gray-500 hover:text-gray-700 shrink-0">취소</button>
                ) : (
                  <button onClick={store.startSearch}
                    className="text-[11px] text-blue-600 hover:text-blue-500 font-medium shrink-0">검색</button>
                )}
              </div>
            </div>
          )}

          <div className="flex-1" />

          {/* 우측: 설정 + 창 컨트롤 */}
          <div className="no-drag flex items-center gap-0.5">
            <IconBtn onClick={() => setShowSettings(true)} title="설정">
              <GearIcon />
            </IconBtn>

            <div className="w-px h-4 bg-gray-200 mx-1" />

            {/* 최소화 */}
            <IconBtn onClick={() => window.patentAPI.window.minimize()} title="최소화">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="4" y="11" width="16" height="2" rx="1" />
              </svg>
            </IconBtn>

            {/* 닫기 */}
            <IconBtn onClick={() => window.patentAPI.window.close()} title="닫기" danger>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12" />
              </svg>
            </IconBtn>
          </div>
        </header>

        {/* ── 메인 컨텐츠 ──────────────────────────────────────────────── */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <ErrorBoundary>
            {hasResults ? <SearchPanel /> : <HomeView />}
          </ErrorBoundary>
        </main>

        {/* ── 저작권 ───────────────────────────────────────────────────── */}
        <footer className="shrink-0 h-6 flex items-center justify-end px-4 bg-white
                           border-t border-gray-100">
          <span className="text-[10px] text-gray-400">© AIdan. All rights reserved.</span>
        </footer>

        {/* ── 모달 ─────────────────────────────────────────────────────── */}
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
