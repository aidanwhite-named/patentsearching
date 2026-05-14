/**
 * WorkspacePanel — STEP 11: 메인 레이아웃 통합.
 *
 * ┌──────────────┬──────────────────────────────┬──────────────────┐
 * │ LeftInput    │  ClaimTree (React Flow)       │ NodeDetailPanel  │
 * │ [260px]      │  [flex-1]                     │ [380px]          │
 * │ ┌──────────┐ │                               │  (선택 시 표시)  │
 * │ │PDF 입력  │ │                               │                  │
 * │ │직접 입력 │ │                               │                  │
 * │ └──────────┘ │                               │                  │
 * └──────────────┴──────────────────────────────┴──────────────────┘
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ ContextControlPanel (collapsible drawer)                        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * StatusBar는 App.tsx에서 전역 렌더링.
 */

import React, { useState, useCallback } from 'react'
import ClaimTree from './ClaimTree'
import NodeDetailPanel from './NodeDetailPanel'
import ContextControlPanel from './ContextControlPanel'
import LeftInputPanel from './LeftInputPanel'
import PdfPreviewPanel from './PdfPreviewPanel'
import ClaimHierarchyPanel from './ClaimHierarchyPanel'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useProjectStore } from '../../store/projectStore'

export default function WorkspacePanel(): React.ReactElement {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [contextOpen, setContextOpen]       = useState(false)
  const { contextItems, nodes, enrichedClaims, patentStructure } = useWorkspaceStore()
  const { pdfPath } = useProjectStore()

  const handleNodeSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
  }, [])

  const activeContextCount = contextItems.filter((c) => c.useInRetrieval || c.useInReranking).length

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Main content row ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — PDF & Direct Input Panel (STEP 10/11) */}
        <div className="shrink-0 overflow-hidden" style={{ width: 260 }}>
          <LeftInputPanel />
        </div>

        {/* Center — switches between PDF preview / Claim hierarchy / React Flow tree */}
        <div
          className="flex flex-col overflow-hidden border-x border-gray-800"
          style={{ flex: 1 }}
        >
          {nodes.length > 0 ? (
            /* ④ After tree generation — React Flow canvas */
            <ClaimTree onNodeSelect={handleNodeSelect} />
          ) : enrichedClaims.length > 0 && patentStructure ? (
            /* ③ Enrichment done — claim hierarchy columns */
            <ClaimHierarchyPanel
              enrichedClaims={enrichedClaims}
              patentStructure={patentStructure}
            />
          ) : pdfPath && patentStructure ? (
            /* ① PDF parsed — actual PDF page preview via blob URL iframe */
            <PdfPreviewPanel
              pageCount={patentStructure.pageCount}
              claimCount={patentStructure.claims.length}
            />
          ) : (
            /* Default — empty ClaimTree canvas */
            <ClaimTree onNodeSelect={handleNodeSelect} />
          )}
        </div>

        {/* Right — Node Detail Panel (only when a node is selected) */}
        {selectedNodeId && (
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: 380 }}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 shrink-0 bg-gray-950">
              <span className="text-xs text-gray-500">노드 상세</span>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-xs text-gray-600 hover:text-gray-400"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <NodeDetailPanel nodeId={selectedNodeId} />
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom — Context Control drawer ──────────────────────────── */}
      <div
        className={`border-t border-gray-800 bg-gray-950 shrink-0 transition-all duration-200 ${
          contextOpen ? 'h-64' : 'h-8'
        }`}
      >
        <button
          onClick={() => setContextOpen(!contextOpen)}
          className="w-full h-8 flex items-center justify-between px-4 text-xs
                     text-gray-500 hover:text-gray-300 hover:bg-gray-900 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-gray-700">{contextOpen ? '▼' : '▲'}</span>
            <span>컨텍스트 제어</span>
            {activeContextCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-400 border border-blue-800 text-xs">
                {activeContextCount} 활성
              </span>
            )}
          </div>
          <span className="text-gray-700">URL · 메모 · 선행기술 참조 주입 제어</span>
        </button>
        {contextOpen && (
          <div className="h-56 overflow-hidden">
            <ContextControlPanel />
          </div>
        )}
      </div>
    </div>
  )
}
