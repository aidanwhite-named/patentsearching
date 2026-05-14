import React, { useState } from 'react'
import { useSearchStore } from '../store/searchStore'
import CandidateList from './CandidateList'
import ClaimChartView from './ClaimChartView'

type PanelView = 'candidates' | 'chart' | 'report'

const PHASE_LABELS: Record<string, string> = {
  idle: '대기 중',
  parsing_claim: '청구항 파싱 중...',
  retrieving: '선행기술 수집 중...',
  validating_urls: 'URL 유효성 검증 중...',
  reranking: 'LLM 재순위화 중...',
  generating_chart: '대비표 생성 중...',
  complete: '검색 완료',
  error: '오류',
}

export default function SearchPanel(): React.ReactElement {
  const store = useSearchStore()
  const [panelView, setPanelView] = useState<PanelView>('candidates')
  const [showBroadWarnings, setShowBroadWarnings] = useState(false)

  const isRunning = store.phase !== 'idle' && store.phase !== 'complete' && store.phase !== 'error'

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* ── Progress / error bar ──────────────────────────────────────────── */}
      {(isRunning || store.phase === 'error') && (
        <div className="shrink-0 border-b border-gray-100 px-4 py-2 bg-gray-50">
          {isRunning && store.progress && (
            <ProgressBar progress={store.progress} />
          )}
          {store.phase === 'error' && store.error && (
            <p className="text-xs text-red-500">{store.error}</p>
          )}
        </div>
      )}

      {/* ── Results area ──────────────────────────────────────────────────── */}
      {store.result && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: candidates list */}
          <div className="w-96 shrink-0 border-r border-gray-100 flex flex-col overflow-hidden">
            {/* Results summary */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0 bg-gray-50">
              <span className="text-xs text-gray-500">
                {store.result.candidates.length}건 수집
                {store.result.reranked.length > 0 && ` · ${store.result.reranked.length}건 분석`}
                {` · ${(store.result.executionMs / 1000).toFixed(1)}s`}
              </span>
              {store.result.broadTermWarnings.length > 0 && (
                <button
                  onClick={() => setShowBroadWarnings(!showBroadWarnings)}
                  className="text-xs text-amber-500 hover:text-amber-600"
                >
                  ⚠ 광범위 표현 {store.result.broadTermWarnings.length}건
                </button>
              )}
            </div>

            {/* Broad term warnings */}
            {showBroadWarnings && store.result.broadTermWarnings.length > 0 && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 shrink-0">
                {store.result.broadTermWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 leading-relaxed">⚠ {w}</p>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-hidden">
              <CandidateList
                candidates={store.result.candidates}
                reranked={store.result.reranked}
                selectedId={store.selectedCandidate?.doc.id ?? null}
                onSelect={(c) => {
                  store.selectCandidate(c)
                  setPanelView('chart')
                }}
              />
            </div>
          </div>

          {/* Right: detail panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* View tabs */}
            <div className="flex border-b border-gray-100 shrink-0 bg-gray-50">
              {(['chart', 'report'] as PanelView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setPanelView(v)}
                  className={`px-5 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                    panelView === v
                      ? 'text-blue-600 border-blue-500 bg-white'
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {v === 'chart' ? '청구항 대비표' : '선행기술 보고서'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-hidden">
              {panelView === 'chart' && store.selectedChart ? (
                <ClaimChartView
                  chart={store.selectedChart}
                  onClose={store.clearSelection}
                />
              ) : panelView === 'chart' && !store.selectedChart ? (
                <EmptyPane message="후보 문헌을 선택하면 청구항 대비표가 표시됩니다." />
              ) : (
                <PriorArtReport report={store.result.priorArtReport} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Running splash (no results yet) */}
      {!store.result && isRunning && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-gray-400">
          <SpinnerIcon />
          <p className="text-sm">{PHASE_LABELS[store.phase] ?? store.phase}</p>
          {store.progress?.message && (
            <p className="text-xs text-gray-400">{store.progress.message}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ProgressBar({
  progress,
}: {
  progress: import('../../shared/searchTypes').SearchProgress
}): React.ReactElement {
  const pct =
    progress.totalCandidates > 0
      ? Math.round((progress.candidatesProcessed / progress.totalCandidates) * 100)
      : null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-600">{PHASE_LABELS[progress.phase] ?? progress.phase}</span>
        <span className="text-xs text-gray-400">{progress.message}</span>
      </div>
      {pct !== null && (
        <div className="w-full bg-gray-200 rounded-full h-1">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function PriorArtReport({ report }: { report: string }): React.ReactElement {
  return (
    <div className="p-5 overflow-y-auto h-full">
      <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
        {report}
      </pre>
    </div>
  )
}

function EmptyPane({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center h-full text-sm text-gray-400">
      {message}
    </div>
  )
}

function SpinnerIcon(): React.ReactElement {
  return (
    <svg className="w-8 h-8 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
