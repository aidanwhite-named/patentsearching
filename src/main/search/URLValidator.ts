/**
 * URLValidator — hallucination prevention layer.
 *
 * Makes lightweight HEAD requests (or GET with early abort) to verify that
 * URLs returned by adapters actually resolve.  Invalid / unreachable URLs
 * are flagged so the report layer can omit or warn about them.
 */

import https from 'https'
import http from 'http'
import { URL } from 'url'

export interface ValidationResult {
  url: string
  valid: boolean
  statusCode?: number
  error?: string
}

const REQUEST_TIMEOUT_MS = 5_000
const MAX_CONCURRENT     = 8

export class URLValidator {
  private readonly enabled: boolean

  constructor(enabled = true) {
    this.enabled = enabled
  }

  // ─── Single URL check ──────────────────────────────────────────────────

  async validate(url: string): Promise<ValidationResult> {
    if (!this.enabled) return { url, valid: true }

    try {
      new URL(url)  // throws on malformed URL
    } catch {
      return { url, valid: false, error: 'malformed URL' }
    }

    return new Promise((resolve) => {
      const parsedUrl = new URL(url)
      const mod = parsedUrl.protocol === 'https:' ? https : http

      const req = mod.request(
        {
          method: 'HEAD',
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            'User-Agent': 'PatentSearchBot/1.0',
          },
        },
        (res) => {
          req.destroy()
          const code = res.statusCode ?? 0
          // 200-399 = valid, 405 = method not allowed but resource exists
          const valid = code < 400 || code === 405
          resolve({ url, valid, statusCode: code })
        },
      )

      req.on('error', (err) => {
        resolve({ url, valid: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ url, valid: false, error: 'timeout' })
      })

      req.end()
    })
  }

  // ─── Batch validation with concurrency cap ────────────────────────────

  async validateBatch(urls: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>()
    const unique = Array.from(new Set(urls))

    for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
      const batch = unique.slice(i, i + MAX_CONCURRENT)
      const results = await Promise.all(batch.map((u) => this.validate(u)))
      for (const r of results) {
        result.set(r.url, r.valid)
      }
    }

    return result
  }
}
