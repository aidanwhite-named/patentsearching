import { create } from 'zustand'
import type {
  SearchQuery,
  SearchResult,
  SearchProgress,
  SearchSettings,
  ClaimChart,
  HybridSearchResult,
  SearchPhase,
  SearchPromptTemplate,
} from '../../shared/searchTypes'
import { DEFAULT_SEARCH_TEMPLATES } from '../../shared/searchTypes'

interface SearchState {
  // ── Settings ──────────────────────────────────────────────────────────
  settings: SearchSettings | null
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<SearchSettings>) => Promise<void>

  // ── 검색 전략 템플릿 ───────────────────────────────────────────────────
  searchTemplates: SearchPromptTemplate[]
  selectedTemplateId: string
  loadSearchTemplates: () => Promise<void>
  setSelectedTemplateId: (id: string) => void
  saveSearchTemplates: (templates: SearchPromptTemplate[]) => Promise<void>
  /** 현재 선택된 템플릿 객체 — searchInstruction 전달 시 사용 */
  getSelectedTemplate: () => SearchPromptTemplate | undefined

  // ── Query form ─────────────────────────────────────────────────────────
  queryText: string
  claimText: string
  cutoffDate: string
  selectedSources: SearchQuery['sources']
  setQueryText: (v: string) => void
  setClaimText: (v: string) => void
  setCutoffDate: (v: string) => void
  setSelectedSources: (v: SearchQuery['sources']) => void

  // ── Search state ───────────────────────────────────────────────────────
  phase: SearchPhase
  progress: SearchProgress | null
  result: SearchResult | null
  error: string | null
  cancelFn: (() => void) | null

  // ── Actions ────────────────────────────────────────────────────────────
  startSearch: () => void
  cancelSearch: () => void
  goHome: () => void   // 결과 화면 → 홈으로 돌아가기 (검색 상태 완전 초기화)

  // ── Selected candidate ────────────────────────────────────────────────
  selectedCandidate: HybridSearchResult | null
  selectedChart: ClaimChart | null
  selectCandidate: (c: HybridSearchResult) => void
  clearSelection: () => void
}

let _queryCounter = 0
function nextQueryId(): string {
  return `q-${Date.now()}-${++_queryCounter}`
}

const DEFAULT_SOURCES: SearchQuery['sources'] = ['patentsview', 'openalex']

export const useSearchStore = create<SearchState>((set, get) => ({
  // ── Settings ────────────────────────────────────────────────────────────
  settings: null,

  loadSettings: async () => {
    const settings = await window.patentAPI.search.getSettings()
    set({ settings })
  },

  updateSettings: async (patch) => {
    const settings = await window.patentAPI.search.setSettings(patch)
    set({ settings })
  },

  // ── 검색 전략 템플릿 ─────────────────────────────────────────────────────
  searchTemplates: DEFAULT_SEARCH_TEMPLATES,
  selectedTemplateId: 'auto',

  loadSearchTemplates: async () => {
    try {
      const templates = await window.patentAPI.settings.getSearchTemplates()
      set({ searchTemplates: templates })
    } catch (_) {
      // 실패 시 기본 템플릿 유지
    }
  },

  setSelectedTemplateId: (id) => set({ selectedTemplateId: id }),

  saveSearchTemplates: async (templates) => {
    const saved = await window.patentAPI.settings.saveSearchTemplates(templates)
    set({ searchTemplates: saved })
  },

  getSelectedTemplate: () => {
    const { searchTemplates, selectedTemplateId } = get()
    return searchTemplates.find((t) => t.id === selectedTemplateId)
  },

  // ── Query form ──────────────────────────────────────────────────────────
  queryText: '',
  claimText: '',
  cutoffDate: '',
  selectedSources: DEFAULT_SOURCES,
  setQueryText: (v) => set({ queryText: v }),
  setClaimText: (v) => set({ claimText: v }),
  setCutoffDate: (v) => set({ cutoffDate: v }),
  setSelectedSources: (v) => set({ selectedSources: v }),

  // ── Search state ────────────────────────────────────────────────────────
  phase: 'idle',
  progress: null,
  result: null,
  error: null,
  cancelFn: null,

  // ── Actions ─────────────────────────────────────────────────────────────
  startSearch: () => {
    const { queryText, claimText, cutoffDate, selectedSources, cancelFn, selectedTemplateId } = get()
    if (!queryText.trim() && !claimText.trim()) return

    // Cancel previous
    cancelFn?.()

    set({ phase: 'parsing_claim', progress: null, result: null, error: null })

    const query: SearchQuery = {
      id: nextQueryId(),
      queryText: queryText.trim() || claimText.trim(),
      cutoffDate: cutoffDate || undefined,
      sources: selectedSources,
      maxCandidatesPerSource: get().settings?.maxCandidatesPerSource ?? 100,
      language: 'both',
      parsedClaim: claimText.trim()
        ? undefined   // let SearchEngine parse it
        : undefined,
      promptTemplateId: selectedTemplateId !== 'auto' ? selectedTemplateId : undefined,
    }

    const cancel = window.patentAPI.search.start(query, {
      onProgress: (p) => set({ progress: p, phase: p.phase }),
      onComplete: (r) => set({ result: r, phase: 'complete', cancelFn: null }),
      onError: (msg) => set({ error: msg, phase: 'error', cancelFn: null }),
    })

    set({ cancelFn: cancel })
  },

  cancelSearch: () => {
    get().cancelFn?.()
    set({ cancelFn: null, phase: 'idle' })
  },

  goHome: () => {
    get().cancelFn?.()
    set({
      cancelFn: null, phase: 'idle',
      result: null, error: null, progress: null,
      selectedCandidate: null, selectedChart: null,
    })
  },

  // ── Selection ────────────────────────────────────────────────────────────
  selectedCandidate: null,
  selectedChart: null,

  selectCandidate: (c) => {
    const chart = get().result?.claimCharts.find((ch) => ch.patentNumber === c.doc.patentNumber)
    set({ selectedCandidate: c, selectedChart: chart ?? null })
  },

  clearSelection: () => set({ selectedCandidate: null, selectedChart: null }),
}))
