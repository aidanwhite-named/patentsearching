import React, { useCallback } from 'react'
import type { EnrichedClaim, PatentStructure } from '../../../shared/patentTypes'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { toast } from '../../store/toastStore'

// ─── Claim card ───────────────────────────────────────────────────────────────

function ClaimCard({
  claim,
  isRoot,
}: {
  claim: EnrichedClaim
  isRoot: boolean
}): React.ReactElement {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
        isRoot
          ? 'border-blue-700 bg-blue-950/25'
          : 'border-gray-700/70 bg-gray-900/60'
      }`}
    >
      {/* Badges row */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span className={`text-xs font-semibold ${isRoot ? 'text-blue-300' : 'text-gray-300'}`}>
          청구항 {claim.claimNumber}
        </span>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded border ${
            isRoot
              ? 'bg-blue-900/50 text-blue-400 border-blue-800'
              : 'bg-gray-800 text-gray-500 border-gray-700'
          }`}
        >
          {isRoot ? '독립항' : '종속항'}
        </span>
        {claim.technicalDomain && (
          <span className="text-[9px] text-gray-600 truncate max-w-[120px]">
            {claim.technicalDomain}
          </span>
        )}
      </div>

      {/* Claim text (truncated) */}
      <p className="text-[11px] text-gray-400 leading-relaxed mb-2 line-clamp-3 font-mono">
        {claim.originalClaim.slice(0, 140)}{claim.originalClaim.length > 140 ? '…' : ''}
      </p>

      {/* Purpose */}
      {claim.overallPurpose && (
        <p className="text-[10px] text-gray-500 italic leading-relaxed mb-2 line-clamp-2">
          {claim.overallPurpose}
        </p>
      )}

      {/* Stats */}
      {(claim.components.length > 0 || claim.searchQueries.length > 0) && (
        <div className="flex items-center gap-3 text-[10px] text-gray-700">
          {claim.components.length > 0 && (
            <span>구성요소 {claim.components.length}개</span>
          )}
          {claim.searchQueries.length > 0 && (
            <span>검색쿼리 {claim.searchQueries.length}개</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  enrichedClaims: EnrichedClaim[]
  patentStructure: PatentStructure
}

export default function ClaimHierarchyPanel({
  enrichedClaims,
  patentStructure,
}: Props): React.ReactElement {
  const { initFromClaimText } = useWorkspaceStore()

  const handleBuildTree = useCallback(() => {
    if (!patentStructure?.claims?.length) return
    initFromClaimText(patentStructure.claims.join('\n\n'))
    toast.success('청구항 트리를 생성했습니다')
  }, [patentStructure, initFromClaimText])

  // Build a map for O(1) lookup
  const claimsMap = new Map(enrichedClaims.map((c) => [c.claimNumber, c]))

  // Resolve the root independent ancestor for any dependent claim
  function resolveRootParent(num: number): number {
    const c = claimsMap.get(num)
    if (!c || c.isIndependent || c.parentClaimNumber == null) return num
    return resolveRootParent(c.parentClaimNumber)
  }

  const independents = enrichedClaims.filter((c) => c.isIndependent)

  // Group all non-independent claims under their root independent parent
  const dependentsByRoot = new Map<number, EnrichedClaim[]>()
  for (const claim of enrichedClaims) {
    if (claim.isIndependent) continue
    const rootNum = resolveRootParent(claim.claimNumber)
    const bucket = dependentsByRoot.get(rootNum) ?? []
    bucket.push(claim)
    dependentsByRoot.set(rootNum, bucket)
  }

  const domains = [...new Set(enrichedClaims.map((c) => c.technicalDomain).filter(Boolean))]
  const depCount = enrichedClaims.length - independents.length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-800 bg-gray-900 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">청구항 분석 강화 결과</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            총 {enrichedClaims.length}개
            {' · '}독립항 <span className="text-blue-400">{independents.length}개</span>
            {' · '}종속항 {depCount}개
            {domains.length > 0 && (
              <span className="text-gray-600"> · {domains.slice(0, 2).join(', ')}</span>
            )}
          </p>
        </div>
        <button
          onClick={handleBuildTree}
          className="shrink-0 px-3 py-1.5 text-xs bg-green-800 hover:bg-green-700
                     text-green-200 rounded transition-colors"
        >
          ④ 청구항 트리 생성 →
        </button>
      </div>

      {/* Columns — horizontal scroll when many independent claims */}
      <div className="flex-1 overflow-auto p-4">
        <div className="flex gap-4 items-start">
          {independents.map((ic) => {
            const dependents = dependentsByRoot.get(ic.claimNumber) ?? []
            return (
              <div key={ic.claimNumber} className="flex-none w-68 flex flex-col gap-2" style={{ width: 272 }}>
                {/* Independent claim */}
                <ClaimCard claim={ic} isRoot={true} />

                {/* Dependent claims below, with a connector line */}
                {dependents.map((dc) => (
                  <div key={dc.claimNumber} className="ml-4 relative">
                    {/* Vertical + horizontal connector */}
                    <div className="absolute -left-4 top-0 bottom-1/2 border-l border-gray-700" />
                    <div className="absolute -left-4 top-1/2 w-4 border-t border-gray-700" />
                    <ClaimCard claim={dc} isRoot={false} />
                  </div>
                ))}
              </div>
            )
          })}

          {/* Orphan dependents — parent not matched to any independent (edge case) */}
          {enrichedClaims
            .filter(
              (c) =>
                !c.isIndependent &&
                (c.parentClaimNumber == null ||
                  !independents.find((ic) => ic.claimNumber === resolveRootParent(c.claimNumber))),
            )
            .map((c) => (
              <div key={c.claimNumber} className="flex-none" style={{ width: 272 }}>
                <ClaimCard claim={c} isRoot={false} />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
