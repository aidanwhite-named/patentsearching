/**
 * PdfPreviewPanel — PDF 파일을 patent:// 커스텀 프로토콜로 표시한다.
 *
 * 이전 구현의 문제:
 *   1. readBuffer() IPC → base64 → Uint8Array → Blob → blob: URL 변환 (불필요한 왕복)
 *   2. blob: URL을 <iframe>에 사용 → Chromium PDF 뷰어 플러그인이 추가 origin 요청
 *   3. 페이지 CSP의 frame-src가 해당 origin을 허용하지 않아 ERR_BLOCKED_BY_CSP 발생
 *
 * 현재 구현:
 *   - pdfPath를 patent://pdf?path=... URL로 직접 변환
 *   - main 프로세스의 protocol.handle('patent', ...) 이 파일을 읽어 application/pdf로 반환
 *   - IPC 왕복 없음, Buffer 직렬화 없음, blob URL 없음
 *   - CSP에 frame-src patent: 만 추가하면 되므로 보안 구조 유지
 */

import React, { useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'

interface Props {
  pageCount: number
  claimCount: number
}

/**
 * pdfPath를 patent:// 프로토콜 URL로 변환한다.
 * main/index.ts의 protocol.handle('patent', ...) 핸들러가 이 URL을 처리한다.
 *
 * 형식: patent://pdf?path=<urlencoded-absolute-path>
 *
 * Windows 경로 예: C:\Users\...\file.pdf
 *   → patent://pdf?path=C%3A%5CUsers%5C...%5Cfile.pdf
 */
function toPatentUrl(filePath: string): string {
  return `patent://pdf?path=${encodeURIComponent(filePath)}`
}

export default function PdfPreviewPanel({ pageCount, claimCount }: Props): React.ReactElement {
  const { pdfPath } = useProjectStore()

  // pdfPath가 변경될 때만 URL을 재계산한다
  const patentUrl = useMemo(
    () => (pdfPath ? toPatentUrl(pdfPath) : null),
    [pdfPath],
  )

  const fileName = pdfPath?.split(/[\\/]/).pop() ?? ''

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-950">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800">
        <span className="text-[10px] text-gray-500 uppercase tracking-widest">PDF 미리보기</span>
        <span className="text-[10px] text-gray-700">·</span>
        <span className="text-xs text-gray-400 truncate max-w-[260px] font-mono">{fileName}</span>
        <span className="text-[10px] text-gray-600 ml-auto shrink-0">
          {pageCount}p · {claimCount}개 청구항
        </span>
      </div>

      {/* PDF iframe — patent:// 프로토콜로 CSP 없이 안전하게 표시 */}
      <div className="flex-1 relative overflow-hidden">
        {patentUrl ? (
          <iframe
            key={patentUrl}        // URL 변경 시 iframe 완전 재마운트
            src={patentUrl}
            className="w-full h-full border-0"
            title="PDF 미리보기"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
            <p className="text-xs text-gray-600">PDF를 선택하면 미리보기가 표시됩니다</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-1.5 bg-gray-900 border-t border-gray-800 text-center">
        <p className="text-[10px] text-gray-700">
          분석이 완료되면 워크스페이스에서 결과를 확인할 수 있습니다
        </p>
      </div>
    </div>
  )
}
