/**
 * AdapterRegistry — 검색 소스 어댑터 팩토리.
 *
 * 새 소스를 추가하는 방법:
 * 1. BaseAdapter를 상속한 FooAdapter 구현
 * 2. SearchSettings에 fooEnabled: boolean, fooApiKey?: string 추가
 * 3. SearchSource 타입에 'foo' 추가
 * 4. ADAPTER_MAP에 'foo' 엔트리 추가
 * 5. searchHandlers.ts / SearchEngine.ts DEFAULT_SETTINGS 업데이트
 *
 * 현재 지원 소스:
 *   patentsview  — USPTO PatentsView API (무료, 키 없음)
 *   kipris       — 한국 특허정보 API (API 키 필요)
 *   openalex     — OpenAlex 학술논문 API (기관 키 선택)
 *
 * 준비 중:
 *   espacenet    — EPO OPS (OAuth2 clientId/Secret 필요)
 *   semantic_scholar — Semantic Scholar Graph API
 *   bigquery     — Google Cloud BigQuery Patents (서비스 계정 필요)
 */

import { PatentsViewAdapter } from './PatentsViewAdapter'
import { KIPRISAdapter } from './KIPRISAdapter'
import { OpenAlexAdapter } from './OpenAlexAdapter'
// import { SemanticScholarAdapter } from './SemanticScholarAdapter'  // future
// import { BigQueryAdapter } from './BigQueryAdapter'               // future
// import { EspacenetAdapter } from './EspacenetAdapter'              // future
import type { BaseAdapter } from './BaseAdapter'
import type { SearchSettings, SearchSource } from '../../../shared/searchTypes'

/**
 * 설정과 소스 ID를 받아 어댑터 인스턴스를 반환한다.
 * credentials 미설정이면 null을 반환 (CandidateRetriever에서 skip 처리).
 */
export function createAdapter(
  source: SearchSource,
  settings: SearchSettings,
): BaseAdapter | null {
  const max = settings.maxCandidatesPerSource

  switch (source) {
    case 'patentsview':
      if (!settings.patentsViewEnabled) return null
      return new PatentsViewAdapter({ maxResults: max })

    case 'kipris':
      if (!settings.kiprisEnabled) return null
      if (!settings.kiprisApiKey) {
        console.warn('[AdapterRegistry] KIPRIS 활성화됨, API 키 미설정 — skip')
        return null
      }
      return new KIPRISAdapter({ apiKey: settings.kiprisApiKey, maxResults: max })

    case 'openalex':
      if (!settings.openAlexEnabled) return null
      return new OpenAlexAdapter({
        apiKey: settings.openAlexApiKey ?? '',
        maxResults: max,
      })

    default:
      console.warn(`[AdapterRegistry] 알 수 없는 소스: ${source as string}`)
      return null
  }
}

/**
 * 활성화된 모든 어댑터를 순서대로 반환한다.
 * sources 배열 순서 = 실행 순서.
 */
export function getEnabledAdapters(
  sources: SearchSource[],
  settings: SearchSettings,
): Array<{ source: SearchSource; adapter: BaseAdapter }> {
  const result: Array<{ source: SearchSource; adapter: BaseAdapter }> = []
  for (const source of sources) {
    const adapter = createAdapter(source, settings)
    if (adapter) result.push({ source, adapter })
  }
  return result
}
