import React, { useCallback, useEffect, useState } from 'react'
import type { BigQueryUsage, SearchSettings } from '../../shared/searchTypes'
import { BIGQUERY_FREE_TIER_BYTES, BIGQUERY_SOFT_LIMIT_BYTES } from '../../shared/searchTypes'

function formatGB(bytes: number): string {
  return (bytes / 1e9).toFixed(1)
}

function usagePercent(used: number): number {
  return Math.min(100, (used / BIGQUERY_FREE_TIER_BYTES) * 100)
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description: string
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors ${
        checked
          ? 'border-teal-300 bg-teal-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? 'bg-teal-600' : 'bg-slate-300'
      }`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`} />
      </span>
    </button>
  )
}

function Section({
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

export default function SearchSourceSettings(): React.ReactElement {
  const [settings, setSettings] = useState<SearchSettings | null>(null)
  const [usage, setUsage] = useState<BigQueryUsage | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [nextSettings, nextUsage] = await Promise.all([
      window.patentAPI.search.getSettings(),
      window.patentAPI.bigquery.getUsage(),
    ])
    setSettings(nextSettings)
    setUsage(nextUsage)
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (patch: Partial<SearchSettings>) => {
    setSaving(true)
    try {
      const updated = await window.patentAPI.search.setSettings(patch)
      setSettings(updated)
    } finally {
      setSaving(false)
    }
  }, [])

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        검색 소스 설정을 불러오는 중입니다.
      </div>
    )
  }

  const used = usage?.bytesUsedThisMonth ?? 0
  const usedPct = usagePercent(used)
  const nearLimit = used >= BIGQUERY_SOFT_LIMIT_BYTES

  return (
    <div className="h-full overflow-y-auto bg-white">
      <Section
        title="기본 검색 소스"
        description="처음에는 OpenAlex와 PatentsView만으로도 충분합니다. 필요한 소스만 켜두면 검색이 더 예측 가능합니다."
      >
        <div className="space-y-3">
          <Toggle
            checked={settings.openAlexEnabled}
            onChange={(checked) => save({ openAlexEnabled: checked })}
            label="OpenAlex"
            description="논문과 공개 학술 문헌을 빠르게 확인합니다."
          />
          <Toggle
            checked={settings.patentsViewEnabled}
            onChange={(checked) => save({ patentsViewEnabled: checked })}
            label="USPTO PatentsView"
            description="미국 특허 데이터를 검색합니다. 별도 키 없이 사용할 수 있습니다."
          />
        </div>
      </Section>

      <Section
        title="KIPRIS"
        description="한국 특허 검색이 필요할 때 켜세요. KIPRIS Open API 키가 필요합니다."
      >
        <div className="space-y-3">
          <Toggle
            checked={settings.kiprisEnabled}
            onChange={(checked) => save({ kiprisEnabled: checked })}
            label="KIPRIS 사용"
            description="한국 특허청 데이터를 함께 검색합니다."
          />
          {settings.kiprisEnabled && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">API 키</span>
              <input
                type="password"
                value={settings.kiprisApiKey ?? ''}
                onChange={(e) => save({ kiprisApiKey: e.target.value })}
                placeholder="KIPRIS Open API key"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
              />
            </label>
          )}
        </div>
      </Section>

      <Section
        title="BigQuery"
        description="전세계 특허 공개 데이터를 넓게 검색합니다. 앱은 월 무료 한도의 90%까지만 사용하도록 막고, 각 쿼리에도 maximumBytesBilled를 적용합니다."
      >
        <div className="space-y-4">
          <Toggle
            checked={settings.bigQueryEnabled}
            onChange={(checked) => save({ bigQueryEnabled: checked })}
            label="BigQuery 사용"
            description="Google Cloud 프로젝트와 gcloud 인증이 필요합니다."
          />

          {settings.bigQueryEnabled && (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">Google Cloud 프로젝트 ID</span>
                <input
                  type="text"
                  value={settings.bigQueryProjectId ?? ''}
                  onChange={(e) => save({ bigQueryProjectId: e.target.value })}
                  placeholder="my-gcp-project"
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
                />
              </label>

              <div className="rounded-md bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">로컬 인증</p>
                <code className="mt-2 block rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-teal-200">
                  gcloud auth application-default login
                </code>
              </div>
            </div>
          )}

          {usage && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">이번 달 BigQuery 사용량</span>
                <span className={`font-mono text-sm ${nearLimit ? 'text-red-600' : 'text-slate-600'}`}>
                  {formatGB(used)} GB / {formatGB(BIGQUERY_FREE_TIER_BYTES)} GB
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${nearLimit ? 'bg-red-500' : usedPct > 70 ? 'bg-amber-500' : 'bg-teal-500'}`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                앱 안전 한도는 {formatGB(BIGQUERY_SOFT_LIMIT_BYTES)} GB입니다. 완전한 과금 방지는 Google Cloud의 일일 Query quota도 함께 설정하는 것을 권장합니다.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section title="검색 동작">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">소스별 후보 수</span>
            <input
              type="number"
              min={5}
              max={100}
              value={settings.maxCandidatesPerSource}
              onChange={(e) => save({ maxCandidatesPerSource: Number(e.target.value) })}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-teal-400 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">RRF k</span>
            <input
              type="number"
              min={10}
              max={120}
              value={settings.rrfK}
              onChange={(e) => save({ rrfK: Number(e.target.value) })}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-teal-400 focus:outline-none"
            />
          </label>
        </div>
      </Section>

      {saving && (
        <div className="sticky bottom-4 mx-auto mb-4 w-fit rounded-full bg-slate-950 px-4 py-2 text-xs font-medium text-white shadow-lg">
          저장 중
        </div>
      )}
    </div>
  )
}
