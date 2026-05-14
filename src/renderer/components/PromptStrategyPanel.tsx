import React, { useEffect, useState, useCallback } from 'react'
import type { PromptTemplate, StrategyType } from '../../shared/types'

const STRATEGY_SHORT: Record<StrategyType, string> = {
  novelty:          '신규성',
  inventiveness:    '진보성',
  prior_art:        '유사특허조회',
  claims_analysis:  '청구항 추출',
}

const STRATEGIES = Object.keys(STRATEGY_SHORT) as StrategyType[]

// ─── Template Editor ─────────────────────────────────────────────────────────

interface EditorProps {
  template: PromptTemplate
  onSave: (t: PromptTemplate) => Promise<void>
  onActivate: (id: number) => Promise<void>
  saving: boolean
}

function TemplateEditor({ template, onSave, onActivate, saving }: EditorProps) {
  const [draft,      setDraft]      = useState(template)
  const [newVersion, setNewVersion] = useState('')
  const [saveAs,     setSaveAs]     = useState(false)

  useEffect(() => {
    setDraft(template)
    setNewVersion('')
    setSaveAs(false)
  }, [template.id])

  const isDirty = draft.template !== template.template || draft.name !== template.name

  const handleSave = async () => {
    await onSave({
      ...draft,
      version: saveAs && newVersion ? newVersion : draft.version,
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 shrink-0 bg-white">
        <input
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-700 focus:outline-none
                     border-b border-transparent focus:border-gray-300 truncate"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />

        <span className="font-mono text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
          v{draft.version}
        </span>

        {draft.isActive && (
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="활성" />
        )}

        <div className="flex gap-1.5 shrink-0">
          {!draft.isActive && (
            <button onClick={() => onActivate(draft.id)}
              className="px-2.5 py-1 text-xs rounded border border-green-300 bg-green-50
                         text-green-700 hover:bg-green-100 transition-colors">
              활성화
            </button>
          )}
          <button onClick={handleSave} disabled={!isDirty || saving}
            className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white
                       hover:bg-blue-500 disabled:opacity-40 transition-colors">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      {/* Save-as version row */}
      {isDirty && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={saveAs}
              onChange={(e) => setSaveAs(e.target.checked)} className="accent-blue-500" />
            새 버전으로 저장
          </label>
          {saveAs && (
            <input
              placeholder="예: 1.1.0"
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              className="bg-white border border-gray-300 rounded px-2 py-0.5 font-mono
                         text-xs text-gray-700 focus:outline-none focus:border-blue-400 w-24"
            />
          )}
        </div>
      )}

      {/* Template textarea */}
      <textarea
        className="flex-1 w-full bg-white text-gray-700 text-sm font-mono p-4
                   resize-none focus:outline-none placeholder-gray-300 leading-relaxed"
        value={draft.template}
        onChange={(e) => setDraft((d) => ({ ...d, template: e.target.value }))}
        spellCheck={false}
        placeholder="프롬프트 템플릿을 입력하세요…"
      />
    </div>
  )
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export default function PromptStrategyPanel(): React.ReactElement {
  const [strategy, setStrategy] = useState<StrategyType>('novelty')
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [selected, setSelected] = useState<PromptTemplate | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState<string | null>(null)

  const loadTemplates = useCallback(async (s: StrategyType) => {
    setLoading(true)
    setError(null)
    try {
      const all = await window.patentAPI.prompts.list(s)
      setTemplates(all)
      setSelected(all.find((t) => t.isActive) ?? all[0] ?? null)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTemplates(strategy) }, [strategy, loadTemplates])

  const handleSave = async (t: PromptTemplate) => {
    setSaving(true)
    try {
      const saved = await window.patentAPI.prompts.save({
        name: t.name, version: t.version, strategy: t.strategy,
        provider: t.provider, template: t.template,
        variables: t.variables, isActive: t.isActive,
      })
      setSelected(saved)
      await loadTemplates(strategy)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const handleActivate = async (id: number) => {
    try {
      await window.patentAPI.prompts.activate(id)
      await loadTemplates(strategy)
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* Strategy tabs */}
      <div className="flex border-b border-gray-200 shrink-0 bg-white">
        {STRATEGIES.map((s) => (
          <button key={s} onClick={() => setStrategy(s)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
              strategy === s
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {STRATEGY_SHORT[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-1.5 bg-red-50 border-b border-red-200 text-xs text-red-600 shrink-0">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Version sidebar */}
        <aside className="w-40 border-r border-gray-200 overflow-y-auto shrink-0 bg-gray-50">
          {loading ? (
            <div className="px-3 py-4 text-xs text-gray-400">로딩 중…</div>
          ) : templates.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-400">템플릿 없음</div>
          ) : (
            templates.map((t) => (
              <button key={t.id} onClick={() => setSelected(t)}
                className={`w-full text-left px-3 py-2 border-b border-gray-100
                            transition-colors flex items-center justify-between gap-1 ${
                  selected?.id === t.id
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-500 hover:bg-white hover:text-gray-700'
                }`}>
                <span className="font-mono text-[11px]">v{t.version}</span>
                {t.isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
              </button>
            ))
          )}
          <button
            onClick={() => {
              const active = templates.find((t) => t.isActive)
              if (!active) return
              setSelected({ ...active, id: -1, version: bumpVersion(active.version),
                isActive: false, createdAt: new Date().toISOString() })
            }}
            className="w-full text-left px-3 py-2 text-xs text-blue-500
                       hover:text-blue-600 hover:bg-white transition-colors">
            + 새 버전
          </button>
        </aside>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <TemplateEditor
              key={selected.id}
              template={selected}
              onSave={handleSave}
              onActivate={handleActivate}
              saving={saving}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-gray-400">
              템플릿을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function bumpVersion(v: string): string {
  const parts = v.split('.').map(Number)
  parts[parts.length - 1] += 1
  return parts.join('.')
}
