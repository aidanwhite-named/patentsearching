import Anthropic from '@anthropic-ai/sdk'
import type { GenerateParams, LLMResult, StreamChunk } from '../../../shared/types'
import type { LLMProvider, RetryConfig } from '../types'
import { LLMError } from '../types'
import { RetryManager } from '../RetryManager'

export class ClaudeAPIProvider implements LLMProvider {
  readonly id = 'claude-api'
  readonly name = 'Claude API'

  private readonly client: Anthropic
  private readonly retry: RetryManager
  private readonly defaultModel: string

  constructor(apiKey: string, model = 'claude-sonnet-4-6', retryConfig?: Partial<RetryConfig>) {
    this.client = new Anthropic({ apiKey })
    this.defaultModel = model
    this.retry = new RetryManager(retryConfig)
  }

  // ─── generate (non-streaming, retried) ─────────────────────────────────

  async generate(params: GenerateParams): Promise<LLMResult> {
    const startTime = Date.now()

    return this.retry.execute(async () => {
      try {
        const response = await this.client.messages.create({
          model: params.model ?? this.defaultModel,
          max_tokens: params.maxTokens ?? 4096,
          temperature: params.temperature ?? 0.3,
          ...(params.systemPrompt && { system: params.systemPrompt }),
          messages: [{ role: 'user', content: params.prompt }],
        })

        const content = response.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as Anthropic.TextBlock).text)
          .join('')

        return {
          content,
          model: response.model,
          provider: this.id,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          },
          latencyMs: Date.now() - startTime,
        }
      } catch (error) {
        throw this.mapError(error)
      }
    }, 'ClaudeAPIProvider.generate')
  }

  // ─── stream (SSE, with AbortSignal support) ─────────────────────────────

  async *stream(params: GenerateParams, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    if (signal?.aborted) return

    try {
      const runner = this.client.messages.stream({
        model: params.model ?? this.defaultModel,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 0.3,
        ...(params.systemPrompt && { system: params.systemPrompt }),
        messages: [{ role: 'user', content: params.prompt }],
      })

      // Wire abort signal → abort the HTTP stream
      signal?.addEventListener('abort', () => runner.abort(), { once: true })

      for await (const event of runner) {
        if (signal?.aborted) break

        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { delta: event.delta.text, done: false }
        }
      }

      if (!signal?.aborted) {
        const final = await runner.finalMessage()
        yield {
          delta: '',
          done: true,
          usage: {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            totalTokens: final.usage.input_tokens + final.usage.output_tokens,
          },
        }
      }
    } catch (error) {
      // Don't throw on intentional abort
      if (signal?.aborted) return
      throw this.mapError(error)
    }
  }

  // ─── isAvailable (low-cost probe) ───────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    try {
      // min-cost probe: max_tokens=1 → ~$0.000003 per check
      await this.client.messages.create({
        model: this.defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      })
      return true
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        const s: number = error.status ?? 500
        // 4xx auth errors → key is wrong but API is reachable (not a network issue)
        if (s === 401 || s === 403) return false
        // Other 4xx (bad request etc) → still reachable
        if (s < 500) return true
      }
      return false
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private mapError(error: unknown): LLMError {
    if (error instanceof Anthropic.APIError) {
      const status: number = error.status ?? 500
      const retryable = status === 429 || status === 529 || status >= 500
      return new LLMError(error.message, `HTTP_${status}`, retryable, this.id)
    }
    if (error instanceof LLMError) return error
    return new LLMError(String(error), 'UNKNOWN', false, this.id)
  }
}
