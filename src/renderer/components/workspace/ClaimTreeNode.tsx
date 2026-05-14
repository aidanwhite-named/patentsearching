/**
 * ClaimTreeNode — React Flow custom node for a single patent claim.
 */

import React, { useCallback } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ClaimNodeData, ClaimNodeStatus } from '../../store/workspaceStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useSearchStore } from '../../store/searchStore'

// React Flow v12: custom node type = Node<Data, 'nodeTypeName'>
export type ClaimFlowNode = Node<ClaimNodeData, 'claimNode'>

const STATUS_RING: Record<ClaimNodeStatus, string> = {
  idle:      'border-gray-700',
  searching: 'border-blue-500 animate-pulse',
  reranking: 'border-purple-500 animate-pulse',
  done:      'border-green-600',
  error:     'border-red-600',
}

const RISK_CHIP: Record<'HIGH' | 'MEDIUM' | 'LOW', string> = {
  HIGH:   'bg-red-900/50 text-red-300 border border-red-700',
  MEDIUM: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  LOW:    'bg-green-900/40 text-green-400 border border-green-800',
}

const STATUS_ICON: Record<ClaimNodeStatus, string> = {
  idle:      '○',
  searching: '⟳',
  reranking: '⟳',
  done:      '✓',
  error:     '✕',
}

const STATUS_COLOR: Record<ClaimNodeStatus, string> = {
  idle:      'text-gray-600',
  searching: 'text-blue-400',
  reranking: 'text-purple-400',
  done:      'text-green-400',
  error:     'text-red-400',
}

export default function ClaimTreeNode({ id, data: rawData, selected }: NodeProps<ClaimFlowNode>): React.ReactElement {
  // Cast: React Flow passes data as the generic param; it's ClaimNodeData here
  const data = rawData as ClaimNodeData

  const { selectNode, updateNodeData, startStream, appendChunk, finishStream, pushEvent, addTokenUsage } =
    useWorkspaceStore()
  const searchStore = useSearchStore()

  const handleSelect = useCallback(() => selectNode(id), [id, selectNode])

  // ── Search this claim node ─────────────────────────────────────────────
  const handleSearch = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      updateNodeData(id, { status: 'searching' })
      pushEvent('tool', `청구항 ${data.claimNumber} 선행기술 검색 시작`, id)

      searchStore.setClaimText(data.claimText)
      searchStore.startSearch()

      const unwatch = setInterval(() => {
        if (searchStore.phase === 'complete' || searchStore.phase === 'error') {
          clearInterval(unwatch)
          const result = searchStore.result
          if (result && result.reranked.length > 0) {
            const top = result.reranked[0]
            const topDoc = result.candidates.find((c) => c.doc.id === top.docId)
            updateNodeData(id, {
              status: 'done',
              noveltyRisk: result.claimCharts[0]?.noveltyRisk,
              inventivenessRisk: result.claimCharts[0]?.inventivenessRisk,
              topMatchTitle: topDoc?.doc.title.slice(0, 60),
              topMatchScore: top.weightedScore,
            })
            pushEvent('info', `검색 완료: ${result.candidates.length}건 수집`, id)
          } else if (searchStore.phase === 'error') {
            updateNodeData(id, { status: 'error' })
            pushEvent('error', `검색 오류: ${searchStore.error ?? '알 수 없는 오류'}`, id)
          }
        }
      }, 500)
    },
    [id, data, searchStore, updateNodeData, pushEvent],
  )

  // ── Stream LLM analysis ─────────────────────────────────────────────────
  const handleAnalyze = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      updateNodeData(id, { status: 'reranking' })
      pushEvent('llm', `청구항 ${data.claimNumber} LLM 분석 시작`, id)

      const topPriorArt = searchStore.result?.candidates
        .slice(0, 3)
        .map((c) => `[${c.doc.patentNumber}] ${c.doc.title}\n${c.doc.abstract}`)
        .join('\n\n') ?? ''

      const prompt = `청구항 ${data.claimNumber}:\n${data.claimText}\n\n선행기술 후보:\n${topPriorArt}`

      const cancel = window.patentAPI.llm.stream(
        { prompt, systemPrompt: ANALYSIS_SYSTEM_PROMPT, temperature: 0.2, maxTokens: 2000 },
        {
          onChunk: (delta) => appendChunk(delta),
          onEnd: (usage) => {
            finishStream()
            updateNodeData(id, { status: 'done' })
            if (usage) addTokenUsage(usage.inputTokens, usage.outputTokens)
            pushEvent('llm', `분석 완료 (${usage?.totalTokens ?? 0} tokens)`, id)
          },
          onError: (msg) => {
            finishStream()
            updateNodeData(id, { status: 'error' })
            pushEvent('error', `LLM 오류: ${msg}`, id)
          },
        },
      )

      startStream(id, cancel)
    },
    [id, data, searchStore, startStream, appendChunk, finishStream, updateNodeData, pushEvent, addTokenUsage],
  )

  const ringClass = STATUS_RING[data.status]
  const isDone    = data.status === 'done'

  return (
    <div
      onClick={handleSelect}
      className={`
        w-72 rounded-lg border-2 bg-gray-900 cursor-pointer transition-all select-none
        ${ringClass}
        ${selected ? 'shadow-lg shadow-blue-900/30' : ''}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-600 !w-2 !h-2" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-blue-300">{data.label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            data.isIndependent
              ? 'bg-blue-900/50 text-blue-400 border border-blue-700'
              : 'bg-gray-800 text-gray-500 border border-gray-700'
          }`}>
            {data.isIndependent ? '독립항' : '종속항'}
          </span>
        </div>
        <span className={`text-sm font-mono ${STATUS_COLOR[data.status]}`}>
          {STATUS_ICON[data.status]}
        </span>
      </div>

      {/* Claim text preview */}
      <div className="px-3 pb-2">
        <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">
          {data.claimText}
        </p>
      </div>

      {/* Risk chips */}
      {isDone && (data.noveltyRisk || data.inventivenessRisk) && (
        <div className="flex gap-1 px-3 pb-2 flex-wrap">
          {data.noveltyRisk && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${RISK_CHIP[data.noveltyRisk]}`}>
              신규성 {data.noveltyRisk}
            </span>
          )}
          {data.inventivenessRisk && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${RISK_CHIP[data.inventivenessRisk]}`}>
              진보성 {data.inventivenessRisk}
            </span>
          )}
        </div>
      )}

      {/* Top match */}
      {data.topMatchTitle && (
        <div className="px-3 pb-2">
          <p className="text-xs text-gray-600 truncate">
            최유사: <span className="text-gray-400">{data.topMatchTitle}</span>
            {data.topMatchScore !== undefined && (
              <span className="ml-1 text-yellow-500">{data.topMatchScore}점</span>
            )}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1 px-3 pb-3 pt-1 border-t border-gray-800 mt-1">
        <ActionButton
          label="검색"
          icon="🔍"
          onClick={handleSearch}
          disabled={data.status === 'searching'}
          color="blue"
        />
        <ActionButton
          label="분석"
          icon="🤖"
          onClick={handleAnalyze}
          disabled={data.status === 'reranking'}
          color="purple"
        />
      </div>
    </div>
  )
}

function ActionButton({
  label, icon, onClick, disabled, color,
}: {
  label: string; icon: string; onClick: (e: React.MouseEvent) => void
  disabled?: boolean; color: 'blue' | 'purple'
}): React.ReactElement {
  const colors = {
    blue:   'border-blue-800 text-blue-400 hover:bg-blue-900/40',
    purple: 'border-purple-800 text-purple-400 hover:bg-purple-900/40',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center justify-center gap-1 text-xs py-1 rounded border
                  transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                  ${colors[color]}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

const ANALYSIS_SYSTEM_PROMPT = `당신은 특허 심사관 수준의 선행기술 분석 전문가입니다.
주어진 청구항과 선행기술 후보를 비교하여 다음을 간결하게 서술하라:
1. 신규성 부정 가능성 (특허법 제29조 제1항)
2. 진보성 부정 가능성 (특허법 제29조 제2항)
3. 가장 위험한 선행기술 1건과 그 이유
확인된 사실만 근거로 쓰고, 불확실한 내용은 "추정" 또는 "가능성"으로 표현하라.`
