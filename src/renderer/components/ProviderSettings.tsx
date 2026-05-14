import React, { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import type { ProviderMode, ProviderSettings, ProviderCheckResult } from '../../shared/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-7',          label: 'Claude Opus 4.7',   tier: 'powerful' },
  { id: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6', tier: 'balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'fast' },
]

const MODE_DESCRIPTIONS: Record<ProviderMode, string> = {
  api:  'Anthropic API 직접 호출 — API 키 필수, 토큰 비용 발생',
  cli:  'claude CLI 프로세스 실행 — 별도 설치 필요, 무료',
  auto: 'API 먼저 시도, 실패 시 CLI로 자동 전환',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-sky-200 rounded-xl p-5 bg-white shadow-sm">
      <h2 className="text-[11px] font-semibold text-sky-600 uppercase tracking-widest mb-4">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <label className="text-sm text-gray-700 font-medium">{label}</label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function RangeField({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
        />
        <output className="w-16 text-right text-sm text-blue-600 font-mono tabular-nums">
          {format(value)}
        </output>
      </div>
    </Field>
  )
}

// ─── Token Stats Panel ────────────────────────────────────────────────────────

function TokenStatsPanel() {
  const [stats, setStats] = useState<{
    total_input: number
    total_output: number
    count: number
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await window.patentAPI.db.tokenStats()
      setStats(s)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => n.toLocaleString()
  const estimatedCost =
    stats
      ? ((stats.total_input / 1_000_000) * 3 + (stats.total_output / 1_000_000) * 15).toFixed(4)
      : '—'

  return (
    <SectionCard title="토큰 사용량 (누적)">
      {loading ? (
        <p className="text-xs text-gray-500">불러오는 중…</p>
      ) : !stats || stats.count === 0 ? (
        <p className="text-xs text-gray-500">아직 분석 이력이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '분석 실행 횟수', value: fmt(stats.count) + '회' },
            { label: '예상 비용 (Sonnet 4.6 기준)', value: `$${estimatedCost}` },
            { label: 'Input Tokens', value: fmt(stats.total_input) },
            { label: 'Output Tokens', value: fmt(stats.total_output) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-sky-50 border border-sky-100 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className="text-sm font-mono text-gray-800 font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={load}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        새로고침
      </button>
    </SectionCard>
  )
}

// ─── Connection Test ──────────────────────────────────────────────────────────

type CheckStatus = 'idle' | 'checking' | 'ok' | 'error'

function ConnectionTest() {
  const [status, setStatus] = useState<CheckStatus>('idle')
  const [result, setResult] = useState<ProviderCheckResult | null>(null)

  const runCheck = async () => {
    setStatus('checking')
    setResult(null)
    try {
      const r = await window.patentAPI.llm.checkProvider()
      setResult(r)
      setStatus(r.available ? 'ok' : 'error')
    } catch (e) {
      setResult({ available: false, provider: 'unknown', mode: 'auto', error: String(e) })
      setStatus('error')
    }
  }

  const dotColor = {
    idle: 'bg-gray-300',
    checking: 'bg-yellow-400 animate-pulse',
    ok: 'bg-green-500',
    error: 'bg-red-500',
  }[status]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={runCheck}
          disabled={status === 'checking'}
          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200
                     disabled:opacity-50 transition-colors border border-gray-200"
        >
          {status === 'checking' ? '확인 중…' : '연결 테스트'}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          {status === 'idle' && '미확인'}
          {status === 'checking' && '프로브 중…'}
          {status === 'ok' && `연결됨 · ${result?.provider} (${result?.latencyMs}ms)`}
          {status === 'error' && '연결 실패'}
        </span>
      </div>
      {status === 'error' && result?.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {result.error}
        </p>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProviderSettings(): React.ReactElement {
  const { settings, loading, error, load, update } = useSettingsStore()
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [saveFlash, setSaveFlash] = useState(false)

  useEffect(() => { load() }, [load])

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        설정 불러오는 중…
      </div>
    )
  }

  const set = <K extends keyof ProviderSettings>(key: K, value: ProviderSettings[K]) =>
    update({ [key]: value })

  const handleSave = async () => {
    await update(settings)
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 2000)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-gray-800">LLM Provider 설정</h1>
          <button
            onClick={handleSave}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              saveFlash
                ? 'bg-green-500 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {saveFlash ? '저장됨 ✓' : '저장'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Provider mode */}
        <SectionCard title="Provider 모드">
          <div className="grid grid-cols-3 gap-2">
            {(['auto', 'api', 'cli'] as ProviderMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => set('mode', mode)}
                className={`rounded-xl p-3.5 text-left border transition-colors ${
                  settings.mode === mode
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <div className="text-sm font-semibold mb-1">{mode.toUpperCase()}</div>
                <div className="text-[11px] leading-relaxed opacity-75">
                  {MODE_DESCRIPTIONS[mode]}
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* API credentials */}
        <SectionCard title="API 설정">
          <Field label="Anthropic API 키" hint="Anthropic Console → API Keys">
            <div className="relative">
              <input
                type={apiKeyVisible ? 'text' : 'password'}
                value={settings.apiKey ?? ''}
                onChange={(e) => set('apiKey', e.target.value || undefined)}
                placeholder="sk-ant-api03-…"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm
                           text-gray-800 font-mono placeholder-gray-400
                           focus:outline-none focus:border-blue-400 pr-16"
              />
              <button
                onClick={() => setApiKeyVisible((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400
                           hover:text-gray-600 transition-colors px-1"
              >
                {apiKeyVisible ? '숨기기' : '표시'}
              </button>
            </div>
            {!settings.apiKey && settings.mode === 'api' && (
              <p className="mt-1.5 text-xs text-amber-500 flex items-center gap-1">
                <span>⚠</span> API 모드에서는 키가 필수입니다.
              </p>
            )}
          </Field>

          <Field label="모델">
            <div className="grid grid-cols-3 gap-2">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => set('model', m.id)}
                  className={`rounded-xl p-3 text-left border transition-colors ${
                    settings.model === m.id
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div className="text-xs font-medium">{m.label}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5 capitalize">{m.tier}</div>
                </button>
              ))}
            </div>
          </Field>
        </SectionCard>

        {/* CLI settings */}
        <SectionCard title="CLI 설정">
          <Field
            label="CLI 실행 경로"
            hint="PATH에 등록된 경우 'claude'만 입력"
          >
            <input
              type="text"
              value={settings.cliPath ?? 'claude'}
              onChange={(e) => set('cliPath', e.target.value)}
              placeholder="claude"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm
                         text-gray-800 font-mono placeholder-gray-400
                         focus:outline-none focus:border-blue-400"
            />
          </Field>
          <p className="text-xs text-gray-500">
            CLI 모드는 <code className="text-gray-400">claude -p &quot;프롬프트&quot;</code>를
            child_process.spawn으로 실행합니다.
            토큰 사용량은 CLI에서 노출되지 않아 0으로 기록됩니다.
          </p>
        </SectionCard>

        {/* Generation parameters */}
        <SectionCard title="생성 파라미터">
          <RangeField
            label="Temperature"
            hint="낮을수록 일관된 분석 / 높을수록 다양한 표현"
            value={settings.temperature}
            min={0} max={1} step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set('temperature', v)}
          />
          <RangeField
            label="Max Tokens"
            hint="응답 최대 길이"
            value={settings.maxTokens}
            min={512} max={16384} step={512}
            format={(v) => v.toLocaleString() + ' tk'}
            onChange={(v) => set('maxTokens', v)}
          />
          <RangeField
            label="Timeout"
            hint="CLI 모드에서 특히 중요"
            value={settings.timeout}
            min={10_000} max={300_000} step={10_000}
            format={(v) => `${v / 1000}s`}
            onChange={(v) => set('timeout', v)}
          />
        </SectionCard>

        {/* Connection test */}
        <SectionCard title="연결 테스트">
          <p className="text-xs text-gray-500 mb-3">
            현재 설정 저장 후 테스트하세요. API 모드는 최소 토큰(1)을 소비합니다.
          </p>
          <ConnectionTest />
        </SectionCard>

        {/* Token usage */}
        <TokenStatsPanel />
      </div>
    </div>
  )
}
