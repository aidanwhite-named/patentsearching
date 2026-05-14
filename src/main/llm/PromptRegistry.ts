import type { DatabaseManager } from '../db/DatabaseManager'
import type { PromptTemplate, StrategyType } from '../../shared/types'

// ─── Default Claude-optimised prompt templates (XML structure) ─────────────

const SEED_PROMPTS: Omit<PromptTemplate, 'id' | 'createdAt'>[] = [
  {
    name: 'novelty_analysis',
    version: '1.0.0',
    strategy: 'novelty',
    provider: 'claude',
    isActive: true,
    variables: ['invention_title', 'invention_description', 'prior_art_references'],
    template: `<task>특허 신규성 분석 (Patent Novelty Analysis)</task>

<invention>
  <title>{{invention_title}}</title>
  <description>{{invention_description}}</description>
</invention>

<prior_art>
{{prior_art_references}}
</prior_art>

<instructions>
위 발명의 신규성을 특허법 제29조 제1항 기준으로 분석하세요.

평가 기준:
1. 선행기술과 구성요소별 1:1 대비
2. 차이점 및 동일점 식별
3. 공지·공용·반포된 간행물 해당 여부
4. 신규성 인정/부정 최종 판단

다음 JSON만 반환하세요 (설명 텍스트 없이):
{
  "novelty": "YES|NO|PARTIAL",
  "score": 0-100,
  "differences": ["차이점 리스트"],
  "similar_elements": ["유사 구성요소 리스트"],
  "reasoning": "상세 분석 근거",
  "risk_level": "LOW|MEDIUM|HIGH",
  "recommendations": ["대응 전략"]
}
</instructions>`,
  },
  {
    name: 'inventiveness_analysis',
    version: '1.0.0',
    strategy: 'inventiveness',
    provider: 'claude',
    isActive: true,
    variables: ['invention_title', 'invention_description', 'prior_art_references', 'claims'],
    template: `<task>특허 진보성 분석 (Inventive Step Analysis)</task>

<invention>
  <title>{{invention_title}}</title>
  <description>{{invention_description}}</description>
</invention>

<claims>
{{claims}}
</claims>

<prior_art>
{{prior_art_references}}
</prior_art>

<instructions>
위 발명의 진보성(비자명성)을 특허법 제29조 제2항 기준으로 분석하세요.

평가 기준:
1. 선행기술 조합 가능성 (동기·암시·교시 여부)
2. 기술적 과제와 해결수단의 관련성
3. 예측하지 못한 현저한 효과 존재 여부
4. 당업자 자명성 종합 판단

다음 JSON만 반환하세요:
{
  "inventiveness": "YES|NO|PARTIAL",
  "score": 0-100,
  "technical_advantages": ["기술적 장점"],
  "combination_analysis": "선행기술 조합 가능성 분석",
  "unexpected_effects": ["예상치 못한 효과"],
  "reasoning": "상세 분석 근거",
  "risk_level": "LOW|MEDIUM|HIGH",
  "claim_amendments": ["청구항 보정 권고"]
}
</instructions>`,
  },
  {
    name: 'prior_art_search',
    version: '1.0.0',
    strategy: 'prior_art',
    provider: 'claude',
    isActive: true,
    variables: ['invention_description', 'technical_field'],
    template: `<task>선행기술 검색 전략 수립 (Prior Art Search Strategy)</task>

<invention>
  <description>{{invention_description}}</description>
  <technical_field>{{technical_field}}</technical_field>
</invention>

<instructions>
위 발명에 대한 최적의 선행기술 검색 전략을 수립하세요.

검색 대상 DB: KIPRIS, Espacenet, Google Patents, USPTO

다음 JSON만 반환하세요:
{
  "ipc_codes": ["IPC 분류코드 (예: H04L 9/00)"],
  "cpc_codes": ["CPC 분류코드"],
  "keywords": {
    "ko": ["핵심 한국어 키워드"],
    "en": ["핵심 영어 키워드"],
    "ja": ["핵심 일본어 키워드"]
  },
  "boolean_queries": {
    "kipris": "KIPRIS Boolean 검색식",
    "espacenet": "Espacenet CQL 검색식",
    "google_patents": "Google Patents 검색식"
  },
  "search_strategy": "검색 전략 설명",
  "estimated_results": "예상 검색결과 규모"
}
</instructions>`,
  },
  {
    name: 'claims_analysis',
    version: '1.0.0',
    strategy: 'claims_analysis',
    provider: 'claude',
    isActive: false,
    variables: ['claims_text', 'prior_art_references'],
    template: `<task>청구항 분석 (Patent Claims Analysis)</task>

<claims>
{{claims_text}}
</claims>

<prior_art>
{{prior_art_references}}
</prior_art>

<instructions>
청구항을 분석하고 각 독립항의 구성요소별 선행기술 대비를 수행하세요.

다음 JSON만 반환하세요:
{
  "independent_claims": [
    {
      "claim_number": 1,
      "elements": ["구성요소 분해"],
      "novel_elements": ["신규 구성요소"],
      "known_elements": ["공지 구성요소"],
      "strength": "STRONG|MEDIUM|WEAK",
      "vulnerability": "취약점 설명"
    }
  ],
  "dependent_claims_summary": "종속항 요약",
  "overall_scope": "권리범위 평가",
  "overall_assessment": "종합 평가",
  "recommendations": ["청구항 보정/보완 권고사항"]
}
</instructions>`,
  },
  // ─── v2.0.0: 사용자 요청 원본 프롬프트 (독립항 추출 + 구성요소 분리) ──────────
  {
    name: 'claims_analysis',
    version: '2.0.0',
    strategy: 'claims_analysis',
    provider: 'claude',
    isActive: true,
    variables: ['claims_text'],
    template: `[독립항 추출]
당신은 특허 명세서의 청구항을 분석하고 구성 요소를 정확히 판단하는 전문가이다.

[분석 대상 청구항]
{{claims_text}}

---

1. 이 발명의 목적 및 효과를 먼저 기재하라.

2. 독립항을 추출하라.
독립항은 다른 청구항을 인용하지 않는 청구항을 의미한다.
예: 청구항 1은 어느 청구항도 인용하지 않으므로 독립항이고,
'제1항에 있어서' 혹은 '제n항에 있어서'라고 타항을 인용하면 독립항이 아니다.

3. 추출된 독립항을 출력 시, 구성별로 분리하여 재작성하라.
- 각 구성은 알파벳 (A), (B), (C)... 대문자 순서로 표기한다.
- 구성 단위는 주로 ';'(세미콜론)으로 구분되어 있을 수 있다.
- 세미콜론이 없고 줄바꿈으로 이루어진 청구항도 있을 수 있다.
- 세미콜론도 줄바꿈도 없이 하나로 연결된 경우 읽어보고 판단하여 구성 단위로 출력한다.
- 예외: '프로세서', '메모리' 등 단어 하나로만 이루어진 구성에는 알파벳을 붙이지 않아도 된다.
- 청구항의 어두(~~에 있어서)는 그대로 유지하고,
  어미(~~를 특징으로 하는 장치/방법/시스템 등)도 알파벳을 붙이지 않아도 된다.
- 구성을 한정하거나 부가하는 구성은 (A-1), (A-2) 또는 (C)처럼 부모 구성 참조를 명시한다.

4. 실질적으로 동일한 청구항 식별:
- 장치/방법/시스템/프로그램 등 카테고리만 다르고 기술 내용이 동일하다면
  "카테고리(방법 vs 장치)만 상이할 뿐 실질적으로 동일하다"고 명시하라.
- 유사하지만 동일하지 않다면 유사한 구성과 다른 구성을 모두 표기하고,
  특히 다른 부분이 목적·효과와 얼마나 차이가 있는지 강조하라.
- 종속항 중에서도 실질적으로 동일한 것이 있다면 동일하다고 표시하라.

5. 출력 형식:
[발명의 목적 및 효과]
(1~3문장으로 요약)

[청구항 구조]
청구항 N (독립항)
  (A) ...
  (B) ...
  (C) ...
  └─ 청구항 M (종속항, 청구항 N 인용)
      추가 구성: ...
  └─ 청구항 K (종속항, 청구항 N 인용)
      추가 구성: ...

[실질적 동일 청구항]
- 청구항 N ≡ 청구항 M: 카테고리(방법 vs 장치)만 상이, 기술 내용 동일
- 청구항 P ≈ 청구항 Q: A, B 구성은 유사하나 C 구성에서 차이 (효과 측면 ★중요)`,
  },
]

// ─── DB row shape ──────────────────────────────────────────────────────────

interface PromptRow {
  id: number
  name: string
  version: string
  strategy: string
  provider: string
  template: string
  variables: string   // JSON array
  is_active: number
  created_at: string
}

// ─── PromptRegistry ────────────────────────────────────────────────────────

export class PromptRegistry {
  constructor(private readonly db: DatabaseManager) {
    this.seed()
  }

  // ─── Public API ───────────────────────────────────────────────────────

  /** Get the currently active template for a strategy+provider combination. */
  getActive(strategy: StrategyType, provider = 'claude'): PromptTemplate | null {
    const row = this.db.get<PromptRow>(
      `SELECT * FROM prompts
       WHERE strategy = ? AND (provider = ? OR provider = 'all') AND is_active = 1
       ORDER BY version DESC LIMIT 1`,
      [strategy, provider]
    )
    return row ? this.toTemplate(row) : null
  }

  /** List all templates, optionally filtered by strategy, newest version first. */
  list(strategy?: StrategyType): PromptTemplate[] {
    const rows = strategy
      ? this.db.all<PromptRow>(
          'SELECT * FROM prompts WHERE strategy = ? ORDER BY strategy, version DESC',
          [strategy]
        )
      : this.db.all<PromptRow>(
          'SELECT * FROM prompts ORDER BY strategy, version DESC'
        )
    return rows.map((r) => this.toTemplate(r))
  }

  /**
   * Insert or update a template.
   * If (name, version) already exists: updates template text, variables, provider.
   * Otherwise: inserts as a new version.
   */
  save(template: Omit<PromptTemplate, 'id' | 'createdAt'>): PromptTemplate {
    const existing = this.db.get<PromptRow>(
      'SELECT * FROM prompts WHERE name = ? AND version = ?',
      [template.name, template.version]
    )

    if (existing) {
      this.db.run(
        `UPDATE prompts
         SET template = ?, variables = ?, provider = ?, is_active = ?
         WHERE id = ?`,
        [
          template.template,
          JSON.stringify(template.variables),
          template.provider,
          template.isActive ? 1 : 0,
          existing.id,
        ]
      )
      const updated = this.db.get<PromptRow>('SELECT * FROM prompts WHERE id = ?', [existing.id])!
      return this.toTemplate(updated)
    }

    // New version
    this.db.run(
      `INSERT INTO prompts (name, version, strategy, provider, template, variables, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        template.name,
        template.version,
        template.strategy,
        template.provider,
        template.template,
        JSON.stringify(template.variables),
        template.isActive ? 1 : 0,
      ]
    )
    const newId = this.db.lastInsertRowId()
    const row = this.db.get<PromptRow>('SELECT * FROM prompts WHERE id = ?', [newId])!
    return this.toTemplate(row)
  }

  /**
   * Deactivate all templates in the same strategy group,
   * then activate the requested one — transactional.
   */
  activate(id: number): void {
    const target = this.db.get<PromptRow>(
      'SELECT strategy FROM prompts WHERE id = ?',
      [id]
    )
    if (!target) throw new Error(`Prompt id=${id} not found`)

    this.db.transaction(() => {
      this.db.run(
        'UPDATE prompts SET is_active = 0 WHERE strategy = ?',
        [target.strategy]
      )
      this.db.run(
        'UPDATE prompts SET is_active = 1 WHERE id = ?',
        [id]
      )
    })
  }

  /** Replace {{variable}} placeholders with provided values. */
  render(template: PromptTemplate, variables: Record<string, string>): string {
    return Object.entries(variables).reduce(
      (tpl, [k, v]) => tpl.replaceAll(`{{${k}}}`, v),
      template.template
    )
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private seed(): void {
    const { n } = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM prompts') ?? { n: 0 }
    if (n === 0) {
      // 최초 실행: 전체 시드
      this.db.transaction(() => {
        for (const p of SEED_PROMPTS) {
          this.db.run(
            `INSERT OR IGNORE INTO prompts
               (name, version, strategy, provider, template, variables, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [p.name, p.version, p.strategy, p.provider,
             p.template, JSON.stringify(p.variables), p.isActive ? 1 : 0]
          )
        }
      })
      console.log('[PromptRegistry] Seeded', SEED_PROMPTS.length, 'default templates')
    } else {
      // 이미 DB가 존재하는 경우: 누락된 버전만 보충 (idempotent migration)
      this.migrateMissingVersions()
    }
  }

  /**
   * SEED_PROMPTS 중 DB에 없는 (name, version) 조합만 INSERT.
   * 기존 레코드는 건드리지 않으므로 반복 호출에 안전하다.
   */
  private migrateMissingVersions(): void {
    let added = 0
    this.db.transaction(() => {
      for (const p of SEED_PROMPTS) {
        const exists = this.db.get<{ id: number }>(
          'SELECT id FROM prompts WHERE name = ? AND version = ?',
          [p.name, p.version]
        )
        if (!exists) {
          // 동일 strategy의 기존 활성 항목이 있으면 이 신규 항목은 비활성으로 삽입
          // (단, is_active=true인 시드는 기존 항목을 비활성화하고 이것을 활성화)
          if (p.isActive) {
            this.db.run(
              'UPDATE prompts SET is_active = 0 WHERE strategy = ?',
              [p.strategy]
            )
          }
          this.db.run(
            `INSERT INTO prompts
               (name, version, strategy, provider, template, variables, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [p.name, p.version, p.strategy, p.provider,
             p.template, JSON.stringify(p.variables), p.isActive ? 1 : 0]
          )
          added++
          console.log(`[PromptRegistry] Migration: inserted ${p.name} v${p.version}`)
        }
      }
    })
    if (added > 0) {
      console.log(`[PromptRegistry] Migration complete: ${added} new template(s) added`)
    }
  }

  private toTemplate(row: PromptRow): PromptTemplate {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      strategy: row.strategy as StrategyType,
      provider: row.provider,
      template: row.template,
      variables: JSON.parse(row.variables) as string[],
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    }
  }
}
