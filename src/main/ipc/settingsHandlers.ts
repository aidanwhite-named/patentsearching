import { ipcMain } from 'electron'
import Store from 'electron-store'
import type { ProviderSettings } from '../../shared/types'
import { IPC_CHANNELS } from '../../shared/types'
import { getBigQueryUsage } from '../search/adapters/BigQueryAdapter'
import { DEFAULT_SEARCH_TEMPLATES } from '../../shared/searchTypes'
import type { SearchPromptTemplate } from '../../shared/searchTypes'
import { ProviderFactory } from '../llm/providers/ProviderFactory'

// ─── ClaimEnricher 기본 시스템 프롬프트 ──────────────────────────────────────
const DEFAULT_ENRICH_SYSTEM_PROMPT =
  '당신은 특허 명세서 분석 전문가입니다. 지시한 JSON 형식으로만 응답하십시오.'

interface StoreSchema {
  providerSettings: ProviderSettings
  searchPromptTemplates: SearchPromptTemplate[]
  enrichSystemPrompt: string
}

const DEFAULT_SETTINGS: ProviderSettings = {
  mode: 'auto',
  model: 'claude-sonnet-4-6',
  temperature: 0.3,
  maxTokens: 4096,
  timeout: 120_000,
  cliPath: 'claude',
}

const store = new Store<StoreSchema>({
  name: 'patent-search-settings',
  defaults: {
    providerSettings: DEFAULT_SETTINGS,
    searchPromptTemplates: DEFAULT_SEARCH_TEMPLATES,
    enrichSystemPrompt: DEFAULT_ENRICH_SYSTEM_PROMPT,
  },
})

export function getSettings(): ProviderSettings {
  return store.get('providerSettings')
}

export function registerSettingsHandlers(): void {
  // ── Provider settings ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): ProviderSettings => {
    return store.get('providerSettings')
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_event, patch: Partial<ProviderSettings>): ProviderSettings => {
      const current = store.get('providerSettings')
      const updated: ProviderSettings = { ...current, ...patch }
      store.set('providerSettings', updated)
      // Invalidate so next call re-resolves with new settings
      ProviderFactory.getInstance().invalidateCache()
      return updated
    }
  )

  // ── 검색 프롬프트 템플릿 ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SEARCH_TEMPLATES_GET, (): SearchPromptTemplate[] => {
    const stored = store.get('searchPromptTemplates', DEFAULT_SEARCH_TEMPLATES)
    // 빌트인 템플릿이 빠져있으면 앞에 병합
    const storedIds = new Set(stored.map((t) => t.id))
    const missing = DEFAULT_SEARCH_TEMPLATES.filter((t) => !storedIds.has(t.id))
    return [...missing, ...stored]
  })

  ipcMain.handle(
    IPC_CHANNELS.SEARCH_TEMPLATES_SAVE,
    (_event, templates: SearchPromptTemplate[]): SearchPromptTemplate[] => {
      store.set('searchPromptTemplates', templates)
      return templates
    }
  )

  // ── ClaimEnricher 시스템 프롬프트 ─────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.ENRICH_PROMPT_GET, (): string => {
    return store.get('enrichSystemPrompt', DEFAULT_ENRICH_SYSTEM_PROMPT)
  })

  ipcMain.handle(
    IPC_CHANNELS.ENRICH_PROMPT_SET,
    (_event, prompt: string): string => {
      store.set('enrichSystemPrompt', prompt)
      return prompt
    }
  )

  // ── BigQuery ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.BIGQUERY_GET_USAGE, () => getBigQueryUsage())
}
