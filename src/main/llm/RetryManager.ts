import { LLMError, RetryConfig } from './types'

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
}

export class RetryManager {
  private readonly config: RetryConfig

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async execute<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error

        const retryable =
          error instanceof LLMError ? error.retryable : this.isRetryable(error)

        if (!retryable || attempt === this.config.maxAttempts) {
          throw error
        }

        const delay = Math.min(
          this.config.baseDelayMs * Math.pow(2, attempt - 1),
          this.config.maxDelayMs
        )
        console.warn(
          `[Retry] ${context} attempt ${attempt}/${this.config.maxAttempts} failed — retrying in ${delay}ms:`,
          (error as Error).message
        )
        await this.sleep(delay)
      }
    }

    throw lastError
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const msg = error.message.toLowerCase()
    return (
      msg.includes('rate limit') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('503') ||
      msg.includes('529') ||
      msg.includes('overloaded')
    )
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
