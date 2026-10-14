import { WarpConnectionError, WarpError, errorFromResponse } from './errors'
import { VERSION } from './version'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface HttpClientOptions {
  apiKey: string
  baseUrl: string
  timeout: number
  maxRetries: number
  fetch: FetchLike
}

export interface RequestSpec {
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** Send the secret key. False for public endpoints. */
  auth?: boolean
}

const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000
/** A longer Retry-After is not waited out: the error is thrown instead. */
const MAX_RETRY_AFTER_MS = 10_000

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async request<T>(spec: RequestSpec): Promise<T> {
    const url = this.buildUrl(spec.path, spec.query)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `@warpfi/node/${VERSION}`,
    }
    if (spec.auth !== false) headers.Authorization = `Bearer ${this.options.apiKey}`
    let body: string | undefined
    if (spec.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(spec.body)
    }

    // The API has no idempotency keys, so only reads are retried.
    const maxRetries = spec.method === 'GET' ? this.options.maxRetries : 0

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt<T>(url, { method: spec.method, headers, body })
      } catch (error) {
        if (attempt >= maxRetries || !isRetryable(error)) throw error
        await sleep(retryDelay(attempt, error))
      }
    }
  }

  private buildUrl(path: string, query: RequestSpec['query']): string {
    const url = new URL(this.options.baseUrl + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async attempt<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeout)
    try {
      let response: Response
      try {
        response = await this.options.fetch(url, { ...init, signal: controller.signal })
      } catch (error) {
        throw connectionError(error, controller.signal.aborted, this.options.timeout)
      }

      const requestId = response.headers.get('x-request-id') ?? undefined
      let text: string
      try {
        text = await response.text()
      } catch (error) {
        throw connectionError(error, controller.signal.aborted, this.options.timeout, requestId)
      }

      let data: unknown = undefined
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          if (response.ok) {
            throw new WarpError('The API returned a response that is not valid JSON', {
              status: response.status,
              code: 'invalid_response',
              requestId,
            })
          }
        }
      }

      if (!response.ok) {
        const error = errorFromResponse(response.status, data, requestId)
        retryAfter.set(error, parseRetryAfter(response.headers.get('retry-after')))
        throw error
      }
      return data as T
    } finally {
      clearTimeout(timer)
    }
  }
}

const retryAfter = new WeakMap<WarpError, number | undefined>()

function connectionError(error: unknown, timedOut: boolean, timeout: number, requestId?: string): WarpConnectionError {
  if (timedOut) {
    return new WarpConnectionError(`Request timed out after ${timeout}ms`, { code: 'timeout', requestId, cause: error })
  }
  const detail = error instanceof Error ? `: ${error.message}` : ''
  return new WarpConnectionError(`Could not connect to the Warp API${detail}`, {
    code: 'connection_error',
    requestId,
    cause: error,
  })
}

function isRetryable(error: unknown): boolean {
  if (error instanceof WarpConnectionError) return true
  if (!(error instanceof WarpError) || error.status === undefined) return false
  const hinted = retryAfter.get(error)
  if (hinted !== undefined && hinted > MAX_RETRY_AFTER_MS) return false
  return error.status === 429 || error.status >= 500
}

function retryDelay(attempt: number, error: unknown): number {
  const hinted = error instanceof WarpError ? retryAfter.get(error) : undefined
  if (hinted !== undefined) return hinted
  const base = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
  return base * (0.5 + Math.random() * 0.5)
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
