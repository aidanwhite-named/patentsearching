import React, { useState, useCallback } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useProjectStore }   from '../../store/projectStore'
import { toast }             from '../../store/toastStore'

type InputTab = 'pdf' | 'direct'

type PipelineStep = 'idle' | 'parsing' | 'chunking' | 'enriching' | 'building' | 'done' | 'error'

const STEP_LABELS: Record<PipelineStep, string> = {
  idle:      '',
  parsing:   '① 구조 파싱 중...',
  chunking:  '② 시맨틱 청킹 중...',
  enriching: '③ LLM 청구항 분석 중...',
  building:  '④ 청구항 트리 생성 중...',
  done:      '분석 완료 — 검색할 수 있습니다',
  error:     '처리 중 오류 발생',
}

// ─── PDF Tab ──────────────────────────────────────────────────────────────────

function PdfInputTab(): React.ReactElement {
  const {
    pdfPath, pdfPageCount, pdfLoading,
    setPdf, clearPdf, setPdfLoading,
  } = useProjectStore()

  const {
    patentStructure, semanticChunks, enrichedClaims,
    setPatentStructure, setSemanticChunks,
    setEnrichedClaims, setEnrichmentLoading, initFromClaimText,
  } = useWorkspaceStore()

  const [step, setStep] = useState<PipelineStep>('idle')

  // PDF 선택 → 구조 파싱 → 시맨틱 청킹 → LLM 분석 → 트리 생성 (자동 순차 실행)
  const handleOpenPdf = useCallback(async () => {
    const filePath = await window.patentAPI.pdf.openDialog()
    if (!filePath) return

    setStep('parsing')
    setPdfLoading(true)
    setSemanticChunks([])
    setEnrichedClaims([])
    setPatentStructure(null)

    try {
      // Step 1+2: PDF → PatentStructure
      const structure = await window.patentAPI.claim.parseStructure(filePath)
      setPdf(filePath, structure.rawText, structure.pageCount)
      setPatentStructure(structure)

      // Step 3: semantic chunking
      setStep('chunking')
      const { chunks, figureRefs } = await window.patentAPI.claim.semanticChunk(
        structure.sections,
        structure.figureRefs,
      )
      setSemanticChunks(chunks)
      setPatentStructure({ ...structure, figureRefs })

      // Step 4: LLM enrichment
      setStep('enriching')
      setEnrichmentLoading(true)
      const enrichResult = await window.patentAPI.claim.enrich({
        patentStructure: { ...structure, figureRefs },
        chunks,
      })
      setEnrichedClaims(enrichResult.enrichedClaims)
      setEnrichmentLoading(false)

      // Step 5: build claim tree
      setStep('building')
      if (structure.claims.length > 0) {
        initFromClaimText(structure.claims.join('\n\n'))
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
    setEnrichedClaims, setEnrichmentLoading, initFromClaimText,
  ])

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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        {/* Upload button */}
        <button
          onClick={handleOpenPdf}
          disabled={isRunning}
          className="w-full py-2.5 text-xs font-medium rounded border border-dashed
                     border-blue-700 bg-blue-950/30 text-blue-400
                     hover:bg-blue-900/40 hover:border-blue-500 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? STEP_LABELS[step] : pdfPath ? '📄 다른 PDF 선택' : '📄 PDF 파일 선택'}
        </button>

        {/* Progress bar */}
        {isRunning && (
          <div className="w-full bg-gray-800 rounded-full h-1 overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: step === 'parsing' ? '20%' : step === 'chunking' ? '45%' : step === 'enriching' ? '75%' : '95%' }}
            />
          </div>
        )}

        {/* File info */}
        {fileName && !isRunning && (
          <div className="bg-gray-800 rounded px-2 py-1.5 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-gray-200 truncate font-mono">{fileName}</p>
              <p className="text-[10px] mt-0.5 space-x-1">
                <span className="text-gray-500">{pdfPageCount}페이지</span>
                {patentStructure && (
                  <span className="text-gray-500">· 청구항 {patentStructure.claims.length}개</span>
                )}
                {semanticChunks.length > 0 && (
                  <span className="text-gray-600">· 청크 {semanticChunks.length}개</span>
                )}
                {enrichedClaims.length > 0 && (
                  <span className="text-green-600">· 분석 {enrichedClaims.length}개</span>
                )}
              </p>
            </div>
            <button
              onClick={handleClear}
              className="shrink-0 text-gray-600 hover:text-red-400 text-xs"
            >✕</button>
          </div>
        )}

        {/* Status message */}
        {step === 'done' && !isRunning && (
          <p className="text-[11px] text-green-500 text-center py-1">
            ✓ {STEP_LABELS.done}
          </p>
        )}
        {step === 'error' && !isRunning && (
          <p className="text-[11px] text-red-400 text-center py-1">
            {STEP_LABELS.error}
          </p>
        )}
      </div>

      {/* Empty state */}
      {!pdfPath && !isRunning && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-2">
            <p className="text-2xl opacity-20">📄</p>
            <p className="text-[10px] text-gray-700 leading-relaxed">
              PDF를 업로드하면<br/>
              자동으로 분석 후<br/>
              검색할 수 있습니다
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Direct Input Tab ─────────────────────────────────────────────────────────

function DirectInputTab(): React.ReactElement {
  const { initFromClaimText, addContextItem } = useWorkspaceStore()
  const [claimText,    setClaimText]    = useState('')
  const [contextNote,  setContextNote]  = useState('')
  const [contextUrl,   setContextUrl]   = useState('')

  const handleBuildTree = useCallback(() => {
    if (!claimText.trim()) return
    initFromClaimText(claimText)
    toast.success('청구항 트리를 생성했습니다')
  }, [claimText, initFromClaimText])

  const handleAddNote = useCallback(() => {
    if (!contextNote.trim()) return
    addContextItem({ type: 'note', label: contextNote.slice(0, 40), content: contextNote, useInRetrieval: false, useInReranking: true })
    setContextNote('')
    toast.success('메모가 추가되었습니다')
  }, [contextNote, addContextItem])

  const handleAddUrl = useCallback(() => {
    if (!contextUrl.trim()) return
    addContextItem({ type: 'url', label: contextUrl.slice(0, 40), content: contextUrl, useInRetrieval: true, useInReranking: true })
    setContextUrl('')
    toast.success('URL이 추가되었습니다')
  }, [contextUrl, addContextItem])

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Claim input */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wide">
          청구항 직접 입력
        </label>
        <textarea
          value={claimText}
          onChange={(e) => setClaimText(e.target.value)}
          placeholder={CLAIM_PLACEHOLDER}
          rows={9}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5
                     text-xs text-gray-200 font-mono leading-relaxed resize-none
                     focus:outline-none focus:border-blue-500 placeholder-gray-700"
        />
        <button
          onClick={handleBuildTree}
          disabled={!claimText.trim()}
          className="self-end px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          트리 생성
        </button>
      </div>

      <div className="border-t border-gray-800" />

      {/* Context note */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wide">보강 메모</label>
        <textarea
          value={contextNote}
          onChange={(e) => setContextNote(e.target.value)}
          placeholder="발명의 배경, 기술 설명, 특이사항..."
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5
                     text-xs text-gray-300 leading-relaxed resize-none
                     focus:outline-none focus:border-green-600 placeholder-gray-700"
        />
        <button onClick={handleAddNote} disabled={!contextNote.trim()}
          className="self-end px-3 py-1 text-xs bg-green-800 hover:bg-green-700 text-white rounded
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >메모 추가</button>
      </div>

      {/* Context URL */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wide">참조 URL</label>
        <div className="flex gap-1">
          <input
            type="url" value={contextUrl} onChange={(e) => setContextUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
            placeholder="https://patents.google.com/..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5
                       text-xs text-gray-300 focus:outline-none focus:border-green-600 placeholder-gray-700"
          />
          <button onClick={handleAddUrl} disabled={!contextUrl.trim()}
            className="shrink-0 px-2 py-1 text-xs bg-green-800 hover:bg-green-700 text-white rounded
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >추가</button>
        </div>
      </div>
    </div>
  )
}

// ─── LeftInputPanel ───────────────────────────────────────────────────────────

export default function LeftInputPanel(): React.ReactElement {
  const [tab, setTab] = useState<InputTab>('pdf')
  const { pdfPath }  = useProjectStore()
  const { enrichedClaims } = useWorkspaceStore()

  return (
    <div className="flex flex-col h-full border-r border-gray-800 bg-gray-950">
      {/* Tab header */}
      <div className="flex shrink-0 border-b border-gray-800">
        <button
          onClick={() => setTab('pdf')}
          className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
            tab === 'pdf'
              ? 'bg-gray-900 text-blue-400 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
          }`}
        >
          📄 PDF 입력
          {pdfPath && <span className="ml-1 text-blue-500">●</span>}
          {enrichedClaims.length > 0 && <span className="ml-1 text-green-500">✓</span>}
        </button>
        <button
          onClick={() => setTab('direct')}
          className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
            tab === 'direct'
              ? 'bg-gray-900 text-blue-400 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
          }`}
        >
          ✏️ 직접 입력
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'pdf'    && <PdfInputTab />}
        {tab === 'direct' && <DirectInputTab />}
      </div>
    </div>
  )
}

const CLAIM_PLACEHOLDER = `청구항 1. 방법에 있어서,
  (A) ...하는 단계; 및
  (B) ...하는 단계;
  를 포함하는 방법.

청구항 2. 청구항 1에 있어서, ...`
