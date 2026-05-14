/**
 * StreamingOutput — real-time LLM analysis output panel.
 *
 * Features:
 *  - Streams tokens into a pre-formatted display as they arrive
 *  - Blinking cursor while streaming
 *  - Cancel button (calls workspaceStore.clearStream)
 *  - Copy-to-clipboard when done
 *  - Auto-scroll to bottom during streaming
 */

import React, { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../../store/workspaceStore'

interface Props {
  nodeId?: string | null
}

export default function StreamingOutput({ nodeId }: Props): React.ReactElement {
  const { streamingNodeId, streamBuffer, streamDone, clearStream } = useWorkspaceStore()
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const isActive = streamingNodeId === nodeId || (nodeId == null && streamingNodeId != null)
  const hasContent = streamBuffer.length > 0

  // Auto-scroll while streaming
  useEffect(() => {
    if (!streamDone) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [streamBuffer, streamDone])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(streamBuffer)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!hasContent && !isActive) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-700">
        LLM 분석 결과가 여기 실시간으로 출력됩니다
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          {!streamDone && isActive && (
            <>
              <span className="flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              <span className="text-xs text-blue-400">분석 중...</span>
            </>
          )}
          {streamDone && <span className="text-xs text-green-400">✓ 분석 완료</span>}
        </div>
        <div className="flex items-center gap-2">
          {hasContent && (
            <button
              onClick={handleCopy}
              className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
            >
              {copied ? '복사됨 ✓' : '복사'}
            </button>
          )}
          {!streamDone && isActive && (
            <button
              onClick={clearStream}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/30 border border-red-800"
            >
              ⏹ 중단
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans leading-relaxed">
          {streamBuffer}
          {!streamDone && isActive && (
            <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-blink align-middle" />
          )}
        </pre>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
