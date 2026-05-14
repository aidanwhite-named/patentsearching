/**
 * VisualDiff — token-level text comparison with red/green highlighting.
 *
 * Algorithm: LCS (Longest Common Subsequence) on word tokens.
 *  - Green  = words present in prior art but not in claim (added context)
 *  - Red    = words in claim not found in prior art (novel / at-risk)
 *  - White  = matching words (shared)
 *
 * Both panels are displayed side-by-side with synchronized highlights.
 */

import React, { useMemo, useState } from 'react'

export interface DiffProps {
  claimText: string
  priorArtText: string
  claimLabel?: string
  priorArtLabel?: string
}

type TokenType = 'equal' | 'deleted' | 'inserted'

interface Token {
  text: string
  type: TokenType
}

// ─── LCS diff engine ──────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .split(/(\s+|[()[\]{},;:.!?'"。、])/)
    .filter((t) => t.trim().length > 0)
}

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp
}

function diffTokens(a: string[], b: string[]): { left: Token[]; right: Token[] } {
  const dp = lcs(a, b)
  const left: Token[]  = []
  const right: Token[] = []

  let i = a.length, j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      left.unshift({ text: a[i - 1], type: 'equal' })
      right.unshift({ text: b[j - 1], type: 'equal' })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      right.unshift({ text: b[j - 1], type: 'inserted' })
      j--
    } else {
      left.unshift({ text: a[i - 1], type: 'deleted' })
      i--
    }
  }

  return { left, right }
}

// ─── Rendering ────────────────────────────────────────────────────────────

const TOKEN_STYLES: Record<TokenType, string> = {
  equal:    'text-gray-300',
  deleted:  'bg-red-900/50 text-red-200 rounded px-0.5',
  inserted: 'bg-green-900/50 text-green-200 rounded px-0.5',
}

function TokenSpan({ token }: { token: Token }): React.ReactElement {
  return (
    <span className={`${TOKEN_STYLES[token.type]} whitespace-pre-wrap`}>
      {token.text}{' '}
    </span>
  )
}

// ─── Summary stats ────────────────────────────────────────────────────────

function diffStats(tokens: Token[]): { equal: number; changed: number; total: number } {
  const equal   = tokens.filter((t) => t.type === 'equal').length
  const changed = tokens.filter((t) => t.type !== 'equal').length
  return { equal, changed, total: tokens.length }
}

// ─── Main component ───────────────────────────────────────────────────────

export default function VisualDiff({ claimText, priorArtText, claimLabel = '내 청구항', priorArtLabel = '선행기술' }: DiffProps): React.ReactElement {
  const [mode, setMode] = useState<'side-by-side' | 'unified'>('side-by-side')

  const { left, right } = useMemo(() => {
    const a = tokenize(claimText)
    const b = tokenize(priorArtText)
    return diffTokens(a, b)
  }, [claimText, priorArtText])

  const leftStats  = diffStats(left)
  const rightStats = diffStats(right)
  const similarity = leftStats.total > 0
    ? Math.round((leftStats.equal / leftStats.total) * 100)
    : 0

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header / controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">텍스트 차이 비교</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">유사도</span>
            <span className={`font-semibold ${
              similarity >= 70 ? 'text-red-400' :
              similarity >= 40 ? 'text-yellow-400' : 'text-green-400'
            }`}>{similarity}%</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-red-800"/>
              청구항 고유 ({leftStats.changed})
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-green-800"/>
              선행기술 고유 ({rightStats.changed})
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {(['side-by-side', 'unified'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-xs px-2 py-1 rounded ${
                mode === m ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {m === 'side-by-side' ? '좌우 비교' : '통합 보기'}
            </button>
          ))}
        </div>
      </div>

      {/* Diff body */}
      {mode === 'side-by-side' ? (
        <div className="flex flex-1 overflow-hidden divide-x divide-gray-700">
          <DiffPane label={claimLabel} tokens={left} />
          <DiffPane label={priorArtLabel} tokens={right} />
        </div>
      ) : (
        <UnifiedView left={left} right={right} />
      )}
    </div>
  )
}

function DiffPane({ label, tokens }: { label: string; tokens: Token[] }): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-1.5 border-b border-gray-800 shrink-0">
        <span className="text-xs font-medium text-gray-400">{label}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-sm leading-7 font-mono">
          {tokens.map((t, i) => <TokenSpan key={i} token={t} />)}
        </p>
      </div>
    </div>
  )
}

function UnifiedView({ left, right }: { left: Token[]; right: Token[] }): React.ReactElement {
  // Interleave: show deletions then insertions per segment
  const lines: React.ReactElement[] = []
  let li = 0, ri = 0

  while (li < left.length || ri < right.length) {
    // Collect equal run
    if (left[li]?.type === 'equal' && right[ri]?.type === 'equal') {
      const text = left[li].text
      lines.push(
        <span key={`eq-${li}`} className="text-gray-300 whitespace-pre-wrap">{text} </span>
      )
      li++; ri++
      continue
    }
    // Collect deleted
    if (left[li]?.type === 'deleted') {
      lines.push(
        <span key={`del-${li}`} className="bg-red-900/50 text-red-200 rounded px-0.5 whitespace-pre-wrap">{left[li].text} </span>
      )
      li++
      continue
    }
    // Collect inserted
    if (right[ri]?.type === 'inserted') {
      lines.push(
        <span key={`ins-${ri}`} className="bg-green-900/50 text-green-200 rounded px-0.5 whitespace-pre-wrap">{right[ri].text} </span>
      )
      ri++
      continue
    }
    // Safety advance
    if (li < left.length) li++
    if (ri < right.length) ri++
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <p className="text-sm leading-7 font-mono">{lines}</p>
    </div>
  )
}
