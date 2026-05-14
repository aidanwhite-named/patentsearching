import { create } from 'zustand'
import type { Project } from '../../shared/projectTypes'

interface ProjectState {
  // ── Active project ──────────────────────────────────────────────────────────
  activeProject: Project | null
  setActiveProject: (p: Project | null) => void

  // ── PDF ─────────────────────────────────────────────────────────────────────
  pdfPath: string | null
  pdfText: string | null
  pdfPageCount: number
  pdfLoading: boolean
  setPdf: (path: string, text: string, pages: number) => void
  clearPdf: () => void
  setPdfLoading: (v: boolean) => void

  // ── Auto-save dirty flag ─────────────────────────────────────────────────────
  isDirty: boolean
  markDirty: () => void
  markClean: () => void

  // ── Project list (for open dialog) ──────────────────────────────────────────
  projects: Project[]
  setProjects: (ps: Project[]) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeProject: null,
  setActiveProject: (p) => set({ activeProject: p }),

  pdfPath: null,
  pdfText: null,
  pdfPageCount: 0,
  pdfLoading: false,
  setPdf: (path, text, pages) => set({ pdfPath: path, pdfText: text, pdfPageCount: pages }),
  clearPdf: () => set({ pdfPath: null, pdfText: null, pdfPageCount: 0 }),
  setPdfLoading: (v) => set({ pdfLoading: v }),

  isDirty: false,
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  projects: [],
  setProjects: (ps) => set({ projects: ps }),
}))
