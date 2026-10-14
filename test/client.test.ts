import { afterEach, describe, expect, it } from 'vitest'
import WarpDefault, { Warp, webhooks } from '../src'
import { LIVE_KEY, TEST_KEY, jsonResponse, mockFetch, session } from './helpers'

describe('Warp constructor', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('exports the client as default and named export', () => {
    expect(WarpDefault).toBe(Warp)
  })

  it('derives the mode from the key', () => {
    expect(new Warp(TEST_KEY).mode).toBe('test')
    expect(new Warp(LIVE_KEY).mode).toBe('live')
  })

  it('rejects missing and malformed keys', () => {
    expect(() => new Warp(undefined as unknown as string)).toThrow(/Missing API key/)
    expect(() => new Warp('')).toThrow(/Missing API key/)
    expect(() => new Warp('sk_other_123')).toThrow(/sk_test_.*sk_live_/)
    expect(() => new Warp('pk_test_123')).toThrow(/Publishable keys/)
  })

  it('validates timeout and maxRetries', () => {
    expect(() => new Warp(TEST_KEY, { timeout: 0 })).toThrow(RangeError)
    expect(() => new Warp(TEST_KEY, { maxRetries: -1 })).toThrow(RangeError)
    expect(() => new Warp(TEST_KEY, { maxRetries: 1.5 })).toThrow(RangeError)
  })

  it('refuses to run in a browser unless explicitly allowed', () => {
    ;(globalThis as { window?: unknown }).window = {}
    expect(() => new Warp(TEST_KEY)).toThrow(/must not run in a browser/)
    expect(new Warp(TEST_KEY, { dangerouslyAllowBrowser: true }).mode).toBe('test')
  })

  it('exposes the webhook helpers', () => {
    expect(new Warp(TEST_KEY).webhooks).toBe(webhooks)
  })

  it('sends auth, user agent and JSON headers to the configured base URL', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(201, session()))
    const warp = new Warp(TEST_KEY, { fetch, baseUrl: 'https://api.example.test/' })
    await warp.checkout.sessions.create({ amount_usd: '49.00' })

    expect(calls[0]!.url.toString()).toBe('https://api.example.test/v1/checkout/sessions')
    expect(calls[0]!.headers).toMatchObject({
      Authorization: `Bearer ${TEST_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': '@warpfi/node/0.1.0',
    })
  })
})
