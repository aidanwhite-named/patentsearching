import type { GenerateParams, StrategyType, AnalysisInput } from '../../shared/types'
import type { PromptRegistry } from './PromptRegistry'

/**
 * Builds LLM GenerateParams from a registered strategy template.
 * Switch strategies at runtime by calling build() with a different StrategyType.
 */
export class PromptStrategy {
  private static readonly SYSTEM_PROMPT =
    '당신은 특허 전문 분석가입니다. 정확하고 구체적인 특허 분석을 수행하세요. ' +
    '결과는 반드시 요청된 JSON 형식으로만 반환하고, 추가 설명 텍스트를 포함하지 마세요.'

  constructor(private readonly registry: PromptRegistry) {}

  /**
   * Returns { prompt, systemPrompt } ready to pass to an LLMProvider.
   *
   * @param strategy - Which analysis strategy to use
   * @param input    - Variable values for the template
   * @param provider - Preferred provider name for template selection ('claude' | 'all')
   */
  build(
    strategy: StrategyType,
    input: AnalysisInput,
    provider = 'claude'
  ): Pick<GenerateParams, 'prompt' | 'systemPrompt'> {
    const template = this.registry.getActive(strategy, provider)
    if (!template) {
      throw new Error(
        `전략 '${strategy}'에 대한 활성 프롬프트 템플릿을 찾을 수 없습니다.`
      )
    }

    const variables = this.toVariables(input)
    const prompt = this.registry.render(template, variables)

    return {
      systemPrompt: PromptStrategy.SYSTEM_PROMPT,
      prompt,
    }
  }

  private toVariables(input: AnalysisInput): Record<string, string> {
    return {
      invention_title: input.inventionTitle ?? '',
      invention_description: input.inventionDescription ?? '',
      prior_art_references: input.priorArtReferences ?? '',
      claims: input.claims ?? '',
      claims_text: input.claims ?? '',
      technical_field: input.technicalField ?? '',
    }
  }
}
