/**
 * Search source adapter factory.
 *
 * 새 검색 소스를 추가할 때는 다음을 함께 갱신한다.
 * 1. BaseAdapter를 상속한 FooAdapter 구현
 * 2. SearchSettings에 fooEnabled / 필요한 인증 필드 추가
 * 3. SearchSource 타입에 'foo' 추가
 * 4. createAdapter() switch에 'foo' 분기 추가
 * 5. searchHandlers.ts / SearchEngine.ts 기본 설정 갱신
 *
 * 현재 지원 소스: patentsview, kipris, openalex, bigquery
 */

import { PatentsViewAdapter } from './PatentsViewAdapter'
import { KIPRISAdapter } from './KIPRISAdapter'
import { OpenAlexAdapter } from './OpenAlexAdapter'
import { BigQueryAdapter } from './BigQueryAdapter'
import type { BaseAdapter } from './BaseAdapter'
import type { SearchSettings, SearchSource } from '../../../shared/searchTypes'

/**
 * 설정과 소스 ID를 받아 어댑터 인스턴스를 반환한다.
 * 인증 정보가 부족하면 null을 반환하고 CandidateRetriever가 건너뛴다.
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
        console.warn('[AdapterRegistry] KIPRIS enabled but API key is missing. Skipping.')
        return null
      }
      return new KIPRISAdapter({ apiKey: settings.kiprisApiKey, maxResults: max })

    case 'openalex':
      if (!settings.openAlexEnabled) return null
      return new OpenAlexAdapter({
        apiKey: settings.openAlexApiKey ?? '',
        maxResults: max,
      })

    case 'bigquery':
      if (!settings.bigQueryEnabled) return null
      if (!settings.bigQueryProjectId) {
        console.warn('[AdapterRegistry] BigQuery enabled but Project ID is missing. Skipping.')
        return null
      }
      return new BigQueryAdapter({
        projectId: settings.bigQueryProjectId,
        maxResults: max,
      }) as unknown as BaseAdapter

    default:
      console.warn(`[AdapterRegistry] Unknown source: ${source as string}`)
      return null
  }
}

/**
 * 활성화된 어댑터를 sources 배열 순서대로 반환한다.
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
