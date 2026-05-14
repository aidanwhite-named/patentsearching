/**
 * workspaceStore — global state for the Interactive Workspace (Part 5).
 *
 * Owns:
 *  - Claim tree nodes (React Flow nodes/edges)
 *  - Selected node + right-panel state
 *  - Streaming analysis output
 *  - Context-augmentation toggles
 *  - Agent status + token usage (status bar)
 */

import { create } from 'zustand'
import { type Node, type Edge } from '@xyflow/react'
import type { ClaimElement } from '../../shared/searchTypes'
import type { PatentStructure, SemanticChunk, EnrichedClaim } from '../../shared/patentTypes'

// ─── Claim tree node data ─────────────────────────────────────────────────

export type ClaimNodeStatus =
  | 'idle'
  | 'searching'
  | 'reranking'
  | 'done'
  | 'error'

export interface ClaimNodeData extends Record<string, unknown> {
  label: string           // claim number / element id
  claimText: string       // full text of this claim
  claimNumber: number
  isIndependent: boolean
  elements: ClaimElement[]
  status: ClaimNodeStatus
  noveltyRisk?: 'HIGH' | 'MEDIUM' | 'LOW'
  inventivenessRisk?: 'HIGH' | 'MEDIUM' | 'LOW'
  topMatchTitle?: string
  topMatchScore?: number
  promptId?: string       // which prompt template is selected for this node
}

export type ClaimNode = Node<ClaimNodeData>
export type ClaimEdge = Edge

// ─── Context augmentation toggles ────────────────────────────────────────

export interface ContextItem {
  id: string
  type: 'url' | 'note' | 'prior_art'
  label: string
  content: string
  useInRetrieval: boolean
  useInReranking: boolean
}

// ─── Agent event log ──────────────────────────────────────────────────────

export type AgentEventType = 'info' | 'warn' | 'error' | 'tool' | 'llm'

export interface AgentEvent {
  id: string
  type: AgentEventType
  message: string
  timestamp: number
  nodeId?: string
}

// ─── Token usage ──────────────────────────────────────────────────────────

export interface SessionTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

// ─── Store shape ──────────────────────────────────────────────────────────

interface WorkspaceState {
  // ── Claim tree ─────────────────────────────────────────────────────────
  nodes: ClaimNode[]
  edges: ClaimEdge[]
  setNodes: (nodes: ClaimNode[]) => void
  setEdges: (edges: ClaimEdge[]) => void
  updateNodeData: (nodeId: string, patch: Partial<ClaimNodeData>) => void
  selectedNodeId: string | null
  selectNode: (id: string | null) => void
  initFromClaimText: (rawText: string) => void

  // ── Streaming analysis ─────────────────────────────────────────────────
  streamingNodeId: string | null
  streamBuffer: string
  streamDone: boolean
  cancelStream: (() => void) | null
  startStream: (nodeId: string, cancelFn: () => void) => void
  appendChunk: (delta: string) => void
  finishStream: () => void
  clearStream: () => void

  // ── Context items (URL, notes) ─────────────────────────────────────────
  contextItems: ContextItem[]
  setContextItems: (items: ContextItem[]) => void
  addContextItem: (item: Omit<ContextItem, 'id'>) => void
  removeContextItem: (id: string) => void
  toggleContextItem: (id: string, field: 'useInRetrieval' | 'useInReranking') => void

  // ── Agent event log ────────────────────────────────────────────────────
  events: AgentEvent[]
  pushEvent: (type: AgentEventType, message: string, nodeId?: string) => void
  clearEvents: () => void

  // ── Token usage ────────────────────────────────────────────────────────
  tokenUsage: SessionTokenUsage
  addTokenUsage: (input: number, output: number) => void
  resetTokenUsage: () => void

  // ── Claim-aware pipeline state ─────────────────────────────────────────
  patentStructure: PatentStructure | null
  semanticChunks: SemanticChunk[]
  enrichedClaims: EnrichedClaim[]
  enrichmentLoading: boolean
  setPatentStructure: (s: PatentStructure | null) => void
  setSemanticChunks: (c: SemanticChunk[]) => void
  setEnrichedClaims: (claims: EnrichedClaim[]) => void
  setEnrichmentLoading: (v: boolean) => void
  getEnrichedClaim: (claimNumber: number) => EnrichedClaim | undefined
}

let _eventCounter = 0
const COST_PER_INPUT_TOKEN  = 0.000003   // claude-3-5-sonnet-20241022 prices
const COST_PER_OUTPUT_TOKEN = 0.000015

const ZERO_USAGE: SessionTokenUsage = {
  inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0,
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  // ── Claim tree ─────────────────────────────────────────────────────────
  nodes: [],
  edges: [],

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  updateNodeData: (nodeId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    })),

  selectedNodeId: null,
  selectNode: (id) => set({ selectedNodeId: id }),

  initFromClaimText: (rawText) => {
    const { nodes, edges } = parseClaimsToGraph(rawText)
    set({ nodes, edges, selectedNodeId: null })
  },

  // ── Streaming ───────────────────────────────────────────────────────────
  streamingNodeId: null,
  streamBuffer: '',
  streamDone: false,
  cancelStream: null,

  startStream: (nodeId, cancelFn) =>
    set({ streamingNodeId: nodeId, streamBuffer: '', streamDone: false, cancelStream: cancelFn }),

  appendChunk: (delta) =>
    set((s) => ({ streamBuffer: s.streamBuffer + delta })),

  finishStream: () =>
    set({ streamDone: true, cancelStream: null }),

  clearStream: () => {
    get().cancelStream?.()
    set({ streamingNodeId: null, streamBuffer: '', streamDone: false, cancelStream: null })
  },

  // ── Context items ───────────────────────────────────────────────────────
  contextItems: [],

  setContextItems: (items) => set({ contextItems: items }),

  addContextItem: (item) => {
    const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => ({ contextItems: [...s.contextItems, { ...item, id }] }))
  },

  removeContextItem: (id) =>
    set((s) => ({ contextItems: s.contextItems.filter((c) => c.id !== id) })),

  toggleContextItem: (id, field) =>
    set((s) => ({
      contextItems: s.contextItems.map((c) =>
        c.id === id ? { ...c, [field]: !c[field] } : c,
      ),
    })),

  // ── Agent event log ─────────────────────────────────────────────────────
  events: [],

  pushEvent: (type, message, nodeId) => {
    const event: AgentEvent = {
      id: `ev-${++_eventCounter}`,
      type,
      message,
      timestamp: Date.now(),
      nodeId,
    }
    set((s) => ({ events: [event, ...s.events].slice(0, 200) }))
  },

  clearEvents: () => set({ events: [] }),

  // ── Token usage ─────────────────────────────────────────────────────────
  tokenUsage: ZERO_USAGE,

  addTokenUsage: (input, output) =>
    set((s) => {
      const next = {
        inputTokens: s.tokenUsage.inputTokens + input,
        outputTokens: s.tokenUsage.outputTokens + output,
        totalTokens: s.tokenUsage.totalTokens + input + output,
        estimatedCostUsd:
          s.tokenUsage.estimatedCostUsd +
          input * COST_PER_INPUT_TOKEN +
          output * COST_PER_OUTPUT_TOKEN,
      }
      return { tokenUsage: next }
    }),

  resetTokenUsage: () => set({ tokenUsage: ZERO_USAGE }),

  // ── Claim-aware pipeline ─────────────────────────────────────────────────
  patentStructure:    null,
  semanticChunks:     [],
  enrichedClaims:     [],
  enrichmentLoading:  false,
  setPatentStructure: (s) => set({ patentStructure: s }),
  setSemanticChunks:  (c) => set({ semanticChunks: c }),
  setEnrichedClaims:  (claims) => set({ enrichedClaims: claims }),
  setEnrichmentLoading: (v) => set({ enrichmentLoading: v }),
  getEnrichedClaim: (num) =>
    get().enrichedClaims.find((ec) => ec.claimNumber === num),
}))

// ─── Claim text → React Flow graph ────────────────────────────────────────

function parseClaimsToGraph(rawText: string): { nodes: ClaimNode[]; edges: ClaimEdge[] } {
  // Split on claim boundaries: "청구항 N" / "Claim N" / numbered paragraphs
  const claimRe = /(?:청구항|Claim|claim)\s*(\d+)[.:）\s]/gi
  const parts: { num: number; text: string }[] = []

  const matches = [...rawText.matchAll(/(?:청구항|Claim|claim)\s*(\d+)[.:）\s]/gi)]
  if (matches.length === 0) {
    // Treat entire text as claim 1
    parts.push({ num: 1, text: rawText.trim() })
  } else {
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index! + matches[i][0].length
      const end   = matches[i + 1]?.index ?? rawText.length
      parts.push({ num: parseInt(matches[i][1], 10), text: rawText.slice(start, end).trim() })
    }
  }

  // Detect dependency: "청구항 N에 있어서" / "claim N,"
  const depRe = /(?:청구항|claim)\s*(\d+)(?:에\s*있어서|,)/i

  const nodes: ClaimNode[] = parts.map((p, i) => {
    const depMatch = p.text.match(depRe)
    const isIndependent = !depMatch

    const COLS  = 3
    const col   = i % COLS
    const row   = Math.floor(i / COLS)
    const X_GAP = 320
    const Y_GAP = 180

    return {
      id: `claim-${p.num}`,
      type: 'claimNode',
      position: { x: col * X_GAP, y: row * Y_GAP },
      data: {
        label: `청구항 ${p.num}`,
        claimText: p.text,
        claimNumber: p.num,
        isIndependent,
        elements: [],
        status: 'idle',
        promptId: undefined,
      },
    }
  })

  const edges: ClaimEdge[] = []
  for (const p of parts) {
    const depMatch = p.text.match(depRe)
    if (depMatch) {
      const parentNum = parseInt(depMatch[1], 10)
      edges.push({
        id: `e${parentNum}-${p.num}`,
        source: `claim-${parentNum}`,
        target: `claim-${p.num}`,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#4b5563' },
      })
    }
  }

  return { nodes, edges }
}
