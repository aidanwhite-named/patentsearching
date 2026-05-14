import type { ProviderSettings } from '../../../shared/types'
import type { LLMProvider, RetryConfig } from '../types'
import { LLMError } from '../types'
import { ClaudeAPIProvider } from './ClaudeAPIProvider'
import { ClaudeCLIProvider } from './ClaudeCLIProvider'

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
}

/**
 * Singleton factory that creates and caches LLM providers.
 *
 * Resolution order for 'auto' mode:
 *   1. Claude API  (if apiKey is set and endpoint responds)
 *   2. Claude CLI  (if `claude` binary is available)
 *   3. Throws — user must configure at least one option
 */
export class ProviderFactory {
  private static _instance: ProviderFactory | null = null
  private readonly cache = new Map<string, LLMProvider>()

  static getInstance(): ProviderFactory {
    if (!ProviderFactory._instance) {
      ProviderFactory._instance = new ProviderFactory()
    }
    return ProviderFactory._instance
  }

  /** Returns a cached or newly resolved provider for the given settings. */
  async create(settings: ProviderSettings): Promise<LLMProvider> {
    const key = this.cacheKey(settings)
    const cached = this.cache.get(key)
    if (cached) return cached

    const provider = await this.resolve(settings)
    this.cache.set(key, provider)
    return provider
  }

  /** Force re-resolve on next call (e.g. after settings change). */
  invalidateCache(): void {
    this.cache.clear()
    console.log('[ProviderFactory] Cache invalidated')
  }

  // ─── Public resolve (used by provider check IPC handler) ─────────────

  /** Resolve without caching — useful for one-shot availability checks. */
  async resolve(settings: ProviderSettings): Promise<LLMProvider> {
    switch (settings.mode) {
      case 'api':
        return this.createAPI(settings)

      case 'cli':
        return this.createCLI(settings)

      case 'auto':
        return this.autoFallback(settings)
    }
  }

  private createAPI(settings: ProviderSettings): ClaudeAPIProvider {
    if (!settings.apiKey?.trim()) {
      throw new LLMError('API 모드에서는 API 키가 필요합니다.', 'NO_API_KEY', false)
    }
    return new ClaudeAPIProvider(settings.apiKey, settings.model, DEFAULT_RETRY)
  }

  private createCLI(settings: ProviderSettings): ClaudeCLIProvider {
    return new ClaudeCLIProvider(settings.cliPath ?? 'claude', DEFAULT_RETRY)
  }

  private async autoFallback(settings: ProviderSettings): Promise<LLMProvider> {
    // 1. Try API first
    if (settings.apiKey?.trim()) {
      const api = new ClaudeAPIProvider(settings.apiKey, settings.model, DEFAULT_RETRY)
      const ok = await api.isAvailable()
      if (ok) {
        console.log('[ProviderFactory] Auto: using Claude API')
        return api
      }
      console.warn('[ProviderFactory] Auto: API unavailable, falling back to CLI')
    }

    // 2. Try CLI
    const cli = new ClaudeCLIProvider(settings.cliPath ?? 'claude', DEFAULT_RETRY)
    const ok = await cli.isAvailable()
    if (ok) {
      console.log('[ProviderFactory] Auto: using Claude CLI')
      return cli
    }

    throw new LLMError(
      'Claude API와 CLI 모두 사용할 수 없습니다. API 키를 입력하거나 Claude CLI를 설치하세요.',
      'NO_PROVIDER',
      false
    )
  }

  private cacheKey(s: ProviderSettings): string {
    return `${s.mode}:${s.apiKey ?? ''}:${s.model}:${s.cliPath ?? ''}`
  }
}
