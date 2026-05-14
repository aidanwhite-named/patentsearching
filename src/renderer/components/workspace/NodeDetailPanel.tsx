/**
 * NodeDetailPanel — right-side panel shown when a claim node is selected.
 *
 * Sections (tabs):
 *  1. 구성요소 — parsed claim elements with importance stars, editable
 *  2. 대비표   — claim chart rows from search result
 *  3. Diff     — VisualDiff between claim and top prior art
 *  4. 분석     — StreamingOutput for this node
 */

import React, { useState } from 'react'
import { useWorkspaceStore, type ClaimNodeData } from '../../store/workspaceStore'
import { useSearchStore } from '../../store/searchStore'
import VisualDiff from './VisualDiff'
import StreamingOutput from './StreamingOutput'
import type { ClaimElement } from '../../../shared/searchTypes'
import { parseClaim } from '../../../main/search/ClaimParser'

// We can't import main-process code in renderer — use a local re-export shim
// Actually parseClaim is pure TypeScript with no Electron APIs, so it can be
// imported safely from the renderer bundle (vite will include it).

type DetailTab = 'elements' | 'chart' | 'diff' | 'analysis'

interface Props {
  nodeId: string
}

const IMPORTANCE_STARS = (n: 1 | 2 | 3) =>
  '★'.repeat(n) + '☆'.repeat(3 - n)

const VERDICT_CHIPS = {
  COVERED:     'bg-red-900/40 text-red-300',
  PARTIAL:     'bg-yellow-900/40 text-yellow-300',
  NOT_COVERED: 'bg-green-900/30 text-green-400',
}

export default function NodeDetailPanel({ nodeId }: Props): React.ReactElement {
  const [tab, setTab] = useState<DetailTab>('elements')
  const { nodes, updateNodeData } = useWorkspaceStore()
  const searchStore = useSearchStore()

  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return <EmptyPanel />

  const data = node.data as ClaimNodeData

  // Parse elements lazily from claimText if not yet set
  const elements: ClaimElement[] = data.elements.length > 0
    ? data.elements
    : parseClaim(data.claimText).elements

  // Find claim chart for this node in search results
  const chart = searchStore.result?.claimCharts.find(
    (c) => c.patentNumber === data.topMatchTitle
  ) ?? searchStore.result?.claimCharts[0]

  const topCandidate = searchStore.result?.candidates[0]

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{data.label}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {data.isIndependent ? '독립항' : '종속항'} · {elements.length}개 구성요소
            </p>
          </div>
          {data.status !== 'idle' && (
            <StatusChip status={data.status} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 shrink-0">
        {([
          ['elements', '구성요소'],
          ['chart', '대비표'],
          ['diff', 'Diff'],
          ['analysis', '분석'],
        ] as [DetailTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === id
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'elements' && (
          <ElementsTab
            elements={elements}
            claimText={data.claimText}
            onParsed={(els) => updateNodeData(nodeId, { elements: els })}
          />
        )}
        {tab === 'chart' && chart && (
          <ChartTab chart={chart} />
        )}
        {tab === 'chart' && !chart && (
          <EmptyTab message="검색 후 대비표가 표시됩니다" />
        )}
        {tab === 'diff' && topCandidate && (
          <VisualDiff
            claimText={data.claimText}
            priorArtText={`${topCandidate.doc.title}\n${topCandidate.doc.abstract}`}
            claimLabel={data.label}
            priorArtLabel={topCandidate.doc.patentNumber}
          />
        )}
        {tab === 'diff' && !topCandidate && (
          <EmptyTab message="검색 후 비교 텍스트가 표시됩니다" />
        )}
        {tab === 'analysis' && (
          <StreamingOutput nodeId={nodeId} />
        )}
      </div>
    </div>
  )
}

// ─── Elements tab ─────────────────────────────────────────────────────────

function ElementsTab({
  elements,
  claimText,
  onParsed,
}: {
  elements: ClaimElement[]
  claimText: string
  onParsed: (els: ClaimElement[]) => void
}): React.ReactElement {
  const [editMode, setEditMode] = useState(false)
  const [editText, setEditText] = useState(claimText)

  const handleReparse = () => {
    const parsed = parseClaim(editText)
    onParsed(parsed.elements)
    setEditMode(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Claim text edit toggle */}
      <div className="px-4 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={() => setEditMode(!editMode)}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          {editMode ? '취소' : '✎ 청구항 편집'}
        </button>
      </div>

      {editMode ? (
        <div className="flex flex-col flex-1 p-4 gap-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={8}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200
                       font-mono leading-relaxed resize-none focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleReparse}
            className="self-end px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
          >
            재파싱
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {elements.map((el) => (
            <div key={el.id} className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded bg-blue-900/40 border border-blue-700 flex items-center justify-center text-xs font-bold text-blue-300">
                {el.id}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-yellow-400">{IMPORTANCE_STARS(el.importance)}</span>
                  {el.isEssential && (
                    <span className="text-xs text-red-400 border border-red-800 px-1 rounded">필수</span>
                  )}
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{el.text}</p>
              </div>
            </div>
          ))}
          {elements.length === 0 && (
            <p className="text-xs text-gray-600">구성요소를 파싱하지 못했습니다. 청구항 편집 후 재파싱하세요.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Chart tab ────────────────────────────────────────────────────────────

function ChartTab({ chart }: { chart: import('../../../shared/searchTypes').ClaimChart }): React.ReactElement {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex gap-3 px-4 py-2 text-xs text-gray-500 border-b border-gray-800 shrink-0">
        <span>신규성: <strong className={chart.noveltyRisk === 'HIGH' ? 'text-red-400' : chart.noveltyRisk === 'MEDIUM' ? 'text-yellow-400' : 'text-green-400'}>{chart.noveltyRisk}</strong></span>
        <span>진보성: <strong className={chart.inventivenessRisk === 'HIGH' ? 'text-red-400' : chart.inventivenessRisk === 'MEDIUM' ? 'text-yellow-400' : 'text-green-400'}>{chart.inventivenessRisk}</strong></span>
        <span>유사도: <strong className="text-white">{Math.round(chart.overallSimilarity * 100)}%</strong></span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {chart.rows.map((row) => (
          <div key={row.element.id} className="bg-gray-800 rounded p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold text-blue-300">[{row.element.id}]</span>
              <span className="text-xs text-yellow-400">{IMPORTANCE_STARS(row.element.importance)}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${VERDICT_CHIPS[row.verdict]}`}>
                {row.verdict === 'COVERED' ? '개시됨' : row.verdict === 'PARTIAL' ? '부분' : '미개시'}
              </span>
              <span className="ml-auto text-xs text-gray-400">{Math.round(row.similarity * 100)}%</span>
            </div>
            <p className="text-xs text-gray-400 mb-1 leading-relaxed">{row.element.text}</p>
            {row.priorArtText && (
              <blockquote className="text-xs text-gray-500 border-l-2 border-gray-600 pl-2 italic leading-relaxed">
                {row.priorArtText}
              </blockquote>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: ClaimNodeData['status'] }): React.ReactElement {
  const map = {
    idle:      ['bg-gray-800 text-gray-500', '대기'],
    searching: ['bg-blue-900/40 text-blue-400', '검색 중'],
    reranking: ['bg-purple-900/40 text-purple-400', '분석 중'],
    done:      ['bg-green-900/40 text-green-400', '완료'],
    error:     ['bg-red-900/40 text-red-400', '오류'],
  }
  const [cls, label] = map[status]
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>
}

function EmptyTab({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center h-full text-sm text-gray-700">{message}</div>
  )
}

function EmptyPanel(): React.ReactElement {
  return (
    <div className="flex items-center justify-center h-full text-sm text-gray-700">
      노드를 클릭하면 상세 정보가 표시됩니다
    </div>
  )
}
