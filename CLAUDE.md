# Patent Search AI — CLAUDE.md

> Claude Code가 이 파일을 자동으로 읽습니다.
> 새 세션을 시작할 때마다 아래 내용을 기반으로 대화를 이어갑니다.

---

## 프로젝트 개요

AI 기반 특허 검색·분석 데스크톱 앱.
특허 청구항을 입력하면 선행기술을 자동 검색하고, LLM으로 신규성·진보성을 분석한다.

**현재 버전:** Part 6 완료 (총 6 Part 구현됨)

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | Electron 31 |
| UI | React 18 + TypeScript 5 |
| 빌드 | electron-vite + Vite 5 |
| 스타일 | Tailwind CSS 3 |
| 상태관리 | Zustand 4 |
| DB | sql.js 1.12 (WASM SQLite) |
| 설정 | electron-store (경량 설정만) |
| LLM | @anthropic-ai/sdk (Claude API + CLI fallback) |
| 그래프 UI | @xyflow/react 12 (React Flow) |
| PDF 추출 | pdf-parse 2 |

---

## 폴더 구조

```
src/
├── main/                   # Electron 메인 프로세스
│   ├── db/DatabaseManager.ts       # sql.js SQLite 싱글턴
│   ├── llm/                        # LLM 프로바이더 (API / CLI / auto)
│   ├── search/                     # 2단계 검색 엔진 (BM25 + Vector + RRF + LLM rerank)
│   ├── pdf/PdfProcessor.ts         # PDF 추출 + context chunking
│   ├── project/ProjectManager.ts   # 프로젝트 직렬화/저장/불러오기
│   ├── export/ExportManager.ts     # Markdown / JSON 내보내기
│   └── ipc/                        # IPC 핸들러 (llm / search / settings / project)
├── preload/index.ts        # contextBridge — patentAPI 노출
├── renderer/               # React 앱
│   ├── App.tsx             # 탭 네비 + 프로젝트 툴바
│   ├── store/              # Zustand 스토어 (settings / search / workspace / project / toast)
│   └── components/
│       ├── workspace/      # 워크스페이스 UI (ClaimTree, NodeDetail, LeftInputPanel 등)
│       ├── SearchPanel.tsx
│       ├── ProviderSettings.tsx
│       ├── PromptStrategyPanel.tsx
│       ├── ErrorBoundary.tsx
│       └── ToastContainer.tsx
└── shared/                 # 공유 타입 (types.ts / searchTypes.ts / projectTypes.ts)
```

---

## 구현된 파트 현황

| Part | 내용 | 상태 |
|------|------|------|
| Part 1 | Electron 기반 앱 셸, 탭 네비, Tailwind 설정 | ✅ |
| Part 2 | LLM 레이어 (Claude API/CLI, 프롬프트 레지스트리, 스트리밍) | ✅ |
| Part 3 | 설정 UI (ProviderSettings, PromptStrategyPanel) | ✅ |
| Part 4 | 2단계 검색 엔진 (BM25 + TF-IDF + RRF + LLM rerank + 대비표) | ✅ |
| Part 5 | 인터랙티브 워크스페이스 (React Flow, Streaming, ContextControl) | ✅ |
| Part 6 | 프로젝트 저장/불러오기, PDF 입력, 내보내기, 에러 핸들링 | ✅ |
| Part 6 리팩터 | Claim-aware retrieval pipeline (PatentStructureParser → SemanticChunker → ClaimEnricher → multi-query BM25) | ✅ |

---

## DB 스키마 (sql.js SQLite, 현재 v3)

```
prompts              — 프롬프트 템플릿 버전 관리
search_history       — 검색 실행 이력
analysis_results     — LLM 분석 결과
patent_cache         — 특허 문서 캐시
search_candidates    — 1단계 후보 (BM25/vector/rrf 점수)
rerank_results       — 2단계 LLM 재순위 결과
claim_charts         — 대비표 JSON
projects             — 프로젝트 목록
project_workspace    — 워크스페이스 상태 스냅샷 (nodes/edges/context JSON)
project_searches     — 프로젝트 ↔ 검색 연결
```

---

## 코딩 규칙

- **언어:** TypeScript strict 모드. `any` 사용 금지, 불가피하면 `unknown` + 타입 가드
- **컴포넌트:** 함수형만. 클래스 컴포넌트는 ErrorBoundary 한 곳만 예외
- **스타일:** Tailwind CSS만 사용. 인라인 style은 동적 수치(px 값)에만 허용
- **IPC 채널:** 반드시 `src/shared/`의 `*_CHANNELS` 상수 사용. 문자열 하드코딩 금지
- **DB 접근:** `DatabaseManager` 싱글턴만 사용. 직접 파일 I/O 금지
- **에러 처리:** main 프로세스는 try/catch + 로그. renderer는 `toast.error()` 사용
- **한국어:** UI 텍스트, 주석, 커밋 메시지 한국어 가능. 타입명·변수명은 영어

---

## Claim-aware Retrieval Pipeline (Part 6 리팩터)

```
PDF 업로드
    ↓ PatentStructureParser
PatentStructure { sections[], claims[], figureRefs[] }
    ↓ SemanticChunker (700-1200자, 150자 overlap)
SemanticChunk[]   ← BM25 인덱스 대상
    ↓ FigureLinker (mutates chunks.figureRefs)
figure refs ↔ chunk IDs 연결
    ↓ ClaimEnricher (LLM, per-claim, spec-grounded only)
EnrichedClaim[] {
  components[]: { name, technicalConcepts, functionalRoles, synonyms, effects, supportingText }
  searchQueries[]: string[5-7]
  overallPurpose, technicalDomain
}
    ↓ CandidateRetriever (multi-query BM25 + TF-IDF + RRF)
외부 특허 DB 검색 — enrichedClaim.searchQueries 기반
    ↓ RerankerEngine (LLM, component-level)
RerankScore[]  →  ClaimChart(대비표)  →  PriorArtReport
```

**핵심 규칙:**
- ClaimEnricher는 반드시 명세서에 기재된 내용만 근거로 사용 (LLM 일반 지식 확대 금지)
- EnrichedClaim이 있으면 CandidateRetriever는 multiQueryBM25() 사용
- SemanticChunks는 claims 섹션을 제외하고 빌드 (청구항은 EnrichedClaim으로 별도 처리)
- ChunkRetriever는 기존 BM25Engine 재사용 (동일한 scoring)

## 절대 하지 말 것 (NEVER)

- `better-sqlite3` 설치 시도 — Electron native rebuild 필요, 현재 환경 불가
- `sql.js`를 JSON 파일 스토리지로 교체 — 관계형 구조 필수
- `electron-store`를 메인 DB로 확장 — 경량 설정(LLM 키·모드)에만 사용
- 프롬프트 전략 4종(`novelty` / `inventiveness` / `prior_art` / `claims_analysis`) 이름 변경
- `patentAPI` contextBridge 구조 무단 변경 — preload ↔ renderer 계약

---

## 자주 쓰는 패턴

### IPC 채널 추가 시
1. `src/shared/`에 채널 상수 추가
2. `src/main/ipc/`에 핸들러 파일 생성
3. `src/main/index.ts`에서 핸들러 등록
4. `src/preload/index.ts`에 API 노출
5. 렌더러에서 `window.patentAPI.xxx` 사용

### 새 DB 테이블 추가 시
`DatabaseManager.ts`에 `migrateVN()` 메서드 추가 후
`applyMigrations()`에 `if (currentVersion < N) this.migrateVN()` 추가

---

## 실행 방법

```bash
npm run dev      # 개발 서버 (Electron + Vite HMR)
npm run build    # 프로덕션 빌드
npm run typecheck  # 타입 검사
```
