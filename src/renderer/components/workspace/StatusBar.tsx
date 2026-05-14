/**
 * StatusBar — bottom application bar showing:
 *  - Agent event log (last message)
 *  - Session token usage (input / output / cost estimate)
 *  - Active streaming indicator
 *  - Clear / expand buttons
 */

import React, { useState } from 'react'
import { useWorkspaceStore, type AgentEvent } from '../../store/workspaceStore'

const EVENT_COLORS: Record<AgentEvent['type'], string> = {
  info:  'text-gray-400',
  warn:  'text-yellow-400',
  error: 'text-red-400',
  tool:  'text-blue-400',
  llm:   'text-purple-400',
}

const EVENT_ICONS: Record<AgentEvent['type'], string> = {
  info:  '●',
  warn:  '▲',
  error: '✕',
  tool:  '⚙',
  llm:   '🤖',
}

export default function StatusBar(): React.ReactElement {
  const { events, tokenUsage, streamingNodeId, clearEvents } = useWorkspaceStore()
  const [logOpen, setLogOpen] = useState(false)

  const last = events[0]
  const isStreaming = streamingNodeId != null

  const fmt = (n: number) => n.toLocaleString()
  const fmtCost = (c: number) =>
    c < 0.001 ? `< $0.001` : `$${c.toFixed(4)}`

  return (
    <>
      {/* Event log drawer */}
      {logOpen && (
        <div className="fixed bottom-8 left-0 right-0 z-40 bg-gray-900 border-t border-gray-700 h-48 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800 sticky top-0 bg-gray-900">
            <span className="text-xs font-semibold text-gray-400">에이전트 이벤트 로그</span>
            <div className="flex gap-2">
              <button onClick={clearEvents} className="text-xs text-gray-600 hover:text-gray-400">비우기</button>
              <button onClick={() => setLogOpen(false)} className="text-xs text-gray-600 hover:text-gray-300">닫기</button>
            </div>
          </div>
          {events.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-xs text-gray-700">이벤트 없음</div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 px-4 py-1.5 border-b border-gray-800 hover:bg-gray-800/30">
                <span className={`text-xs ${EVENT_COLORS[ev.type]} shrink-0 mt-0.5`}>
                  {EVENT_ICONS[ev.type]}
                </span>
                <span className="text-xs text-gray-300 flex-1 leading-relaxed">{ev.message}</span>
                {ev.nodeId && (
                  <span className="text-xs text-gray-600 shrink-0">{ev.nodeId}</span>
                )}
                <span className="text-xs text-gray-700 shrink-0">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="h-8 shrink-0 flex items-center gap-4 px-4 border-t border-gray-800 bg-gray-950 text-xs select-none">
        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-center gap-1.5 text-blue-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
            </span>
            <span>LLM 분석 중</span>
          </div>
        )}

        {/* Last event */}
        {last && !isStreaming && (
          <div className={`flex items-center gap-1 ${EVENT_COLORS[last.type]}`}>
            <span>{EVENT_ICONS[last.type]}</span>
            <span className="truncate max-w-xs">{last.message}</span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Token usage */}
        {tokenUsage.totalTokens > 0 && (
          <div className="flex items-center gap-3 text-gray-600">
            <span>
              입력 <span className="text-gray-400">{fmt(tokenUsage.inputTokens)}</span>
            </span>
            <span>
              출력 <span className="text-gray-400">{fmt(tokenUsage.outputTokens)}</span>
            </span>
            <span>
              비용 <span className="text-yellow-500">{fmtCost(tokenUsage.estimatedCostUsd)}</span>
            </span>
          </div>
        )}

        {/* Log toggle */}
        <button
          onClick={() => setLogOpen(!logOpen)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-800 transition-colors ${
            logOpen ? 'text-gray-300' : 'text-gray-600'
          }`}
        >
          <span>◈</span>
          <span>로그</span>
          {events.length > 0 && (
            <span className="ml-0.5 bg-gray-700 text-gray-400 px-1 rounded-full text-xs">
              {events.length}
            </span>
          )}
        </button>
      </div>
    </>
  )
}
