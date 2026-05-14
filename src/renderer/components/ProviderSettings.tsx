import React, { useCallback, useEffect, useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import type { ProviderCheckResult, ProviderMode, ProviderSettings as ProviderSettingsType } from '../../shared/types'

const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', detail: '균형형' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', detail: '빠른 응답' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', detail: '고난도 분석' },
]

const MODE_OPTIONS: Array<{ id: ProviderMode; label: string; detail: string }> = [
  { id: 'auto', label: '자동', detail: 'API를 먼저 쓰고 실패하면 CLI로 전환' },
  { id: 'api', label: 'API', detail: '키를 사용해 안정적으로 호출' },
  { id: 'cli', label: 'CLI', detail: '로컬 claude 명령어 사용' },
]

function SettingBlock({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="border-b border-slate-100 px-6 py-5 last:border-b-0">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
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
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
        {label}
        {hint && <span className="font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
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
  format: (value: number) => string
  onChange: (value: number) => void
}): React.ReactElement {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-teal-600"
        />
        <output className="w-20 text-right font-mono text-sm tabular-nums text-slate-700">
          {format(value)}
        </output>
      </div>
    </Field>
  )
}

function ConnectionTest(): React.ReactElement {
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [result, setResult] = useState<ProviderCheckResult | null>(null)

  const runCheck = async () => {
    setStatus('checking')
    setResult(null)
    try {
      const response = await window.patentAPI.llm.checkProvider()
      setResult(response)
      setStatus(response.available ? 'ok' : 'error')
    } catch (err) {
      setResult({ available: false, provider: 'unknown', mode: 'auto', error: String(err) })
      setStatus('error')
    }
  }

  const message = {
    idle: '아직 확인하지 않음',
    checking: '연결 확인 중',
    ok: `${result?.provider ?? 'Provider'} 연결됨${result?.latencyMs ? ` · ${result.latencyMs}ms` : ''}`,
    error: '연결 실패',
  }[status]

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">연결 상태</p>
          <p className={`mt-1 text-xs ${status === 'error' ? 'text-red-600' : status === 'ok' ? 'text-teal-700' : 'text-slate-500'}`}>
            {message}
          </p>
        </div>
        <button
          onClick={runCheck}
          disabled={status === 'checking'}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-teal-300 hover:text-teal-700 disabled:cursor-wait disabled:opacity-60"
        >
          {status === 'checking' ? '확인 중' : '연결 테스트'}
        </button>
      </div>
      {status === 'error' && result?.error && (
        <p className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {result.error}
        </p>
      )}
    </div>
  )
}

function TokenStatsPanel(): React.ReactElement {
  const [stats, setStats] = useState<{ total_input: number; total_output: number; count: number } | null>(null)

  const load = useCallback(async () => {
    try {
      setStats(await window.patentAPI.db.tokenStats())
    } catch {
      setStats(null)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (!stats || stats.count === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
        아직 누적된 AI 사용량이 없습니다.
      </div>
    )
  }

  const estimatedCost = ((stats.total_input / 1_000_000) * 3 + (stats.total_output / 1_000_000) * 15).toFixed(4)

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <p className="text-xs text-slate-400">분석 횟수</p>
        <p className="mt-1 font-mono text-sm font-semibold text-slate-800">{stats.count.toLocaleString()}회</p>
      </div>
      <div>
        <p className="text-xs text-slate-400">예상 비용</p>
        <p className="mt-1 font-mono text-sm font-semibold text-slate-800">${estimatedCost}</p>
      </div>
    </div>
  )
}

export default function ProviderSettings(): React.ReactElement {
  const { settings, loading, error, load, update } = useSettingsStore()
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => { load() }, [load])

  if (loading || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        설정을 불러오는 중입니다.
      </div>
    )
  }

  const set = <K extends keyof ProviderSettingsType>(key: K, value: ProviderSettingsType[K]) => {
    update({ [key]: value })
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <SettingBlock
        title="AI 연결 방식"
        description="대부분의 경우 자동을 권장합니다. API 키가 없으면 CLI 모드만 사용할 수 있습니다."
      >
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => set('mode', option.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                settings.mode === option.id
                  ? 'border-teal-300 bg-teal-50 text-teal-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-xs leading-5 opacity-80">{option.detail}</span>
            </button>
          ))}
        </div>
      </SettingBlock>

      <SettingBlock title="API 키" description="API 또는 자동 모드에서만 필요합니다. 저장하면 로컬 설정에 보관됩니다.">
        <Field label="Anthropic API Key">
          <div className="relative">
            <input
              type={apiKeyVisible ? 'text' : 'password'}
              value={settings.apiKey ?? ''}
              onChange={(e) => set('apiKey', e.target.value || undefined)}
              placeholder="sk-ant-api03-..."
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 pr-16 font-mono text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setApiKeyVisible((value) => !value)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              {apiKeyVisible ? '숨김' : '보기'}
            </button>
          </div>
        </Field>
      </SettingBlock>

      <SettingBlock title="모델">
        <div className="grid grid-cols-3 gap-2">
          {CLAUDE_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => set('model', model.id)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                settings.model === model.id
                  ? 'border-slate-900 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <span className="block text-sm font-semibold">{model.label}</span>
              <span className={`mt-1 block text-xs ${settings.model === model.id ? 'text-slate-300' : 'text-slate-400'}`}>
                {model.detail}
              </span>
            </button>
          ))}
        </div>
      </SettingBlock>

      <SettingBlock title="상태 확인">
        <ConnectionTest />
      </SettingBlock>

      <SettingBlock title="고급 설정">
        <button
          onClick={() => setShowAdvanced((value) => !value)}
          className="mb-4 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        >
          {showAdvanced ? '고급 설정 접기' : '고급 설정 열기'}
        </button>

        {showAdvanced && (
          <div className="space-y-4">
            <Field label="CLI 실행 경로" hint="PATH에 있으면 claude">
              <input
                type="text"
                value={settings.cliPath ?? 'claude'}
                onChange={(e) => set('cliPath', e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-sm text-slate-800 focus:border-teal-400 focus:outline-none"
              />
            </Field>
            <RangeField
              label="Temperature"
              hint="낮을수록 일관적"
              value={settings.temperature}
              min={0}
              max={1}
              step={0.05}
              format={(value) => value.toFixed(2)}
              onChange={(value) => set('temperature', value)}
            />
            <RangeField
              label="Max Tokens"
              hint="응답 길이"
              value={settings.maxTokens}
              min={512}
              max={16384}
              step={512}
              format={(value) => value.toLocaleString()}
              onChange={(value) => set('maxTokens', value)}
            />
            <RangeField
              label="Timeout"
              hint="최대 대기 시간"
              value={settings.timeout}
              min={10_000}
              max={300_000}
              step={10_000}
              format={(value) => `${value / 1000}s`}
              onChange={(value) => set('timeout', value)}
            />
            <TokenStatsPanel />
          </div>
        )}
      </SettingBlock>

      {error && (
        <div className="mx-6 mb-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
