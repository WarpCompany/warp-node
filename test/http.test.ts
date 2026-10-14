import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Warp,
  WarpAPIError,
  WarpAuthenticationError,
  WarpConnectionError,
  WarpError,
  WarpInvalidRequestError,
  WarpNotFoundError,
  WarpRateLimitError,
} from '../src'
import { TEST_KEY, jsonResponse, mockFetch, session, sessionId } from './helpers'

const errorBody = (code: string, message: string) => ({ error: { code, message } })

describe('error mapping', () => {
  const cases: [number, string, new (...args: never[]) => WarpError][] = [
    [400, 'invalid_request', WarpInvalidRequestError],
    [422, 'invalid_request', WarpInvalidRequestError],
    [401, 'unauthorized', WarpAuthenticationError],
    [404, 'not_found', WarpNotFoundError],
    [429, 'rate_limited', WarpRateLimitError],
    [500, 'internal_error', WarpAPIError],
    [502, 'onchain_unavailable', WarpAPIError],
    [409, 'proof_not_ready', WarpError],
  ]

  it.each(cases)('maps %i to the right error class', async (status, code, ErrorClass) => {
    const { fetch } = mockFetch(jsonResponse(status, errorBody(code, `message for ${status}`), { 'X-Request-Id': 'req_abc' }))
    const warp = new Warp(TEST_KEY, { fetch, maxRetries: 0 })

    const error = await warp.checkout.sessions.create({ amount_usd: 1 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ErrorClass)
    expect(error).toBeInstanceOf(WarpError)
    expect(error).toMatchObject({ status, code, message: `message for ${status}`, requestId: 'req_abc' })
    expect((error as Error).name).toBe(ErrorClass.name)
  })

  it('handles error bodies that are not JSON', async () => {
    const { fetch } = mockFetch(new Response('<html>Bad gateway</html>', { status: 502 }))
    const error = await new Warp(TEST_KEY, { fetch }).checkout.sessions.create({ amount_usd: 1 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WarpAPIError)
    expect(error).toMatchObject({ status: 502, code: 'http_error', requestId: undefined })
  })

  it('rejects a success response that is not JSON', async () => {
    const { fetch } = mockFetch(new Response('not json', { status: 200, headers: { 'X-Request-Id': 'req_x' } }))
    const error = await new Warp(TEST_KEY, { fetch, maxRetries: 0 }).checkout.sessions.retrieve(sessionId(1)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WarpError)
    expect(error).toMatchObject({ code: 'invalid_response', requestId: 'req_x' })
  })
})

describe('retries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function settle<T>(promise: Promise<T>): Promise<T> {
    const result = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await vi.runAllTimersAsync()
    const outcome = await result
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }

  it('retries GET on 5xx, 429 and network errors', async () => {
    const { fetch } = mockFetch(
      jsonResponse(503, errorBody('internal_error', 'down')),
      new TypeError('fetch failed'),
      jsonResponse(200, session()),
    )
    const warp = new Warp(TEST_KEY, { fetch })
    await expect(settle(warp.checkout.sessions.retrieve(sessionId(0)))).resolves.toEqual(session())
    expect(fetch).toHaveBeenCalledTimes(3)

    const rateLimited = mockFetch(jsonResponse(429, errorBody('rate_limited', 'slow down')), jsonResponse(200, session()))
    const warp2 = new Warp(TEST_KEY, { fetch: rateLimited.fetch })
    await expect(settle(warp2.checkout.sessions.retrieve(sessionId(0)))).resolves.toEqual(session())
    expect(rateLimited.fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetries and throws the last error', async () => {
    const { fetch } = mockFetch(
      jsonResponse(500, errorBody('internal_error', 'one')),
      jsonResponse(500, errorBody('internal_error', 'two')),
      jsonResponse(500, errorBody('internal_error', 'three')),
    )
    const warp = new Warp(TEST_KEY, { fetch, maxRetries: 2 })
    await expect(settle(warp.checkout.sessions.list())).rejects.toThrow('three')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry GET on 4xx other than 429', async () => {
    const { fetch } = mockFetch(jsonResponse(404, errorBody('not_found', 'Session not found')))
    const warp = new Warp(TEST_KEY, { fetch })
    await expect(settle(warp.checkout.sessions.retrieve(sessionId(0)))).rejects.toBeInstanceOf(WarpNotFoundError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never retries POST', async () => {
    const failures = () => [
      jsonResponse(500, errorBody('internal_error', 'x')),
      jsonResponse(429, errorBody('rate_limited', 'x')),
      new TypeError('fetch failed'),
    ]
    const posts: ((warp: Warp) => Promise<unknown>)[] = [
      (warp: Warp) => warp.checkout.sessions.create({ amount_usd: 1 }),
      (warp: Warp) => warp.zk.proofs.createNonce('5b0f1c1e-8f0a-4c3e-9d4b-2a7f6c1d9e10'),
      (warp: Warp) =>
        warp.zk.proofs.verify('5b0f1c1e-8f0a-4c3e-9d4b-2a7f6c1d9e10', {
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          public_signals: ['1'],
        }),
    ]
    for (const post of posts) {
      for (const reply of failures()) {
        const { fetch } = mockFetch(reply, jsonResponse(200, {}))
        const warp = new Warp(TEST_KEY, { fetch, maxRetries: 5 })
        await expect(settle(post(warp))).rejects.toBeInstanceOf(WarpError)
        expect(fetch).toHaveBeenCalledTimes(1)
      }
    }
  })

  it('honors a short Retry-After header', async () => {
    const { fetch } = mockFetch(
      jsonResponse(429, errorBody('rate_limited', 'x'), { 'Retry-After': '3' }),
      jsonResponse(200, session()),
    )
    const warp = new Warp(TEST_KEY, { fetch })
    const promise = warp.checkout.sessions.retrieve(sessionId(0))
    await vi.advanceTimersByTimeAsync(2_900)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(promise).resolves.toEqual(session())
  })

  it('does not wait out a long Retry-After', async () => {
    const { fetch } = mockFetch(jsonResponse(429, errorBody('rate_limited', 'x'), { 'Retry-After': '900' }))
    const warp = new Warp(TEST_KEY, { fetch })
    await expect(settle(warp.checkout.sessions.list())).rejects.toBeInstanceOf(WarpRateLimitError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('wraps network errors in WarpConnectionError', async () => {
    const cause = new TypeError('fetch failed')
    const { fetch } = mockFetch(cause)
    const warp = new Warp(TEST_KEY, { fetch, maxRetries: 0 })
    const error = await settle(warp.checkout.sessions.list()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WarpConnectionError)
    expect(error).toMatchObject({ code: 'connection_error', status: undefined, cause })
  })
})

describe('timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const hangUntilAborted = (init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })

  it('aborts a request that takes longer than the timeout', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch(hangUntilAborted)
    const warp = new Warp(TEST_KEY, { fetch, timeout: 1_000, maxRetries: 0 })

    const result = warp.checkout.sessions.create({ amount_usd: 1 }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    const error = await result

    expect(error).toBeInstanceOf(WarpConnectionError)
    expect(error).toMatchObject({ code: 'timeout', message: 'Request timed out after 1000ms' })
  })

  it('retries a timed out GET', async () => {
    vi.useFakeTimers()
    const { fetch } = mockFetch(hangUntilAborted, jsonResponse(200, session()))
    const warp = new Warp(TEST_KEY, { fetch, timeout: 1_000, maxRetries: 1 })
    const promise = warp.checkout.sessions.retrieve(sessionId(0))
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toEqual(session())
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
