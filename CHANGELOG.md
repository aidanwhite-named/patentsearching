# Patent Search — 업데이트 명세서

> 작성일: 2026-05-14  
> 대상 버전: v0.1.0 → v0.2.0 (대규모 리팩터 + 기능 개선)

---

## 목차

1. [UI/UX 디자인 및 레이아웃](#1-uiux-디자인-및-레이아웃)
2. [핵심 기능 개선 및 오류 수정](#2-핵심-기능-개선-및-오류-수정)
3. [코드 정리 및 효율화](#3-코드-정리-및-효율화)
4. [수정 파일 목록](#4-수정-파일-목록)

---

## 1. UI/UX 디자인 및 레이아웃

### 1-1. 앱 이름 및 저작권

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| 헤더 타이틀 | `patent AI` | `Patent Search` |
| HomeView h1 | `Patent AI` | `Patent Search` |
| 우측 하단 저작권 | 없음 | `© AIdan. All rights reserved.` |

- **파일**: `src/renderer/App.tsx`
- 헤더 `<span>` 및 홈 화면 `<h1>` 수정.
- `<footer>` 엘리먼트를 앱 최하단에 추가, `border-t border-gray-100` 구분선 포함.

---

### 1-2. 창 컨트롤 버튼 (최소화 / 닫기)

- **파일**: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`

**변경 내용**

```
main/index.ts   → ipcMain import 추가, window:minimize / window:close 핸들러 등록
preload/index.ts → patentAPI.window.{ minimize, close } 노출
App.tsx         → 헤더 우측에 최소화(─) 및 닫기(✕) 버튼 추가
```

- `_mainWindow` 모듈 레벨 변수로 창 참조를 IPC 핸들러에 전달.
- 닫기 버튼은 `hover:text-red-500` 위험색상 강조.

---

### 1-3. 설정 화면 개선

#### 배경색 변경
- `bg-gray-950 text-gray-100` → **`bg-sky-50 text-gray-800`** (하늘색 라이트 테마)
- **파일**: `src/renderer/App.tsx` — `SettingsModal` 내부 컨테이너

#### ProviderSettings 라이트 테마 전환
- **파일**: `src/renderer/components/ProviderSettings.tsx`
- 모든 다크 색상 클래스를 라이트 팔레트로 교체:
  - `border-gray-800` → `border-sky-200`
  - `bg-gray-900` → `bg-white` / `bg-sky-50`
  - `text-gray-100/200/300` → `text-gray-700/800`
  - `SectionCard` → `bg-white shadow-sm` 카드 스타일 적용
  - 버튼·입력 필드·뱃지 전반 라이트 모드로 교체

#### 프롬프트 탭 제거
- **파일**: `src/renderer/App.tsx`
- 이전: `SettingsTab = 'llm' | 'prompts'` 탭 2개
- 변경: 탭 구조 제거, `ProviderSettings` 를 설정 모달에 직접 렌더링
- 설정 모달 높이를 `h-[82vh]` 로 고정하여 LLM/프롬프트 탭 간 크기 불일치 문제 해결
- `PromptStrategyPanel` import 제거 (신규성·진보성·선행기술·청구항 전략 4종 UI 삭제)

> ⚠️ 주의: 백엔드 `StrategyType` 및 DB 스키마(`prompts` 테이블)는 유지.  
> LLM 분석 파이프라인 내부에서 계속 사용.

---

### 1-4. 워크스페이스 / 프로젝트 생성 제거

- **파일**: `src/renderer/App.tsx`
- 제거된 요소:
  - 워크스페이스 버튼 (`GridIcon`) + `WorkspaceModal` + `WorkspacePanel` import
  - 프로젝트 버튼 (`FolderIcon`) + `ProjectModal`
  - 저장 / 내보내기 버튼 (`handleSave`, `ExportMenu`, `handleSelectProject`)
  - `showWorkspace`, `showProjects`, `saving` 상태 변수

- 유지된 요소 (PDF 파이프라인에 필요):
  - `useProjectStore` — `pdfPath`, `pdfPageCount`, `pdfLoading`, `setPdf` 등
  - `useWorkspaceStore` — `enrichedClaims`, `patentStructure`, `semanticChunks` 등

---

### 1-5. 뒤로 가기 버튼

- **파일**: `src/renderer/store/searchStore.ts`, `src/renderer/App.tsx`

**searchStore에 `goHome()` 액션 추가**

```ts
goHome: () => {
  get().cancelFn?.()
  set({
    cancelFn: null, phase: 'idle',
    result: null, error: null, progress: null,
    selectedCandidate: null, selectedChart: null,
  })
},
```

- 검색 결과 화면(`hasResults === true`)에서 헤더 좌측에 `← 뒤로` 버튼 노출.
- 클릭 시 진행 중인 검색 취소 + 모든 결과·오류 상태 초기화 → 홈 화면 복귀.
- 오류 상태(`phase === 'error'`)에서도 동일하게 동작.

---

## 2. 핵심 기능 개선 및 오류 수정

### 2-1. PDF 드래그 앤 드롭 지원

- **파일**: `src/renderer/App.tsx` — `PdfUploadArea` 컴포넌트

**구현 내용**

| 이벤트 | 처리 내용 |
|--------|----------|
| `onDragOver` | 기본 동작 방지, `isDragging = true` |
| `onDragLeave` | `isDragging = false` |
| `onDrop` | `e.dataTransfer.files[0].path` 로 Electron 파일 경로 획득 → `processPdf()` 호출 |

- `ElectronFile extends File { path: string }` 인터페이스로 타입 안전성 확보.
- 드래그 중 버튼이 파란 테두리 + 배경으로 강조 (`border-blue-400 bg-blue-50`).
- PDF 이외 파일 드롭 시 `toast.error('PDF 파일만 지원합니다')` 알림.
- 핵심 파이프라인(`processPdf`)을 클릭/드롭 공용 함수로 분리하여 코드 중복 제거.

---

### 2-2. 청구항 트리 구조 시각화

- **파일**: `src/renderer/App.tsx` — `ClaimTreePanel` 컴포넌트

**구현 내용**

- PDF 분석 완료 후 홈 화면 입력 카드 아래에 `ClaimTreePanel` 자동 표시.
- `EnrichedClaim.isIndependent` / `parentClaimNumber` 필드를 이용한 계층 구조 생성.
- 독립항(파란 배지) → 종속항(회색 배지) 계층 표시.
- 클릭으로 하위 항목 접기/펼치기(`collapsed` Set 상태).
- 최대 높이 `max-h-56` + 스크롤로 긴 목록 처리.
- 헤더에 전체 청구항 수, 독립항/종속항 카운트 표시.

---

### 2-3. 기준일 날짜 검출 로직 완전 수정

- **파일**: `src/main/pdf/PatentStructureParser.ts` — `extractPatentDate()`
- **파일**: `src/shared/patentTypes.ts` — `PatentStructure.publicationDate` 필드

**우선순위 변경**

```
구) 공개일 → 공고일 → 등록일 → 출원일 → 폴백

신) 1순위: (30) 우선권주장  ← WIPO 서지코드 (30) 또는 '우선권주장' 키워드
    2순위: (22) 심사청구일자 ← WIPO 서지코드 (22), '심사청구일자', '출원일자'
    3순위: 공개일·등록일·Filing Date 등 일반 키워드
    폴백:  헤더 첫 번째 ISO-like 날짜
```

**주요 개선 사항**

- 탐색 범위 4,000자 → **6,000자** 확장 (서지사항이 문서 앞쪽에 길게 분포).
- `findDate(keyword, searchLen)` 헬퍼 함수로 탐색 로직 추상화.
- 연도 유효성 검증: `1980 < year ≤ 현재연도+1`.
- 추출된 날짜는 `YYYY-MM-DD` 형식으로 정규화 후 `structure.publicationDate` 에 저장.
- `PdfUploadArea`에서 날짜 자동 주입: `setCutoffDate(structure.publicationDate)` + toast 알림.

---

### 2-4. PatentsView API 오류 수정

- **파일**: `src/main/search/adapters/PatentsViewAdapter.ts`

**오류 원인**

> `[PatentsView] search failed: Unexpected token '<', "<!doctype "... is not valid JSON`

GET + URLSearchParams 방식으로 긴 JSON 쿼리를 URL에 인코딩할 때 서버가  
JSON 대신 HTML 오류 페이지를 반환하는 문제.

**수정 내용**

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| HTTP 메서드 | GET | **POST** |
| 요청 본문 | URL 파라미터 (`?q=...&f=...`) | JSON body (`Content-Type: application/json`) |
| 쿼리 포맷 | `_text_any: { patent_title, patent_abstract }` | `_or: [ _text_any title, _text_any abstract ]` |
| 쿼리 길이 제한 | 400자 | **150자** (API 안정성 향상) |
| 정렬 | 없음 | `s: [{ patent_date: 'desc' }]` (최신순) |
| Accept 헤더 | 없음 | `Accept: application/json` 추가 |

```ts
// 수정 후 핵심 로직
const body = JSON.stringify({
  q: {
    _or: [
      { _text_any: { patent_title: queryText } },
      { _text_any: { patent_abstract: queryText } },
    ],
  },
  f: FIELDS,
  o: { per_page: perPage, page: 1 },
  s: [{ patent_date: 'desc' }],
})
await this.fetchJSON<PVResponse>(BASE_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body,
})
```

---

## 3. 코드 정리 및 효율화

| 항목 | 내용 |
|------|------|
| `WorkspaceModal` | 함수 + import 완전 제거 |
| `ProjectModal` | 함수 + import 완전 제거 |
| `ExportMenu` | 함수 완전 제거 |
| `handleSave` | 프로젝트 저장 핸들러 제거 |
| `handleSelectProject` | 프로젝트 로드 핸들러 제거 |
| `PromptStrategyPanel` | App.tsx import 제거, UI에서 미사용 |
| `GridIcon`, `FolderIcon` | 미사용 아이콘 컴포넌트 제거 |
| `SettingsTab` 타입 | `'llm' \| 'prompts'` → 제거 (탭 미사용) |
| `saving` 상태 | 프로젝트 저장 상태 변수 제거 |
| `processPdf` | 클릭/드롭 공용 함수로 분리, 중복 로직 제거 |

**번들 크기 변화**

| 번들 | 변경 전 | 변경 후 |
|------|---------|---------|
| `out/renderer/assets/index.js` | 298.66 kB | 290.79 kB | 
| `out/main/index.js` | 138.05 kB | 138.58 kB |

---

## 4. 수정 파일 목록

```
src/
├── main/
│   ├── index.ts                              ← ipcMain 추가, 창 컨트롤 IPC 핸들러
│   ├── pdf/
│   │   └── PatentStructureParser.ts          ← 날짜 추출 우선순위 수정
│   └── search/
│       └── adapters/
│           └── PatentsViewAdapter.ts         ← POST 방식 + OR 쿼리 수정
├── preload/
│   └── index.ts                              ← patentAPI.window.{ minimize, close } 노출
├── renderer/
│   ├── App.tsx                               ← 대규모 리팩터 (뒤로가기, D&D, 설정 간소화)
│   ├── components/
│   │   └── ProviderSettings.tsx              ← 라이트 테마 전환
│   └── store/
│       └── searchStore.ts                    ← goHome() 액션 추가
└── shared/
    └── patentTypes.ts                        ← PatentStructure.publicationDate 필드 추가
```

---

*Patent Search by AIdan — © AIdan. All rights reserved.*
