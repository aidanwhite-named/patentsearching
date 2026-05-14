import type { GenerateParams, LLMResult, StreamChunk } from '../../shared/types'

export interface LLMProvider {
  readonly id: string
  readonly name: string
  generate(params: GenerateParams): Promise<LLMResult>
  /**
   * Returns an AsyncGenerator that yields text deltas.
   * Pass an AbortSignal to cancel mid-stream (generator will return early).
   */
  stream(params: GenerateParams, signal?: AbortSignal): AsyncGenerator<StreamChunk>
  /**
   * Lightweight availability probe.
   * Should be fast and not consume significant tokens/resources.
   */
  isAvailable(): Promise<boolean>
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly provider?: string
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export interface RetryConfig {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}
