/**
 * ContextControlPanel — controls which supplementary context (URLs, notes,
 * prior art references) is injected into Retrieval vs. Reranking.
 *
 * Each item has two independent toggles:
 *   [R] — include in Stage 1 retrieval query expansion
 *   [K] — include as context in Stage 2 LLM reranking prompt
 */

import React, { useState } from 'react'
import { useWorkspaceStore, type ContextItem } from '../../store/workspaceStore'

const TYPE_ICONS: Record<ContextItem['type'], string> = {
  url:       '🔗',
  note:      '📝',
  prior_art: '📄',
}

const TYPE_LABELS: Record<ContextItem['type'], string> = {
  url:       'URL',
  note:      '메모',
  prior_art: '선행기술 참조',
}

export default function ContextControlPanel(): React.ReactElement {
  const { contextItems, addContextItem, removeContextItem, toggleContextItem } = useWorkspaceStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newType, setNewType] = useState<ContextItem['type']>('url')
  const [newLabel, setNewLabel] = useState('')
  const [newContent, setNewContent] = useState('')

  const handleAdd = () => {
    if (!newLabel.trim() || !newContent.trim()) return
    addContextItem({
      type: newType,
      label: newLabel.trim(),
      content: newContent.trim(),
      useInRetrieval: true,
      useInReranking: false,
    })
    setNewLabel('')
    setNewContent('')
    setAddOpen(false)
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-300">컨텍스트 제어</span>
        <button
          onClick={() => setAddOpen(!addOpen)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + 추가
        </button>
      </div>

      {/* Add form */}
      {addOpen && (
        <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 space-y-2 shrink-0">
          <div className="flex gap-2">
            {(['url', 'note', 'prior_art'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`text-xs px-2 py-1 rounded ${
                  newType === t ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-400'
                }`}
              >
                {TYPE_ICONS[t]} {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="레이블 (예: Google Patents 참조 URL)"
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200
                       focus:outline-none focus:border-blue-500"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={newType === 'url' ? 'https://...' : '내용을 입력하세요'}
            rows={3}
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200
                       focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddOpen(false)} className="text-xs text-gray-500 hover:text-gray-300">취소</button>
            <button
              onClick={handleAdd}
              disabled={!newLabel.trim() || !newContent.trim()}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >추가</button>
          </div>
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center px-4 py-1.5 border-b border-gray-800 shrink-0">
        <span className="flex-1 text-xs text-gray-600">항목</span>
        <div className="flex gap-4 text-xs text-gray-600 mr-2">
          <span className="w-14 text-center" title="검색(Stage 1)에 사용">검색</span>
          <span className="w-14 text-center" title="LLM 재순위화(Stage 2)에 사용">Rerank</span>
        </div>
        <span className="w-6" />
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {contextItems.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-gray-700">
            컨텍스트 항목이 없습니다. + 추가를 클릭하세요.
          </div>
        )}
        {contextItems.map((item) => (
          <ContextRow
            key={item.id}
            item={item}
            onToggle={toggleContextItem}
            onRemove={removeContextItem}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-gray-800 shrink-0">
        <p className="text-xs text-gray-700 leading-relaxed">
          <span className="text-gray-500">검색</span>: Stage 1 쿼리 확장에 사용 ·{' '}
          <span className="text-gray-500">Rerank</span>: Stage 2 LLM 프롬프트에 주입
        </p>
      </div>
    </div>
  )
}

function ContextRow({
  item,
  onToggle,
  onRemove,
}: {
  item: ContextItem
  onToggle: (id: string, field: 'useInRetrieval' | 'useInReranking') => void
  onRemove: (id: string) => void
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-gray-800">
      <div className="flex items-center px-4 py-2 hover:bg-gray-800/40">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <span className="text-sm shrink-0">{TYPE_ICONS[item.type]}</span>
          <span className="text-xs text-gray-300 truncate">{item.label}</span>
        </button>
        <div className="flex gap-4 items-center mr-2">
          <Toggle
            active={item.useInRetrieval}
            label="검색"
            onClick={() => onToggle(item.id, 'useInRetrieval')}
            activeColor="bg-blue-600"
          />
          <Toggle
            active={item.useInReranking}
            label="Rerank"
            onClick={() => onToggle(item.id, 'useInReranking')}
            activeColor="bg-purple-600"
          />
        </div>
        <button
          onClick={() => onRemove(item.id)}
          className="text-gray-700 hover:text-red-400 text-xs w-6 text-center"
        >✕</button>
      </div>
      {expanded && (
        <div className="px-10 pb-2">
          <p className="text-xs text-gray-500 font-mono break-all leading-relaxed">
            {item.content}
          </p>
        </div>
      )}
    </div>
  )
}

function Toggle({
  active, label, onClick, activeColor,
}: {
  active: boolean; label: string; onClick: () => void; activeColor: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`w-14 text-center text-xs py-0.5 rounded transition-colors ${
        active ? `${activeColor} text-white` : 'bg-gray-800 text-gray-600'
      }`}
      title={`${label}: ${active ? 'ON' : 'OFF'}`}
    >
      {active ? 'ON' : 'OFF'}
    </button>
  )
}
