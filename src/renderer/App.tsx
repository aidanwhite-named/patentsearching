import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ProviderSettings from './components/ProviderSettings'
import PromptStrategyPanel from './components/PromptStrategyPanel'
import SearchSourceSettings from './components/SearchSourceSettings'
import SearchPanel from './components/SearchPanel'
import ErrorBoundary from './components/ErrorBoundary'
import ToastContainer from './components/ToastContainer'
import { useSearchStore } from './store/searchStore'
import { useProjectStore } from './store/projectStore'
import { useWorkspaceStore } from './store/workspaceStore'
import type { ContextItem } from './store/workspaceStore'
import { toast } from './store/toastStore'
import type { SearchQuery } from '../shared/searchTypes'
import type { EnrichedClaim, PatentStructure, SemanticChunk } from '../shared/patentTypes'

interface ElectronFile extends File {
  path: string
}

type PipelineStep = 'idle' | 'parsing' | 'extracting' | 'chunking' | 'enriching' | 'building' | 'done' | 'error'
type SettingsTab = 'provider' | 'sources' | 'prompts'

interface BasicClaim {
  num: number
  isIndependent: boolean
  parentNum?: number
  text: string
}

const STEP_LABELS: Record<PipelineStep, string> = {
  idle: '',
  parsing: '문서 구조 읽는 중',
  extracting: '청구항 구조 분석 중',
  chunking: '검색 문맥 정리 중',
  enriching: '청구항 심층 분석 중',
  building: '검색 준비 중',
  done: '분석 완료',
  error: '오류 발생',
}

const STEP_PCT: Record<PipelineStep, number> = {
  idle: 0,
  parsing: 15,
  extracting: 35,
  chunking: 55,
  enriching: 80,
  building: 95,
  done: 100,
  error: 0,
}

const SOURCE_LABELS: Record<SearchQuery['sources'][number], string> = {
  patentsview: 'PatentsView',
  kipris: 'KIPRIS',
  openalex: 'OpenAlex',
  bigquery: 'BigQuery',
}

const TEMPLATE_LABELS: Record<string, string> = {
  auto: '자동',
  structural: '구성요소 중심',
  functional: '기능/효과 중심',
  application: '적용분야 중심',
  broad: '넓게 검색',
}

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'provider', label: 'AI 설정' },
  { id: 'sources', label: '검색 소스' },
  { id: 'prompts', label: '고급 프롬프트' },
]

function buildSupplementalContext(items: ContextItem[]): string {
  return items
    .filter((item) => item.useInRetrieval || item.useInReranking)
    .map((item, index) => {
      const typeLabel = item.type === 'url' ? 'URL' : item.type === 'prior_art' ? 'PDF/선행자료' : '사용자 메모'
      return `[보조자료 ${index + 1}: ${typeLabel} - ${item.label}]\n${item.content.slice(0, 4000)}`
    })
    .join('\n\n---\n\n')
}

function contextItemsToChunks(items: ContextItem[]): SemanticChunk[] {
  return items
    .filter((item) => item.useInRetrieval || item.useInReranking)
    .map((item, index) => ({
      id: `ctx-${index + 1}`,
      text: item.content.slice(0, 5000),
      sectionType: item.type === 'note' ? 'unknown' : 'detailed_description',
      sectionTitle: item.label,
      charStart: 0,
      charEnd: item.content.length,
      overlapBefore: '',
      overlapAfter: '',
      figureRefs: [],
    }))
}

function IconButton({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  danger?: boolean
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        danger
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

function GearIcon(): React.ReactElement {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M10.3 4.3c.4-1.7 2.9-1.7 3.4 0 .2.9 1.2 1.4 2 .9 1.5-.9 3.3.8 2.4 2.4-.5.8 0 1.8.9 2 1.7.4 1.7 2.9 0 3.4-.9.2-1.4 1.2-.9 2 .9 1.5-.8 3.3-2.4 2.4-.8-.5-1.8 0-2 .9-.4 1.7-2.9 1.7-3.4 0-.2-.9-1.2-1.4-2-.9-1.5.9-3.3-.8-2.4-2.4.5-.8 0-1.8-.9-2-1.7-.4-1.7-2.9 0-3.4.9-.2 1.4-1.2.9-2-.9-1.5.8-3.3 2.4-2.4.8.5 1.8 0 2-.9Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function PdfUploadArea(): React.ReactElement {
  const { pdfPath, pdfPageCount, pdfLoading, setPdf, clearPdf, setPdfLoading } = useProjectStore()
  const {
    patentStructure,
    enrichedClaims,
    contextItems,
    setPatentStructure,
    setSemanticChunks,
    setEnrichedClaims,
    setEnrichmentLoading,
    initFromClaimText,
  } = useWorkspaceStore()
  const { setClaimText, setCutoffDate, getSelectedTemplate } = useSearchStore()
  const [step, setStep] = useState<PipelineStep>('idle')
  const [isDragging, setIsDragging] = useState(false)

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

      if (structure.publicationDate) {
        setCutoffDate(structure.publicationDate)
        toast.info(`기준일을 ${structure.publicationDate}로 설정했습니다.`)
      }

      // ── LLM claim extraction: claims_analysis 프롬프트로 청구항 텍스트 재생성 ──
      setStep('extracting')
      const rawClaimText = structure.claims.join('\n\n')
      const claimsInput  = rawClaimText || structure.rawText.slice(0, 12_000)
      let claimDisplayText = rawClaimText
      if (claimsInput) {
        try {
          const { displayText } = await window.patentAPI.claim.extractText(claimsInput)
          if (displayText) claimDisplayText = displayText
        } catch (err) {
          console.warn('[processPdf] LLM 청구항 추출 실패 — 규칙기반 텍스트 사용:', err)
        }
      }

      setStep('chunking')
      const { chunks, figureRefs } = await window.patentAPI.claim.semanticChunk(
        structure.sections,
        structure.figureRefs,
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
        additionalContext: buildSupplementalContext(contextItems),
      })
      setEnrichedClaims(enrichResult.enrichedClaims)
      setEnrichmentLoading(false)

      // 프롬프트 커스터마이즈 등으로 인한 파싱 경고 표시
      if (enrichResult.warnings && enrichResult.warnings.length > 0) {
        const uniqueTypes = new Set(
          enrichResult.warnings.map((w) =>
            w.includes('JSON으로 파싱') ? 'json' :
            w.includes("'components'") ? 'components' :
            w.includes("'searchQueries'") ? 'queries' : 'llm'
          )
        )
        if (uniqueTypes.has('json') || uniqueTypes.has('llm')) {
          toast.error('청구항 분석 응답을 읽지 못했습니다. 구성요소·가중치·검색쿼리를 사용할 수 없어 내부 기본값으로 동작합니다.')
        } else {
          const parts: string[] = []
          if (uniqueTypes.has('components')) parts.push('구성요소·가중치')
          if (uniqueTypes.has('queries')) parts.push('검색쿼리')
          toast.info(`프롬프트 응답에 ${parts.join('·')} 필드가 없어 내부 기본값으로 폴백합니다.`)
        }
      }

      setStep('building')
      if (claimDisplayText) {
        initFromClaimText(claimDisplayText)
        setClaimText(claimDisplayText)
      } else {
        toast.info('청구항 섹션을 찾지 못했습니다. 청구항을 직접 입력하거나 검색을 시작하면 문서 내용으로 검색합니다.')
      }

      setStep('done')
      toast.success(`PDF 분석 완료: 청구항 ${structure.claims.length}개, 문맥 ${chunks.length}개`)
    } catch (err) {
      setStep('error')
      setEnrichmentLoading(false)
      toast.error(`PDF 처리 실패: ${String(err)}`)
    } finally {
      setPdfLoading(false)
    }
  }, [
    setPdf,
    setPdfLoading,
    setPatentStructure,
    setSemanticChunks,
    setEnrichedClaims,
    setEnrichmentLoading,
    initFromClaimText,
    setClaimText,
    setCutoffDate,
    getSelectedTemplate,
    contextItems,
  ])

  const handleOpenPdf = useCallback(async () => {
    const filePath = await window.patentAPI.pdf.openDialog()
    if (filePath) processPdf(filePath)
  }, [processPdf])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files[0] as ElectronFile | undefined
    if (!file) return
    if (!file.path || !file.path.toLowerCase().endsWith('.pdf')) {
      toast.error('PDF 파일만 업로드할 수 있습니다.')
      return
    }
    processPdf(file.path)
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
    <div className="flex h-full flex-col">
      <button
        onClick={handleOpenPdf}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(false)
        }}
        onDrop={handleDrop}
        disabled={isRunning}
        className={`flex min-h-[190px] flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
          isDragging
            ? 'border-teal-400 bg-teal-50 text-teal-700'
            : 'border-slate-300 bg-slate-50 text-slate-500 hover:border-teal-300 hover:bg-teal-50/60 hover:text-teal-700'
        }`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm">
          {isRunning ? '...' : fileName ? 'PDF' : '+'}
        </span>
        <span className="text-sm font-semibold">
          {isRunning ? STEP_LABELS[step] : fileName ? fileName : 'PDF 업로드'}
        </span>
        <span className="max-w-[220px] text-xs leading-5 text-slate-400">
          {fileName
            ? `${pdfPageCount}p · 청구항 ${patentStructure?.claims.length ?? 0}개 · 분석 ${enrichedClaims.length}개`
            : '파일을 선택하거나 이곳에 끌어다 놓으세요.'}
        </span>
      </button>

      {isRunning && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-teal-500 transition-all duration-500" style={{ width: `${STEP_PCT[step]}%` }} />
        </div>
      )}

      {fileName && !isRunning && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className={step === 'error' ? 'text-red-500' : 'text-teal-600'}>
            {step === 'error' ? '다시 확인 필요' : '검색 준비 완료'}
          </span>
          <button onClick={handleClear} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-red-500">
            지우기
          </button>
        </div>
      )}
    </div>
  )
}

function parseManualClaims(text: string): BasicClaim[] {
  const claimRe = /(?:^|\n)\s*(?:청구항|Claim)\s*(\d+)[.\s:]/gi
  const matches = [...text.matchAll(claimRe)]
  if (matches.length === 0) return []

  return matches.map((match, i) => {
    const num = parseInt(match[1], 10)
    const start = (match.index ?? 0) + match[0].length
    const end = matches[i + 1]?.index ?? text.length
    const claimText = text.slice(start, end).trim()
    const depMatch = claimText.match(/(?:청구항|claim)\s*(\d+)/i)
    const parentNum = depMatch ? parseInt(depMatch[1], 10) : undefined
    return { num, isIndependent: !parentNum || parentNum === num, parentNum, text: claimText }
  })
}

function ClaimStructurePanel(): React.ReactElement {
  const { enrichedClaims } = useWorkspaceStore()
  const { claimText } = useSearchStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  // 새 PDF 분석이 완료되면 모든 청구항 구성요소를 자동으로 펼침
  useEffect(() => {
    if (enrichedClaims.length > 0) {
      setExpanded(new Set(enrichedClaims.map((c) => c.claimNumber)))
    }
  }, [enrichedClaims])

  const manualClaims = useMemo(
    () => (enrichedClaims.length > 0 ? [] : parseManualClaims(claimText)),
    [claimText, enrichedClaims.length],
  )

  const indepCount = enrichedClaims.filter((claim) => claim.isIndependent).length
  const depCount = enrichedClaims.length - indepCount
  const hasContent = enrichedClaims.length > 0 || manualClaims.length > 0
  const roots = enrichedClaims.filter((claim) => claim.isIndependent)

  const toggle = (num: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  const renderEnriched = (claim: EnrichedClaim, depth = 0): React.ReactNode => {
    const children = enrichedClaims.filter((item) => item.parentClaimNumber === claim.claimNumber)
    const isOpen = expanded.has(claim.claimNumber)

    return (
      <div key={claim.claimNumber}>
        <button
          onClick={() => toggle(claim.claimNumber)}
          className="grid w-full grid-cols-[2rem_1fr] gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50"
          style={{ paddingLeft: `${8 + depth * 18}px` }}
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded text-xs font-semibold ${
            claim.isIndependent ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {claim.claimNumber}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-700">
              {claim.overallPurpose || claim.originalClaim.slice(0, 90)}
            </span>
            {claim.components.length > 0 && (
              <span className="mt-1 block text-xs text-slate-400">
                구성요소 {claim.components.length}개
              </span>
            )}
          </span>
        </button>
        {isOpen && claim.components.length > 0 && (
          <div className="mb-2 ml-10 space-y-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            {claim.components.map((component, index) => (
              <div key={`${claim.claimNumber}-${component.name}-${index}`}
                   className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0 rounded bg-teal-100 px-1 py-0.5 text-[10px] font-bold text-teal-700">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="text-slate-600 leading-relaxed">{component.name}</span>
              </div>
            ))}
          </div>
        )}
        {children.map((child) => renderEnriched(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Claim Map</p>
        <h2 className="mt-1 text-base font-semibold text-slate-900">청구항 구조</h2>
        <p className="mt-1 text-xs text-slate-500">
          {enrichedClaims.length > 0
            ? `독립항 ${indepCount}개 · 종속항 ${depCount}개`
            : manualClaims.length > 0
              ? `감지된 청구항 ${manualClaims.length}개`
              : 'PDF 또는 청구항을 입력하면 자동으로 정리됩니다.'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!hasContent ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 px-6 text-center text-sm leading-6 text-slate-400">
            분석할 청구항을 입력하면 구조와 핵심 구성요소가 여기에 표시됩니다.
          </div>
        ) : enrichedClaims.length > 0 ? (
          roots.map((claim) => renderEnriched(claim))
        ) : (
          manualClaims.map((claim) => (
            <div key={claim.num} className="grid grid-cols-[2rem_1fr] gap-2 rounded-md px-2 py-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded text-xs font-semibold ${
                claim.isIndependent ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {claim.num}
              </span>
              <p className="line-clamp-2 text-sm leading-5 text-slate-600">{claim.text}</p>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function ReferenceContextPanel(): React.ReactElement {
  const { contextItems, addContextItem, removeContextItem, toggleContextItem } = useWorkspaceStore()
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState<'url' | 'pdf' | null>(null)

  const addNote = () => {
    const content = note.trim()
    if (!content) return
    addContextItem({
      type: 'note',
      label: content.slice(0, 40),
      content,
      useInRetrieval: true,
      useInReranking: true,
    })
    setNote('')
  }

  const addUrl = async () => {
    const target = url.trim()
    if (!target) return
    setLoading('url')
    try {
      const fetched = await window.patentAPI.context.fetchUrl(target)
      addContextItem({
        type: 'url',
        label: fetched.title || fetched.url,
        content: `${fetched.url}\n\n${fetched.text}`,
        useInRetrieval: true,
        useInReranking: true,
      })
      setUrl('')
      toast.success('URL 내용을 참조 자료에 추가했습니다.')
    } catch (err) {
      toast.error(`URL을 불러오지 못했습니다: ${String(err)}`)
    } finally {
      setLoading(null)
    }
  }

  const addReferencePdf = async () => {
    setLoading('pdf')
    try {
      const filePath = await window.patentAPI.pdf.openDialog()
      if (!filePath) return
      const extracted = await window.patentAPI.pdf.extract(filePath)
      addContextItem({
        type: 'prior_art',
        label: extracted.fileName,
        content: extracted.text.slice(0, 20_000),
        useInRetrieval: true,
        useInReranking: true,
      })
      toast.success('PDF 내용을 참조 자료에 추가했습니다.')
    } catch (err) {
      toast.error(`PDF 참조 자료 추가 실패: ${String(err)}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">해석 참조 자료</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          청구항만으로 모호한 표현을 해석할 때 참고합니다. 검색 쿼리 생성과 LLM 재순위 분석에 함께 들어갑니다.
        </p>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="예) 여기서 '제어부'는 센서값을 보정한 뒤 모터 구동 신호를 생성하는 MCU를 의미합니다."
        rows={3}
        className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={addNote}
          disabled={!note.trim()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          설명 추가
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
        />
        <button
          onClick={addUrl}
          disabled={!url.trim() || loading !== null}
          className="rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:border-teal-300 hover:text-teal-700 disabled:cursor-wait disabled:opacity-60"
        >
          {loading === 'url' ? '읽는 중' : 'URL 추가'}
        </button>
        <button
          onClick={addReferencePdf}
          disabled={loading !== null}
          className="rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:border-teal-300 hover:text-teal-700 disabled:cursor-wait disabled:opacity-60"
        >
          {loading === 'pdf' ? '읽는 중' : '참조 PDF'}
        </button>
      </div>

      {contextItems.length > 0 && (
        <div className="mt-4 space-y-2">
          {contextItems.map((item) => (
            <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  {item.type === 'url' ? 'URL' : item.type === 'prior_art' ? 'PDF' : '메모'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{item.label}</span>
                <button
                  onClick={() => toggleContextItem(item.id, 'useInRetrieval')}
                  className={`rounded px-2 py-1 text-[11px] ${item.useInRetrieval ? 'bg-teal-100 text-teal-700' : 'bg-white text-slate-400'}`}
                  title="검색 쿼리 생성에 사용"
                >
                  검색
                </button>
                <button
                  onClick={() => toggleContextItem(item.id, 'useInReranking')}
                  className={`rounded px-2 py-1 text-[11px] ${item.useInReranking ? 'bg-slate-200 text-slate-700' : 'bg-white text-slate-400'}`}
                  title="LLM 분석에 사용"
                >
                  분석
                </button>
                <button onClick={() => removeContextItem(item.id)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-white hover:text-red-500">
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HomeView(): React.ReactElement {
  const store = useSearchStore()
  const {
    enrichedClaims,
    patentStructure,
    contextItems,
    setEnrichedClaims,
    setEnrichmentLoading,
  } = useWorkspaceStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    store.loadSearchTemplates()
  }, [])

  const canSearch = store.claimText.trim().length > 0 || enrichedClaims.length > 0 || patentStructure !== null

  const handleSearch = useCallback(async () => {
    if (!canSearch) return

    if (enrichedClaims.length === 0 && store.claimText.trim()) {
      setEnrichmentLoading(true)
      try {
        const manualClaims = parseManualClaims(store.claimText)
        const claims = manualClaims.length > 0
          ? manualClaims.map((claim) => `청구항 ${claim.num}. ${claim.text}`)
          : [store.claimText.trim()]
        const syntheticStructure: PatentStructure = {
          title: '직접 입력 청구항',
          sections: [],
          claims,
          figureRefs: [],
          rawText: store.claimText,
          pageCount: 0,
          filePath: '',
        }
        const selectedTemplate = store.getSelectedTemplate()
        const result = await window.patentAPI.claim.enrich({
          patentStructure: syntheticStructure,
          chunks: contextItemsToChunks(contextItems),
          searchInstruction: selectedTemplate?.instruction ?? '',
          additionalContext: buildSupplementalContext(contextItems),
        })
        setEnrichedClaims(result.enrichedClaims)
      } catch (err) {
        toast.error(`청구항 해석 실패: ${String(err)}`)
      } finally {
        setEnrichmentLoading(false)
      }
    }

    store.startSearch()
  }, [
    canSearch,
    enrichedClaims.length,
    store,
    contextItems,
    setEnrichedClaims,
    setEnrichmentLoading,
  ])

  const toggleSource = useCallback((src: SearchQuery['sources'][number]) => {
    const active = store.selectedSources.includes(src)
    const next = active
      ? store.selectedSources.filter((source) => source !== src)
      : [...store.selectedSources, src]
    store.setSelectedSources(next)
  }, [store])

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_360px] overflow-hidden bg-slate-100">
      <section className="flex min-w-0 flex-col justify-center overflow-y-auto px-10 py-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-teal-700">AI prior-art search</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              청구항을 넣으면 선행기술 후보를 정리합니다
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              PDF를 올리거나 청구항을 붙여넣으세요. 검색 소스와 기준일만 확인하면 바로 분석을 시작할 수 있습니다.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid min-h-[300px] grid-cols-[minmax(0,1fr)_280px]">
              <div className="flex flex-col border-r border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <span className="text-sm font-semibold text-slate-700">청구항 입력</span>
                  <span className="text-xs text-slate-400">Ctrl + Enter 검색</span>
                </div>
                <textarea
                  ref={textareaRef}
                  value={store.claimText}
                  onChange={(e) => store.setClaimText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSearch()
                  }}
                  placeholder={'예) 청구항 1. ...\n\nPDF를 사용하는 경우 이 칸은 자동으로 채워집니다.'}
                  className="min-h-[250px] flex-1 resize-none bg-white px-5 py-4 text-[15px] leading-7 text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
              <div className="p-4">
                <PdfUploadArea />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-medium text-slate-500">검색 소스</span>
                {(['openalex', 'patentsview', 'bigquery'] as const).map((src) => {
                  const active = store.selectedSources.includes(src)
                  return (
                    <button
                      key={src}
                      onClick={() => toggleSource(src)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'border-teal-300 bg-teal-50 text-teal-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {SOURCE_LABELS[src]}
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={store.selectedTemplateId}
                  onChange={(e) => store.setSelectedTemplateId(e.target.value)}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-teal-400 focus:outline-none"
                >
                  {store.searchTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {TEMPLATE_LABELS[template.id] ?? template.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={store.cutoffDate}
                  onChange={(e) => store.setCutoffDate(e.target.value)}
                  title="이 날짜 이전 공개문헌만 검색"
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-teal-400 focus:outline-none"
                />
                <button
                  onClick={handleSearch}
                  disabled={!canSearch}
                  className="h-9 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  검색 시작
                </button>
              </div>
            </div>
          </div>

          <ReferenceContextPanel />
        </div>
      </section>

      <div className="border-l border-slate-200">
        <ClaimStructurePanel />
      </div>
    </div>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState<SettingsTab>('provider')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-6" onClick={onClose}>
      <div
        className="flex h-[82vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-4">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Settings</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">설정</h2>
          </div>
          <nav className="space-y-1">
            {SETTINGS_TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  tab === id
                    ? 'bg-white font-semibold text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:bg-white hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6">
            <p className="text-sm text-slate-500">
              {tab === 'provider' && 'AI 연결과 응답 품질을 설정합니다.'}
              {tab === 'sources' && '검색 데이터베이스와 비용 안전장치를 관리합니다.'}
              {tab === 'prompts' && '분석 프롬프트를 직접 조정합니다.'}
            </p>
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">
              닫기
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden bg-white">
            {tab === 'provider' && <ProviderSettings />}
            {tab === 'sources' && <SearchSourceSettings />}
            {tab === 'prompts' && <PromptStrategyPanel />}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function App(): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false)
  const store = useSearchStore()

  const isRunning = store.phase !== 'idle' && store.phase !== 'complete' && store.phase !== 'error'
  const hasResults = store.result !== null || isRunning

  useEffect(() => { store.loadSettings() }, [])

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
        <header className="drag-region flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="no-drag flex items-center gap-2">
            <div className="h-6 w-1 rounded-full bg-teal-500" />
            <span className="text-sm font-semibold tracking-tight text-slate-950">Patent Search AI</span>
          </div>

          {hasResults && (
            <button
              onClick={store.goHome}
              className="no-drag rounded-md px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              새 검색
            </button>
          )}

          {hasResults && (
            <div className="no-drag mx-2 max-w-xl flex-1">
              <div className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3">
                <input
                  type="text"
                  value={store.claimText}
                  onChange={(e) => store.setClaimText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') store.startSearch() }}
                  placeholder="청구항을 수정해 다시 검색"
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
                />
                {isRunning ? (
                  <button onClick={store.cancelSearch} className="text-xs font-medium text-slate-500 hover:text-red-600">취소</button>
                ) : (
                  <button onClick={store.startSearch} className="text-xs font-semibold text-teal-700 hover:text-teal-600">검색</button>
                )}
              </div>
            </div>
          )}

          <div className="flex-1" />
          <IconButton onClick={() => setShowSettings(true)} title="설정">
            <GearIcon />
          </IconButton>
          <div className="no-drag mx-1 h-5 w-px bg-slate-200" />
          <IconButton onClick={() => window.patentAPI.window.minimize()} title="최소화">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="11" width="14" height="2" rx="1" />
            </svg>
          </IconButton>
          <IconButton onClick={() => window.patentAPI.window.close()} title="닫기" danger>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </IconButton>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary>
            {hasResults ? <SearchPanel /> : <HomeView />}
          </ErrorBoundary>
        </main>

        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}
