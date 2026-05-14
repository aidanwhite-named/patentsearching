import React from 'react'
import type { ClaimChart, ClaimChartRow } from '../../shared/searchTypes'

interface Props {
  chart: ClaimChart
  onClose: () => void
}

const VERDICT_STYLES: Record<ClaimChartRow['verdict'], string> = {
  COVERED:     'bg-red-900/40 text-red-300 border border-red-700',
  PARTIAL:     'bg-yellow-900/40 text-yellow-300 border border-yellow-700',
  NOT_COVERED: 'bg-green-900/30 text-green-400 border border-green-800',
}

const VERDICT_LABELS: Record<ClaimChartRow['verdict'], string> = {
  COVERED:     '개시됨 (신규성 부정 가능)',
  PARTIAL:     '부분 개시',
  NOT_COVERED: '미개시',
}

const RISK_COLORS = {
  HIGH:   'text-red-400',
  MEDIUM: 'text-yellow-400',
  LOW:    'text-green-400',
}

export default function ClaimChartView({ chart, onClose }: Props): React.ReactElement {
  return (
    <div className="flex flex-col h-full bg-gray-900 overflow-auto">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-gray-700 shrink-0">
        <div className="flex-1 min-w-0 mr-4">
          <h2 className="text-sm font-semibold text-gray-100 truncate">{chart.title}</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-gray-400">{chart.patentNumber}</span>
            <a
              href={chart.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline truncate max-w-[240px]"
            >
              {chart.url}
            </a>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-lg leading-none shrink-0"
        >
          ✕
        </button>
      </div>

      {/* Risk summary */}
      <div className="flex gap-4 px-4 py-3 border-b border-gray-700 bg-gray-800/50 text-xs shrink-0">
        <span>
          종합 유사도:{' '}
          <span className="font-semibold text-white">
            {Math.round(chart.overallSimilarity * 100)}%
          </span>
        </span>
        <span>
          신규성 위험:{' '}
          <span className={`font-semibold ${RISK_COLORS[chart.noveltyRisk]}`}>
            {chart.noveltyRisk}
          </span>
        </span>
        <span>
          진보성 위험:{' '}
          <span className={`font-semibold ${RISK_COLORS[chart.inventivenessRisk]}`}>
            {chart.inventivenessRisk}
          </span>
        </span>
      </div>

      {/* Claim chart table */}
      <div className="flex-1 overflow-auto p-4">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left p-2 text-gray-400 font-medium w-6">구성</th>
              <th className="text-left p-2 text-gray-400 font-medium w-8">★</th>
              <th className="text-left p-2 text-gray-400 font-medium">청구항 구성요소</th>
              <th className="text-left p-2 text-gray-400 font-medium">선행기술 대응 텍스트</th>
              <th className="text-left p-2 text-gray-400 font-medium w-20">유사도</th>
              <th className="text-left p-2 text-gray-400 font-medium w-32">판정</th>
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => (
              <tr
                key={row.element.id}
                className="border-b border-gray-800 hover:bg-gray-800/30"
              >
                <td className="p-2 font-semibold text-blue-300 align-top">{row.element.id}</td>
                <td className="p-2 align-top text-yellow-400">
                  {'★'.repeat(row.element.importance)}{'☆'.repeat(3 - row.element.importance)}
                </td>
                <td className="p-2 text-gray-300 align-top leading-relaxed">{row.element.text}</td>
                <td className="p-2 text-gray-400 align-top italic leading-relaxed">
                  {row.priorArtText || <span className="text-gray-600">(없음)</span>}
                </td>
                <td className="p-2 align-top">
                  <div className="flex items-center gap-1">
                    <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          row.similarity >= 0.75 ? 'bg-red-500' :
                          row.similarity >= 0.4  ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.round(row.similarity * 100)}%` }}
                      />
                    </div>
                    <span className="text-gray-300 w-8 text-right">
                      {Math.round(row.similarity * 100)}%
                    </span>
                  </div>
                </td>
                <td className="p-2 align-top">
                  <span className={`px-2 py-0.5 rounded text-xs ${VERDICT_STYLES[row.verdict]}`}>
                    {VERDICT_LABELS[row.verdict]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        {chart.summary && (
          <div className="mt-4 p-3 bg-gray-800 rounded text-xs text-gray-300 leading-relaxed">
            <p className="text-gray-500 mb-1 font-medium">LLM 판단 요약</p>
            {chart.summary}
          </div>
        )}
      </div>
    </div>
  )
}
