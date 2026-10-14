import type { HttpClient } from '../http'
import type {
  CheckoutSession,
  CheckoutSessionCreateParams,
  CheckoutSessionListParams,
  List,
} from '../types'

export class CheckoutSessions {
  constructor(private readonly http: HttpClient) {}

  /** Creates a checkout session. Redirect the customer to its `checkout_url`. Not retried. */
  create(params: CheckoutSessionCreateParams): Promise<CheckoutSession> {
    return this.http.request({ method: 'POST', path: '/v1/checkout/sessions', body: params })
  }

  /** Retrieves a checkout session by ID (`ps_...`). */
  retrieve(id: string): Promise<CheckoutSession> {
    return this.http.request({ method: 'GET', path: `/v1/checkout/sessions/${encodePathSegment(id, 'id')}` })
  }

  /** Lists checkout sessions, newest first. */
  list(params: CheckoutSessionListParams = {}): Promise<List<CheckoutSession>> {
    return this.http.request({
      method: 'GET',
      path: '/v1/checkout/sessions',
      query: { status: params.status, limit: params.limit, starting_after: params.starting_after },
    })
  }

  /** Iterates over every matching session, fetching pages with `starting_after` as needed. */
  async *listAll(params: CheckoutSessionListParams = {}): AsyncIterableIterator<CheckoutSession> {
    let cursor = params.starting_after
    for (;;) {
      const page = await this.list({ ...params, limit: params.limit ?? 100, starting_after: cursor })
      yield* page.data
      const last = page.data[page.data.length - 1]
      if (!page.has_more || !last) return
      cursor = last.id
    }
  }
}

export class Checkout {
  readonly sessions: CheckoutSessions

  constructor(http: HttpClient) {
    this.sessions = new CheckoutSessions(http)
  }
}

export function encodePathSegment(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return encodeURIComponent(value)
}
