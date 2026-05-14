# 디버깅 시스템 & 다중 프롬프트 선택 기능 가이드

> 적용 날짜: 2026-05-14  
> 해당 브랜치: Part 6 리팩터 이후 추가 패치

---

## 1. 개요

이번 패치에서 추가된 기능은 크게 두 가지입니다.

| 범주 | 내용 |
|------|------|
| **디버깅 강화** | PDF 파싱, 날짜/청구항 추출, LLM 호출, API 요청/응답 전 과정의 터미널 로그 |
| **다중 프롬프트 선택** | 5가지 검색 전략 템플릿을 드롭다운으로 선택하여 검색 방향을 제어 |

---

## 2. 디버깅 로그 설명

앱 실행 중 **Electron 메인 프로세스 터미널(콘솔)**에 아래 로그들이 출력됩니다.  
개발 모드(`npm run dev`)에서 바로 확인 가능합니다.

### 2-1. PDF 파싱 / 날짜 / 청구항 추출 로그

**파일**: `src/main/pdf/PatentStructureParser.ts`

```
======================================================================
[PatentParser] PDF 파싱 시작
  파일: C:\Users\...\patent.pdf
  페이지: 12
  전체 텍스트 길이: 34521자
  줄 수: 892줄

  [원본 텍스트 — 처음 1500자]
  ...실제 PDF 추출 텍스트...
======================================================================

[PatentParser] 청구항 분리 시작 — 원본 청구항 텍스트 길이: 3241자
  청구항 텍스트 첫 300자: 청구항 1. 방법에 있어서, ...
  "청구항 N" 패턴으로 10개 청구항 추출
  [청구항 1] 첫 80자: 방법에 있어서, (A) 입력 신호를 수신하는 단계; ...

[PatentParser] 날짜 추출 성공 [2순위 출원일]: 2023-05-17

----------------------------------------------------------------------
[PatentParser] 파싱 결과 요약
  발명 제목: 무선 통신 방법 및 장치
  섹션 수  : 8개
    - [technical_field       ] 기술분야 (241자)
    - [background            ] 배경기술 (1832자)
    ...
  청구항 수: 10개
  날짜     : 2023-05-17
----------------------------------------------------------------------
```

**날짜가 추출되지 않는 경우** 아래와 같이 표시됩니다:
```
[PatentParser] 날짜 추출 실패 — 서지사항에서 날짜를 찾을 수 없음
  헤더 샘플 (처음 500자): ...
```
→ 샘플 텍스트를 보고 키워드(출원일자, Filing Date 등)가 있는지 확인하세요.

**청구항이 추출되지 않는 경우** 아래 로그를 확인하세요:
```
[PatentParser] 청구항 분리 시작 — 원본 청구항 텍스트 길이: 0자
```
→ 청구항 텍스트 길이가 0이면 PDF의 섹션 감지 실패. "청구범위" / "청구항" / "claims" 등의 섹션 헤더가 PDF에 포함되어 있는지 확인하세요.

---

### 2-2. ClaimEnricher LLM 프롬프트 & 응답 로그

**파일**: `src/main/claim/ClaimEnricher.ts`

```
======================================================================
[ClaimEnricher] 청구항 강화 시작
  발명 제목    : 무선 통신 방법 및 장치
  전체 청구항  : 10개
  처리 대상    : 전체
  청크 수      : 47개
  검색 전략    : "기본 (없음)"
======================================================================

----------------------------------------------------------------------
[ClaimEnricher] 청구항 1 — LLM 호출

  [시스템 프롬프트]
  당신은 특허 명세서 분석 전문가입니다. 지시한 JSON 형식으로만 응답하십시오.

  [유저 프롬프트 전체]
  당신은 특허 명세서 분석 전문가입니다. 청구항의 기술적 의미를 구조화하십시오.
  ...전체 프롬프트...
----------------------------------------------------------------------

----------------------------------------------------------------------
[ClaimEnricher] 청구항 1 — LLM 응답 (Raw)
  {"components": [...], "overallPurpose": "...", ...}
----------------------------------------------------------------------
```

**JSON 파싱 실패 시** 경고 로그와 함께 최소 강화 결과로 대체됩니다:
```
[ClaimEnricher] JSON parse failed, returning minimal enrichment: ...
```
→ 이 경우 LLM 응답(Raw) 로그를 확인하여 형식 오류 원인을 파악하세요.

---

### 2-3. 검색 API 요청/응답 로그

**파일**: `src/main/search/adapters/BaseAdapter.ts`

모든 외부 API 호출(`PatentsView`, `OpenAlex`, `KIPRIS`) 전에 아래가 출력됩니다:

```
────────────────────────────────────────────────────────────
[patentsview] ▶ API 요청
  Method  : POST
  URL     : https://search.patentsview.org/api/v1/patent/
  Headers : {"Content-Type":"application/json","Accept":"application/json"}
  Body    : {"q":{"_or":[{"_text_any":{"patent_title":"..."}},...]},"f":[...],"o":{"per_page":25}...
────────────────────────────────────────────────────────────
```

**HTTP 에러 발생 시** 상태코드와 원본 응답 전문이 출력됩니다:

```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
[patentsview] ✖ HTTP 422 오류
  URL     : https://search.patentsview.org/api/v1/patent/
  Status  : 422 Unprocessable Entity
  Content-Type: text/html; charset=utf-8
  Raw Response (처음 3000자):
  <!DOCTYPE html><html>...에러 페이지 내용...
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```

이 로그를 통해 다음을 확인할 수 있습니다:
- `Status 404` → 엔드포인트 URL이 틀림
- `Status 422` → 쿼리 JSON 구조가 API 스펙과 맞지 않음
- `Status 429` → 요청 횟수 초과 (자동 재시도 3회)
- `Status 500` → 서버 측 오류 (API 서비스 일시 장애)
- Content-Type이 `text/html` → JSON이 아닌 에러 페이지가 반환된 것 (HTML 파싱 오류의 원인)

**JSON이 아닌 응답(HTML 등)이 왔을 때**도 별도 에러가 출력됩니다:
```
[patentsview] ✖ JSON이 아닌 응답 수신
  Content-Type: text/html; charset=utf-8
  Raw Response (처음 1000자): <!DOCTYPE html>...
```

---

## 3. 다중 프롬프트 선택 기능

### 3-1. UI 위치

홈 화면 입력 카드 하단 바에 **검색 전략 드롭다운**이 추가되었습니다.

```
[ 소스: USPTO OpenAlex ] [ 검색 전략 드롭다운 ▾ ] [ 날짜 입력 ] [ 검색 버튼 ]
```

### 3-2. 기본 제공 템플릿 5종

| ID | 이름 | 설명 | 효과 |
|----|------|------|------|
| `auto` | 자동 (기본) | 균형 잡힌 종합 분석 | 추가 지시 없음 |
| `structural` | 구성요소 중심 | 부품·장치·수단의 연결 관계 집중 | 구조적 선행기술 탐색 강화 |
| `functional` | 기능/효과 중심 | 기술적 효과와 목적 집중 | 기능 동등 선행기술까지 탐색 |
| `application` | 응용분야 중심 | 산업 분야·사용 환경 집중 | 응용 분야 선행기술 강화 |
| `broad` | 광범위 검색 | 동의어·상위개념까지 포함 | 넓은 범위 탐색 |

### 3-3. 동작 방식

1. 사용자가 드롭다운에서 전략을 선택
2. PDF를 업로드하면 선택된 전략의 **instruction**이 `ClaimEnricher` LLM 프롬프트에 삽입됨
3. LLM이 해당 관점에서 `searchQueries`를 생성하여 선행기술 검색에 활용
4. `auto` 선택 시 기존 동작과 동일 (instruction 없음)

### 3-4. 커스텀 템플릿 추가 (개발자)

현재 UI에서 커스텀 템플릿을 추가하려면:

```typescript
// renderer에서
await window.patentAPI.settings.saveSearchTemplates([
  ...currentTemplates,
  {
    id: 'my-custom',
    name: '내 커스텀 전략',
    description: '특정 목적에 맞춘 검색',
    instruction: '검색 시 XYZ 측면을 특히 강조하여...',
  },
])
```

저장된 커스텀 템플릿은 앱 재시작 후에도 유지됩니다 (`electron-store`에 보관).

---

## 4. ClaimEnricher 시스템 프롬프트 외부 편집

`ClaimEnricher`의 시스템 프롬프트(LLM 역할 지시)는 앱 데이터 디렉토리의  
`patent-search-settings.json`에 `enrichSystemPrompt` 키로 저장됩니다.

```typescript
// 현재 프롬프트 조회
const prompt = await window.patentAPI.settings.getEnrichPrompt()

// 프롬프트 수정
await window.patentAPI.settings.setEnrichPrompt(
  '당신은 특허 분석 전문가입니다. 반드시 JSON만 출력하세요.'
)
```

---

## 5. 변경된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/main/search/adapters/BaseAdapter.ts` | API 호출 전 URL/헤더/바디 로깅, 에러 시 raw body 출력 |
| `src/main/pdf/PatentStructureParser.ts` | 원본 텍스트·섹션·청구항·날짜 추출 전 과정 디버그 로그 |
| `src/main/claim/ClaimEnricher.ts` | LLM 프롬프트·응답 전문 로그, `searchInstruction` 반영 |
| `src/shared/patentTypes.ts` | `EnrichClaimsParams.searchInstruction` 필드 추가 |
| `src/shared/searchTypes.ts` | `SearchPromptTemplate` 타입 + 5개 기본 템플릿 정의 |
| `src/shared/types.ts` | `SEARCH_TEMPLATES_GET/SAVE`, `ENRICH_PROMPT_GET/SET` IPC 채널 추가 |
| `src/main/ipc/settingsHandlers.ts` | 템플릿 CRUD 핸들러, enrichPrompt 핸들러 등록 |
| `src/preload/index.ts` | `settings.getSearchTemplates`, `saveSearchTemplates`, `getEnrichPrompt`, `setEnrichPrompt` 노출 |
| `src/renderer/store/searchStore.ts` | 템플릿 목록·선택 ID 상태 및 액션 추가 |
| `src/renderer/App.tsx` | 홈 화면 드롭다운 UI, PDF 분석 시 `searchInstruction` 전달 |

---

## 6. 자주 묻는 문제

### Q: PDF 업로드 후 청구항이 0개로 나온다

터미널에서 아래를 확인하세요:

1. `[PatentParser] 청구항 분리 시작 — 원본 청구항 텍스트 길이: 0자` → 섹션 감지 실패  
   → PDF의 실제 헤더 텍스트가 "청구범위", "청구항", "claims" 중 하나인지 확인  
   → 원본 텍스트 첫 1500자 출력에서 실제 섹션 구조 확인

2. `"청구항 N" 패턴 없음 — 번호 패턴("1. ") 폴백 시도` → 청구항 번호 형식 다름  
   → PDF가 "1. 방법에 있어서..." 형태면 정상적으로 폴백 처리됨

### Q: PatentsView에서 HTML 에러가 온다

터미널의 `Raw Response` 내용을 확인하세요:
- API 스펙 변경: [https://search.patentsview.org/swagger](https://search.patentsview.org/swagger) 확인
- 쿼리가 너무 길면 422 오류 발생 — `PatentsViewAdapter.ts`의 `queryText.slice(0, 150)` 값 조정

### Q: 날짜가 자동으로 설정되지 않는다

`[PatentParser] 날짜 추출 실패` 로그 뒤의 헤더 샘플을 확인하세요.  
PDF 서지사항에 날짜 관련 키워드가 없거나 다른 형식(예: YYYYMMDD)인 경우  
`PatentStructureParser.ts`의 `extractPatentDate()` 함수에 해당 패턴을 추가하세요.
