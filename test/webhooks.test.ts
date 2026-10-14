import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Warp,
  WarpError,
  WarpSignatureVerificationError,
  constructEvent,
  generateTestHeader,
  verifySignature,
  type WarpEvent,
} from '../src'
import { TEST_KEY, session } from './helpers'

const SECRET = 'whsec_test_secret'
const NOW = 1_792_065_330

const event: WarpEvent = {
  id: 'evt_3c59dc048e8850243be8079a5c74d079',
  type: 'payment.completed',
  created: NOW,
  data: { object: session({ status: 'completed' }) },
}
const body = JSON.stringify(event)

/** Signs exactly as the Warp webhook sender does. */
function sign(payload: string, t: number = NOW, secret: string = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${v1}`
}

describe('webhooks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a valid signature for string, Buffer and Uint8Array bodies', () => {
    const header = sign(body)
    const bytes = new TextEncoder().encode(body)
    for (const payload of [body, Buffer.from(body), bytes]) {
      expect(verifySignature(payload, header, SECRET)).toBe(true)
      expect(constructEvent(payload, header, SECRET)).toEqual(event)
    }
  })

  it('handles a Uint8Array view into a larger buffer', () => {
    const padded = new TextEncoder().encode(`xxxx${body}yyyy`)
    const view = padded.subarray(4, padded.length - 4)
    expect(constructEvent(view, sign(body), SECRET)).toEqual(event)
  })

  it('rejects a tampered body', () => {
    const header = sign(body)
    const tampered = body.replace('"49.00"', '"0.01"')
    expect(tampered).not.toBe(body)
    expect(verifySignature(tampered, header, SECRET)).toBe(false)
    expect(() => constructEvent(tampered, header, SECRET)).toThrow(WarpSignatureVerificationError)
  })

  it('rejects the wrong secret', () => {
    expect(verifySignature(body, sign(body, NOW, 'other_secret'), SECRET)).toBe(false)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'not a signature'],
    ['no v1', `t=${NOW}`],
    ['no timestamp', 'v1=abcdef'],
    ['non-numeric timestamp', 't=abc,v1=abcdef'],
    ['non-hex signature', `t=${NOW},v1=zzzz`],
    ['truncated signature', sign(body).slice(0, -2)],
  ])('rejects a bad header (%s)', (_name, header) => {
    expect(verifySignature(body, header, SECRET)).toBe(false)
    expect(() => constructEvent(body, header, SECRET)).toThrow(WarpSignatureVerificationError)
  })

  it('rejects an expired or future timestamp outside the tolerance', () => {
    const old = sign(body, NOW - 301)
    const future = sign(body, NOW + 301)
    expect(verifySignature(body, old, SECRET)).toBe(false)
    expect(verifySignature(body, future, SECRET)).toBe(false)
    expect(() => constructEvent(body, old, SECRET)).toThrow(/tolerance/)
    expect(verifySignature(body, sign(body, NOW - 300), SECRET)).toBe(true)
  })

  it('supports a custom tolerance and disabling it with 0', () => {
    const old = sign(body, NOW - 3_600)
    expect(verifySignature(body, old, SECRET, 3_601)).toBe(true)
    expect(verifySignature(body, old, SECRET, 60)).toBe(false)
    expect(verifySignature(body, old, SECRET, 0)).toBe(true)
  })

  it('accepts any matching v1 signature and an array header', () => {
    const valid = sign(body)
    const rotated = `${valid},v1=${'0'.repeat(64)}`
    expect(verifySignature(body, rotated, SECRET)).toBe(true)
    expect(verifySignature(body, [valid], SECRET)).toBe(true)
  })

  it('rejects an empty secret', () => {
    expect(verifySignature(body, sign(body), '')).toBe(false)
    expect(() => constructEvent(body, sign(body), '')).toThrow(/secret/)
  })

  it('explains what to do when given a parsed body', () => {
    const parsed = JSON.parse(body) as unknown as string
    expect(verifySignature(parsed, sign(body), SECRET)).toBe(false)
    expect(() => constructEvent(parsed, sign(body), SECRET)).toThrow(/express\.raw/)
  })

  it('throws on a correctly signed body that is not JSON', () => {
    const error = (() => {
      try {
        constructEvent('not json', sign('not json'), SECRET)
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(WarpSignatureVerificationError)
    expect(error).toBeInstanceOf(WarpError)
    expect(error).toMatchObject({ code: 'invalid_payload' })
  })

  it('generateTestHeader produces a header that verifies', () => {
    expect(generateTestHeader({ payload: body, secret: SECRET, timestamp: NOW })).toBe(sign(body))
    expect(constructEvent(body, generateTestHeader({ payload: body, secret: SECRET }), SECRET)).toEqual(event)
  })

  it('is available on the client', () => {
    const warp = new Warp(TEST_KEY)
    expect(warp.webhooks.constructEvent(body, sign(body), SECRET).type).toBe('payment.completed')
    expect(warp.webhooks.verifySignature(body, 'bad', SECRET)).toBe(false)
  })
})
