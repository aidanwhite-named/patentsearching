import { create } from 'zustand'
import type { ProviderSettings } from '../../shared/types'

interface SettingsStore {
  settings: ProviderSettings | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  update: (patch: Partial<ProviderSettings>) => Promise<void>
}

const DEFAULT: ProviderSettings = {
  mode: 'auto',
  model: 'claude-sonnet-4-6',
  temperature: 0.3,
  maxTokens: 4096,
  timeout: 120_000,
  cliPath: 'claude',
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const s = await window.patentAPI.settings.get()
      set({ settings: s ?? DEFAULT, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false, settings: DEFAULT })
    }
  },

  update: async (patch) => {
    const prev = get().settings ?? DEFAULT
    // Optimistic update
    set({ settings: { ...prev, ...patch } })
    try {
      const updated = await window.patentAPI.settings.set(patch)
      set({ settings: updated })
    } catch (e) {
      // Rollback
      set({ settings: prev, error: String(e) })
    }
  },
}))
