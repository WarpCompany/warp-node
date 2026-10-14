import { vi } from 'vitest'
import type { CheckoutSession } from '../src'

export const TEST_KEY = `sk_test_${'a'.repeat(48)}`
export const LIVE_KEY = `sk_live_${'b'.repeat(48)}`

export interface RecordedCall {
  url: URL
  method: string
  headers: Record<string, string>
  body: unknown
}

type Reply = Response | Error | ((init: RequestInit) => Promise<Response>)

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_test123', ...headers },
  })
}

/** A fetch mock that answers with the given replies in order and records every call. */
export function mockFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = []
  const fn = vi.fn(async (input: string, init: RequestInit) => {
    calls.push({
      url: new URL(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const reply = replies.shift()
    if (!reply) throw new Error('Unexpected fetch call')
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply(init)
    return reply
  })
  return { fetch: fn, calls }
}

export function session(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  const id = overrides.id ?? `ps_${'0'.repeat(32)}`
  return {
    id,
    object: 'checkout.session',
    amount_usd: '49.00',
    currency: 'USD',
    description: 'Pro plan',
    metadata: { order_id: '1234' },
    status: 'pending',
    network: 'testnet',
    return_url: 'https://shop.example/thanks',
    cancel_url: null,
    expires_at: '2026-10-15T12:30:00.000Z',
    created_at: '2026-10-15T12:00:00.000Z',
    checkout_url: `https://checkout.usewarp.net/session/${id}`,
    payment: null,
    ...overrides,
  }
}

export function sessionId(n: number): string {
  return `ps_${n.toString(16).padStart(32, '0')}`
}
