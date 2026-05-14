/**
 * ClaimTree — React Flow canvas for the claim citation graph.
 *
 * Features:
 *  - Custom ClaimTreeNode for each claim
 *  - Auto-layout (dagre-style top-to-bottom tree via position assignment in store)
 *  - Toolbar: import claim text, fit-view, select-all
 *  - Right click on canvas → reset layout
 */

import React, { useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  BackgroundVariant,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ClaimTreeNode from './ClaimTreeNode'
import { useWorkspaceStore, type ClaimNode, type ClaimEdge } from '../../store/workspaceStore'

// Cast needed: React Flow NodeTypes uses the base Node<Record<string,unknown>> signature
// but our component uses the more specific Node<ClaimNodeData>
const NODE_TYPES: NodeTypes = { claimNode: ClaimTreeNode as NodeTypes[string] }

interface Props {
  onNodeSelect: (nodeId: string) => void
}

export default function ClaimTree({ onNodeSelect }: Props): React.ReactElement {
  const store = useWorkspaceStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<ClaimNode>(store.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<ClaimEdge>(store.edges)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const reactFlowRef = useRef<HTMLDivElement>(null)

  // Keep store in sync when nodes are dragged / added
  const handleNodesChange = useCallback(
    (changes: NodeChange<ClaimNode>[]) => {
      onNodesChange(changes)
    },
    [onNodesChange],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<ClaimEdge>[]) => {
      onEdgesChange(changes)
    },
    [onEdgesChange],
  )

  const handleConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  )

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: ClaimNode) => {
      store.selectNode(node.id)
      onNodeSelect(node.id)
    },
    [store, onNodeSelect],
  )

  // Import claims from text
  const handleImport = useCallback(() => {
    if (!importText.trim()) return
    store.initFromClaimText(importText)
    setNodes(store.nodes)
    setEdges(store.edges)
    setImportOpen(false)
    setImportText('')
  }, [importText, store, setNodes, setEdges])

  // Sync nodes from store when store.nodes changes externally
  React.useEffect(() => {
    setNodes(store.nodes)
    setEdges(store.edges)
  }, [store.nodes, store.edges, setNodes, setEdges])

  return (
    <div ref={reactFlowRef} className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        className="bg-gray-950"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#1f2937"
        />
        <Controls
          className="!bg-gray-800 !border-gray-700 [&>button]:!bg-gray-800 [&>button]:!text-gray-300
                     [&>button:hover]:!bg-gray-700 [&>button]:!border-gray-700"
          showInteractive={false}
        />
        <MiniMap
          nodeColor={(n) => {
            const data = n.data as { status?: string; noveltyRisk?: string }
            if (data.status === 'error') return '#ef4444'
            if (data.noveltyRisk === 'HIGH') return '#dc2626'
            if (data.noveltyRisk === 'MEDIUM') return '#d97706'
            if (data.status === 'done') return '#16a34a'
            if (data.status === 'searching' || data.status === 'reranking') return '#3b82f6'
            return '#374151'
          }}
          maskColor="rgba(0,0,0,0.6)"
          className="!bg-gray-900 !border-gray-700"
        />

        {/* Toolbar panel */}
        <Panel position="top-left">
          <div className="flex gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
            >
              + 청구항 가져오기
            </button>
            {nodes.length > 0 && (
              <button
                onClick={() => { store.setNodes([]); store.setEdges([]); setNodes([]); setEdges([]) }}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
              >
                초기화
              </button>
            )}
          </div>
        </Panel>
      </ReactFlow>

      {/* Import modal */}
      {importOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg w-[600px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm font-semibold text-gray-100">청구항 텍스트 가져오기</span>
              <button onClick={() => setImportOpen(false)} className="text-gray-500 hover:text-gray-300">✕</button>
            </div>
            <div className="p-4 flex-1 flex flex-col gap-3">
              <p className="text-xs text-gray-500">
                청구항 1, 2, 3... 형식으로 입력하면 자동으로 인용 트리를 생성합니다.
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={12}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200
                           font-mono leading-relaxed resize-none focus:outline-none focus:border-blue-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setImportOpen(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200"
                >취소</button>
                <button
                  onClick={handleImport}
                  disabled={!importText.trim()}
                  className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >트리 생성</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-center text-gray-700">
            <p className="text-4xl mb-3 opacity-30">⬡</p>
            <p className="text-sm">+ 청구항 가져오기로 트리를 생성하세요</p>
          </div>
        </div>
      )}
    </div>
  )
}

const PLACEHOLDER = `청구항 1. 스마트폰 화면 보호 방법에 있어서,
  (A) 사용자 입력을 수신하는 단계;
  (B) 입력을 처리하는 단계; 및
  (C) 결과를 출력하는 단계;
  를 포함하는 방법.

청구항 2. 청구항 1에 있어서, (D) 추가 처리 단계를 더 포함하는 방법.

청구항 3. 청구항 1에 있어서, 상기 (B) 단계가 AI 모델을 사용하는 방법.`
