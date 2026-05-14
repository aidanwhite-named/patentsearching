# 패치 노트 — 2026-05-14

## 개요

| 구분 | 내용 |
|------|------|
| 작업일 | 2026-05-14 |
| 대상 버전 | Part 6 리팩터 이후 |
| 주요 변경 | 디버깅 로그 강화 / 다중 프롬프트 선택 / 종속항 인식 버그 수정 / 청구항 구조 패널 개선 |

---

## 1. API 에러 추적 강화

**파일:** `src/main/search/adapters/BaseAdapter.ts`

### 문제
PatentsView 등 외부 API가 HTML 에러 페이지를 반환할 때 JSON 파싱 오류만 발생하고, 실제 원인(URL 오류, 쿼리 문법 오류, 서버 장애 등)을 알 수 없었음.

### 변경 내용
API를 호출할 때마다 터미널에 아래 항목이 자동 출력된다.

**호출 전 — 요청 상세:**
```
────────────────────────────────────────────────────────────
[patentsview] ▶ API 요청
  Method  : POST
  URL     : https://search.patentsview.org/api/v1/patent/
  Headers : {"Content-Type":"application/json","Accept":"application/json"}
  Body    : {"q":{"_or":[{"_text_any":{"patent_title":"..."}},...]},...}
────────────────────────────────────────────────────────────
```

**HTTP 에러 시 — 상태코드 + 원본 응답 전문:**
```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
[patentsview] ✖ HTTP 422 오류
  URL     : https://search.patentsview.org/api/v1/patent/
  Status  : 422 Unprocessable Entity
  Content-Type: text/html; charset=utf-8
  Raw Response (처음 3000자):
  <!DOCTYPE html><html>...에러 페이지 전문...
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```

**JSON이 아닌 응답(HTML 등) 수신 시 별도 경고:**
```
[patentsview] ✖ JSON이 아닌 응답 수신
  Content-Type: text/html; charset=utf-8
  Raw Response (처음 1000자): <!DOCTYPE html>...
```

### 에러 코드 해석 가이드
| HTTP 상태 | 의미 | 조치 |
|-----------|------|------|
| 404 | 엔드포인트 URL 오류 | `PatentsViewAdapter.ts`의 `BASE_URL` 확인 |
| 422 | 쿼리 JSON 구조 오류 | API 스펙 문서 확인, 쿼리 필드명 재확인 |
| 429 | 요청 횟수 초과 | 자동 재시도(최대 3회) — Retry-After 헤더 준수 |
| 500 | 서버 측 장애 | 일시적 장애, 잠시 후 재시도 |
| HTML 응답 | 인증 실패 또는 API 폐기 | API 키 확인 또는 신규 엔드포인트 확인 |

---

## 2. PDF 파싱 / 날짜 / 청구항 추출 디버깅 로그

**파일:** `src/main/pdf/PatentStructureParser.ts`

### 문제
날짜 추출 및 청구항 분리가 실패해도 터미널에 아무 출력이 없어 원인 파악 불가.

### 변경 내용
PDF 업로드 시 다음이 자동 출력된다.

**파싱 시작 — 원본 텍스트 첫 1,500자:**
```
======================================================================
[PatentParser] PDF 파싱 시작
  파일: C:\Users\...\KR10-2023-0012345.pdf
  페이지: 14
  전체 텍스트 길이: 42,310자 / 1,204줄

  [원본 텍스트 — 처음 1500자]
  (10) 공개번호  10-2023-0012345
  (22) 출원일자  2023.01.17
  ...
======================================================================
```

**청구항 분리 과정:**
```
[PatentParser] 청구항 분리 시작 — 원본 청구항 텍스트 길이: 5,231자
  청구항 텍스트 첫 300자: 청구항 1. 방법에 있어서, (A) …
  "청구항 N" 패턴으로 10개 청구항 추출
  [청구항 1] 첫 80자: 방법에 있어서, (A) 입력 신호를 수신하는 단계; (B) …
  [청구항 2] 첫 80자: 제1항에 있어서, 상기 수신하는 단계는 …
```

**날짜 추출 결과 (우선순위 순):**
```
[PatentParser] 날짜 추출 성공 [2순위 출원일]: 2023-01-17
```

실패 시:
```
[PatentParser] 날짜 추출 실패 — 서지사항에서 날짜를 찾을 수 없음
  헤더 샘플 (처음 500자): ...
```

**파싱 결과 요약:**
```
──────────────────────────────────────────────────────────────────────
[PatentParser] 파싱 결과 요약
  발명 제목: 그래프 데이터베이스의 질의를 최적화하는 장치 및 방법
  섹션 수  : 9개
    - [technical_field       ] 기술분야 (287자)
    - [background            ] 배경기술 (2,104자)
    - [solution              ] 해결수단 (1,843자)
    - [claims                ] 특허청구범위 (5,231자)
    ...
  청구항 수: 10개
  날짜     : 2023-01-17
──────────────────────────────────────────────────────────────────────
```

### 청구항 0개 문제 진단 방법
터미널에서 확인:
1. `청구항 텍스트 길이: 0자` → 섹션 감지 실패
   - 원본 텍스트에 "청구범위", "청구항", "claims" 등 섹션 헤더가 있는지 확인
2. `"청구항 N" 패턴 없음 — 번호 패턴("1. ") 폴백 시도` → 청구항 번호 형식 다름
   - `1. 방법에 있어서...` 형태면 폴백이 자동 처리

---

## 3. LLM 프롬프트·응답 전문 로깅

**파일:** `src/main/claim/ClaimEnricher.ts`

### 문제
LLM에 어떤 프롬프트가 전달되는지, 응답이 어떻게 오는지 확인 불가.

### 변경 내용
청구항 강화(enrich) 시 청구항마다 출력:

**LLM 호출 전 — 전체 프롬프트:**
```
──────────────────────────────────────────────────────────────────────
[ClaimEnricher] 청구항 1 — LLM 호출

  [시스템 프롬프트]
  당신은 특허 명세서 분석 전문가입니다. 지시한 JSON 형식으로만 응답하십시오.

  [유저 프롬프트 전체]
  당신은 특허 명세서 분석 전문가입니다...
  [절대 규칙] 1. 아래 명세서 내용에 기재된 정보만 사용...
  ...
──────────────────────────────────────────────────────────────────────
```

**LLM 응답 후 — Raw 응답 전문:**
```
──────────────────────────────────────────────────────────────────────
[ClaimEnricher] 청구항 1 — LLM 응답 (Raw)
  {"components":[{"name":"인터페이스","technicalConcepts":["그래프 질의 변환"],...}],...}
──────────────────────────────────────────────────────────────────────
```

JSON 파싱 실패 시:
```
[ClaimEnricher] JSON parse failed, returning minimal enrichment: SyntaxError: ...
```
→ Raw 응답을 보고 포맷 문제 원인 파악 가능

---

## 4. 다중 검색 전략 프롬프트 선택 UI

**파일:**
- `src/shared/searchTypes.ts` — `SearchPromptTemplate` 타입 + 기본 5종
- `src/main/ipc/settingsHandlers.ts` — CRUD 핸들러
- `src/preload/index.ts` — `settings.getSearchTemplates` 등 API 노출
- `src/renderer/store/searchStore.ts` — 선택 상태 관리
- `src/renderer/App.tsx` — 드롭다운 UI

### 드롭다운 위치
홈 화면 입력 카드 하단 바:
```
[ 소스: USPTO OpenAlex ] | [ 검색 전략 ▾ ] [ 날짜 ] [ 검색 ]
```

### 기본 제공 템플릿 5종

| ID | 이름 | 검색 방향 |
|----|------|----------|
| `auto` | 자동 (기본) | 균형 잡힌 종합 분석 (추가 지시 없음) |
| `structural` | 구성요소 중심 | 부품·장치·연결 관계 강조 |
| `functional` | 기능/효과 중심 | 기술적 효과·기능적 목적 강조 |
| `application` | 응용분야 중심 | 산업 분야·사용 환경 강조 |
| `broad` | 광범위 검색 | 동의어·상위 개념까지 포함 |

### 동작 방식
1. 드롭다운에서 전략 선택
2. PDF 업로드 시 해당 전략의 **instruction**이 `ClaimEnricher` LLM 프롬프트에 삽입
3. LLM이 해당 관점으로 `searchQueries` 5~7개를 생성
4. `auto` 선택 시 기존 동작과 완전히 동일

### 커스텀 템플릿 저장
```typescript
await window.patentAPI.settings.saveSearchTemplates([
  ...currentTemplates,
  {
    id: 'my-custom',
    name: '나만의 전략',
    description: '설명',
    instruction: 'LLM에 추가로 전달할 검색 지시사항...',
  },
])
```
`electron-store`에 저장되므로 앱 재시작 후에도 유지.

---

## 5. 종속항 인식 정규식 버그 수정

**파일:** `src/main/claim/ClaimEnricher.ts`

### 문제
기존 정규식이 `청구항 N에 있어서` 패턴만 인식하고,
실제 한국 특허에서 가장 많이 쓰이는 **`제N항에 있어서`** 패턴을 완전히 무시했다.

결과적으로 모든 청구항이 독립항으로 분류되어 청구항 구조 트리가 평면으로만 표시됐다.

### 수정 전 (버그)
```typescript
function isIndependentClaim(claimText: string): boolean {
  // "제N항" 패턴 누락!
  return !/(?:청구항|claim)\s*\d+\s*(?:에\s*있어서|에\s*따른|,\s*wherein)/i.test(claimText)
}
```

### 수정 후
```typescript
function isIndependentClaim(claimText: string): boolean {
  const depPattern =
    /(?:제\s*\d+\s*항(?:\s*내지\s*제\s*\d+\s*항)?\s*(?:중\s*어느\s*한\s*항)?\s*(?:에\s*있어서|에\s*따른|의\s*방법))|(?:청구항\s*\d+\s*(?:에\s*있어서|에\s*따른))|(?:claim\s*\d+\s*(?:,\s*wherein|of\b))/i
  return !depPattern.test(claimText)
}
```

### 이제 인식되는 모든 패턴

| 패턴 | 예시 |
|------|------|
| `제N항에 있어서` | "제1항에 있어서," |
| `제N항에 따른` | "제2항에 따른 장치에 있어서," |
| `제N항 내지 제M항 중 어느 한 항에 있어서` | "제1항 내지 제3항 중 어느 한 항에 있어서," |
| `청구항 N에 있어서` | "청구항 1에 있어서," |
| `claim N, wherein` | "claim 1, wherein the device…" |
| `claim N of` | "claim 1 of claim 5…" |

---

## 6. 청구항 구조 패널 — 화면 우측 절반으로 이동

**파일:** `src/renderer/App.tsx`

### 레이아웃 변경
```
[이전]
┌─────────────────────────────────┐
│     로고 + 입력 카드 (중앙)       │
│  [청구항 구조 — 아래 작은 박스]   │
└─────────────────────────────────┘

[이후]
┌──────────────────────┬──────────────────────┐
│  로고 + 입력 카드     │  청구항 구조 패널     │
│       (좌 54%)        │       (우 46%)        │
│                      │  ─ 항상 표시          │
│                      │  ─ 전체 높이          │
└──────────────────────┴──────────────────────┘
```

### 청구항 구조 패널 동작 상태

| 상태 | 표시 내용 |
|------|----------|
| 아무것도 없음 | "청구항을 입력하거나 PDF를 업로드하면 구조가 표시됩니다" |
| 텍스트 직접 입력 | 정규식으로 파싱 → 독립/종속 트리 *(텍스트 파싱)* 뱃지 |
| PDF 업로드 완료 | LLM 분석 결과 → 풍부한 트리 *(LLM 분석)* 뱃지 |

### 트리 구조 표시 예시 (LLM 분석 후)
```
청구항 구조    독립항 2개 · 종속항 8개  (LLM 분석)
번호 클릭 → 구성요소 (A)(B)(C) 펼치기
─────────────────────────────────────────────
[1]  그래프 데이터베이스 질의 최적화 장치     독립항
     (A) 인터페이스
     (B) 관계형 질의 최적화기
     └─ [3]  제1항에 있어서, 인터페이스는 …
     └─ [4]  제1항에 있어서, 최적화기는 …
     └─ [5]  제1항에 있어서, 시스템은 …
[6]  그래프 데이터베이스 질의 최적화 방법     독립항
     (A) 그래프 질의를 변환하는 단계
     (B) 관계형 논리 플랜을 최적화하는 단계
     └─ [8]  제6항에 있어서, 변환 단계는 …
     └─ [9]  제6항 내지 제8항 중 어느 한 항에 있어서 …
```

- **번호 뱃지 클릭** → 해당 청구항의 구성요소 (A)(B)(C) 펼침/접힘
- **`▶/▼` 클릭** → 하위 종속항 펼침/접힘
- 독립항: 파란 뱃지 `ring-blue-200`
- 종속항: 회색 뱃지

---

## 7. claims_analysis 프롬프트 복원

**파일:** `src/main/llm/PromptRegistry.ts`

### 변경 내용
기존 `claims_analysis` v1.0.0(JSON 출력 방식)을 비활성화하고,
사용자 요청 원본 프롬프트를 **v2.0.0**으로 추가·활성화.

**v2.0.0 프롬프트 주요 지시사항:**
1. 발명의 목적 및 효과 추출
2. 독립항 추출 및 구성별 분리 — (A), (B), (C) 대문자 알파벳으로 표기
3. 세미콜론/줄바꿈/연속 텍스트 등 다양한 형식 처리
4. (A-1), (A-2) 형태로 부모 구성 참조 명시
5. 실질적으로 동일한 청구항 식별 및 표시

**출력 형식:**
```
[발명의 목적 및 효과]
(1~3문장)

[청구항 구조]
청구항 N (독립항)
  (A) ...
  (B) ...
  └─ 청구항 M (종속항, 청구항 N 인용)

[실질적 동일 청구항]
- 청구항 N ≡ 청구항 M: 카테고리(방법 vs 장치)만 상이
```

### 자동 마이그레이션
기존 DB에 v2.0.0이 없으면 앱 시작 시 자동 삽입 (`migrateMissingVersions()`).
`설정 → 청구항` 탭에서 v1.0.0 ↔ v2.0.0 전환 가능.

---

## 8. ClaimEnricher 시스템 프롬프트 외부 관리

**파일:**
- `src/shared/types.ts` — `ENRICH_PROMPT_GET/SET` 채널 추가
- `src/main/ipc/settingsHandlers.ts` — 핸들러 등록
- `src/preload/index.ts` — API 노출

```typescript
// 현재 프롬프트 조회
const prompt = await window.patentAPI.settings.getEnrichPrompt()

// 프롬프트 수정 후 저장
await window.patentAPI.settings.setEnrichPrompt(
  '당신은 특허 분석 전문가입니다. 반드시 JSON 형식으로만 응답하세요.'
)
```

저장 위치: `%APPDATA%\patent-search-settings\patent-search-settings.json`의 `enrichSystemPrompt` 키.

---

## 변경 파일 전체 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/main/search/adapters/BaseAdapter.ts` | API 호출 전 로깅, 에러 시 상태코드·raw body 출력 |
| `src/main/pdf/PatentStructureParser.ts` | 원본 텍스트·섹션·청구항·날짜 추출 전 과정 디버그 로그 |
| `src/main/claim/ClaimEnricher.ts` | LLM 프롬프트·응답 전문 로그 / `제N항` 종속항 정규식 수정 / `searchInstruction` 지원 |
| `src/shared/patentTypes.ts` | `EnrichClaimsParams.searchInstruction` 필드 추가 |
| `src/shared/searchTypes.ts` | `SearchPromptTemplate` 타입 + 5종 기본 템플릿 |
| `src/shared/types.ts` | `SEARCH_TEMPLATES_*`, `ENRICH_PROMPT_*` IPC 채널 추가 |
| `src/main/ipc/settingsHandlers.ts` | 검색 템플릿 CRUD + enrichPrompt 핸들러 |
| `src/main/llm/PromptRegistry.ts` | `claims_analysis` v2.0.0 사용자 원본 프롬프트 추가 / 자동 마이그레이션 |
| `src/preload/index.ts` | `getSearchTemplates`, `saveSearchTemplates`, `getEnrichPrompt`, `setEnrichPrompt` 노출 |
| `src/renderer/store/searchStore.ts` | 템플릿 선택 상태 + 액션 추가 |
| `src/renderer/App.tsx` | 홈 화면 좌우 2분할 / `ClaimStructurePanel` 교체 (우측 전체 높이 패널) |
| `docs/DEBUG_AND_MULTI_PROMPT.md` | 디버깅 가이드 문서 |
| `docs/PATCH_NOTES_2026-05-14.md` | 이 파일 |
