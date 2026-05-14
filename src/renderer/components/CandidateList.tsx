import React from 'react'
import type { HybridSearchResult, RerankScore, SourceType } from '../../shared/searchTypes'

interface Props {
  candidates: HybridSearchResult[]
  reranked: RerankScore[]
  selectedId: string | null
  onSelect: (c: HybridSearchResult) => void
}

const SOURCE_LABELS: Record<SourceType, string> = {
  patentsview: 'USPTO PatentsView',
  kipris:      'KIPRIS',
  openalex:    'OpenAlex',
  bigquery:    'BigQuery',
}

const SOURCE_COLORS: Record<SourceType, string> = {
  patentsview: 'text-blue-400',
  kipris:      'text-green-400',
  openalex:    'text-purple-400',
  bigquery:    'text-cyan-400',
}

export default function CandidateList({ candidates, reranked, selectedId, onSelect }: Props): React.ReactElement {
  const rerankedMap = new Map(reranked.map((r) => [r.docId, r]))

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {candidates.map((c) => {
        const rr = rerankedMap.get(c.doc.id)
        const isSelected = c.doc.id === selectedId
        const score = rr?.weightedScore ?? Math.round(c.rrfScore * 10000)
        const hasChart = rr !== undefined

        return (
          <button
            key={c.doc.id}
            onClick={() => onSelect(c)}
            className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
              isSelected ? 'bg-blue-900/20 border-l-2 border-l-blue-500' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="shrink-0 w-6 text-center text-xs text-gray-600 mt-0.5">
                {c.rank}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-200 leading-snug line-clamp-2 flex-1">
                    {c.doc.title || c.doc.patentNumber}
                  </p>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <ScoreBadge score={score} hasLLM={hasChart} />
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
                  <span className={SOURCE_COLORS[c.doc.source]}>
                    {SOURCE_LABELS[c.doc.source]}
                  </span>
                  <span>{c.doc.patentNumber}</span>
                  {c.doc.publicationDate && (
                    <span>{c.doc.publicationDate.slice(0, 10)}</span>
                  )}
                  {c.doc.urlValid === false && (
                    <span className="text-red-400">URL 유효하지 않음</span>
                  )}
                </div>

                {c.doc.abstract && (
                  <p className="mt-1 text-xs text-gray-500 line-clamp-2 leading-relaxed">
                    {c.doc.abstract}
                  </p>
                )}

                {rr && (rr.noveltyThreat || rr.inventivenessThreat) && (
                  <div className="flex gap-2 mt-1">
                    {rr.noveltyThreat && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800">
                        신규성 위협
                      </span>
                    )}
                    {rr.inventivenessThreat && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-800">
                        진보성 위협
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </button>
        )
      })}

      {candidates.length === 0 && (
        <div className="flex items-center justify-center h-full text-sm text-gray-600">
          검색 결과 없음
        </div>
      )}
    </div>
  )
}

function ScoreBadge({ score, hasLLM }: { score: number; hasLLM: boolean }): React.ReactElement {
  const color =
    score >= 70 ? 'text-red-400' :
    score >= 40 ? 'text-yellow-400' : 'text-green-400'

  return (
    <div className="text-right">
      <span className={`text-sm font-bold ${color}`}>{score}</span>
      <span className="text-xs text-gray-600 ml-0.5">{hasLLM ? 'LLM' : 'RRF'}</span>
    </div>
  )
}
