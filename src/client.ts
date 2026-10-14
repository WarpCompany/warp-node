import { HttpClient, type FetchLike } from './http'
import { Attestations } from './resources/attestations'
import { Checkout } from './resources/checkout'
import { Zk } from './resources/zk'
import { webhooks, type Webhooks } from './webhooks'

export const DEFAULT_BASE_URL = 'https://api.usewarp.net'
export const DEFAULT_TIMEOUT = 30_000
export const DEFAULT_MAX_RETRIES = 2

export interface WarpOptions {
  /** API origin. Defaults to `https://api.usewarp.net`. */
  baseUrl?: string
  /** Per-attempt timeout in milliseconds. Defaults to 30000. */
  timeout?: number
  /** Retries for GET requests on network errors, 429 and 5xx. Defaults to 2. POST requests are never retried. */
  maxRetries?: number
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike
  /** Allow construction in a browser. Your secret key would be exposed to anyone using the page. */
  dangerouslyAllowBrowser?: boolean
}

export type WarpMode = 'test' | 'live'

/** Client for the Warp API. Use it on your server only, with a secret key. */
export class Warp {
  /** `test` for `sk_test_` keys (testnet), `live` for `sk_live_` keys (mainnet). */
  readonly mode: WarpMode
  readonly checkout: Checkout
  readonly zk: Zk
  readonly attestations: Attestations
  /** Webhook signature helpers. They do not use the API key. */
  readonly webhooks: Webhooks = webhooks

  constructor(apiKey: string, options: WarpOptions = {}) {
    if (typeof (globalThis as { window?: unknown }).window !== 'undefined' && !options.dangerouslyAllowBrowser) {
      throw new Error(
        '@usewarp/node is a server SDK and must not run in a browser: it would expose your secret key. ' +
          'Create checkout sessions on your server and use @usewarp/js in the browser. ' +
          'Pass { dangerouslyAllowBrowser: true } only if you understand the risk.',
      )
    }

    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('Missing API key. Pass your secret key: new Warp(process.env.WARP_SECRET_KEY)')
    }
    const match = /^sk_(test|live)_/.exec(apiKey)
    if (!match) {
      const hint = apiKey.startsWith('pk_') ? ' Publishable keys cannot be used with @usewarp/node.' : ''
      throw new Error(`Invalid API key: secret keys start with "sk_test_" or "sk_live_".${hint}`)
    }
    this.mode = match[1] as WarpMode

    const timeout = options.timeout ?? DEFAULT_TIMEOUT
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('timeout must be a positive number')
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new RangeError('maxRetries must be a non-negative integer')

    const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
    if (!fetchImpl) throw new Error('No fetch implementation found. Use Node.js 18+ or pass options.fetch.')

    const http = new HttpClient({
      apiKey,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeout,
      maxRetries,
      fetch: fetchImpl,
    })

    this.checkout = new Checkout(http)
    this.zk = new Zk(http)
    this.attestations = new Attestations(http)
  }
}
