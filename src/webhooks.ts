import { createHmac, timingSafeEqual } from 'node:crypto'
import { WarpSignatureVerificationError } from './errors'
import type { WarpEvent } from './types'

/** Default maximum age of a webhook signature, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300

export type WebhookPayload = string | Uint8Array
export type SignatureHeader = string | string[] | null | undefined

function toBuffer(payload: WebhookPayload): Buffer {
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8')
  if (payload instanceof Uint8Array) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  throw new WarpSignatureVerificationError(
    'Webhook payload must be the raw request body as a string or Buffer. If you use express.json(), ' +
      "use express.raw({ type: 'application/json' }) on the webhook route instead.",
    { code: 'invalid_payload' },
  )
}

function sign(payload: Buffer, timestamp: number | string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest('hex')
}

/** Returns null when the signature is valid, otherwise the reason it is not. */
function check(
  payload: WebhookPayload,
  header: SignatureHeader,
  secret: string,
  toleranceSeconds: number,
): string | null {
  const body = toBuffer(payload)
  if (!secret) return 'No webhook signing secret was provided'
  const value = Array.isArray(header) ? header.join(',') : header
  if (!value) return 'No Warp-Signature header was provided'

  let timestamp: string | undefined
  const signatures: string[] = []
  for (const part of value.split(',')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    const key = part.slice(0, i).trim()
    const val = part.slice(i + 1).trim()
    if (key === 't') timestamp = val
    else if (key === 'v1') signatures.push(val)
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
    return 'Unable to parse the Warp-Signature header. Expected "t=<timestamp>,v1=<signature>"'
  }

  if (toleranceSeconds > 0 && Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) {
    return 'Webhook timestamp is outside the tolerance window'
  }

  const expected = Buffer.from(sign(body, timestamp, secret), 'hex')
  const matched = signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false
    const actual = Buffer.from(signature, 'hex')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  })
  return matched ? null : 'No signature in the Warp-Signature header matches the payload'
}

/**
 * Checks a webhook's `Warp-Signature` header against the raw request body.
 * Returns false instead of throwing. Does not need an API key.
 */
export function verifySignature(
  payload: WebhookPayload,
  header: SignatureHeader,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  try {
    return check(payload, header, secret, toleranceSeconds) === null
  } catch {
    return false
  }
}

/**
 * Verifies a webhook and returns the parsed event.
 * Throws `WarpSignatureVerificationError` if the signature is missing, invalid or too old.
 */
export function constructEvent(
  payload: WebhookPayload,
  header: SignatureHeader,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): WarpEvent {
  const reason = check(payload, header, secret, toleranceSeconds)
  if (reason) throw new WarpSignatureVerificationError(reason, { code: 'signature_verification_failed' })
  try {
    return JSON.parse(toBuffer(payload).toString('utf8')) as WarpEvent
  } catch (error) {
    throw new WarpSignatureVerificationError('Webhook payload is not valid JSON', { code: 'invalid_payload', cause: error })
  }
}

export interface TestHeaderOptions {
  payload: WebhookPayload
  secret: string
  /** Unix timestamp in seconds. Defaults to now. */
  timestamp?: number
}

/** Builds a valid `Warp-Signature` header for a payload. Use it in your own tests. */
export function generateTestHeader({ payload, secret, timestamp }: TestHeaderOptions): string {
  const t = timestamp ?? Math.floor(Date.now() / 1000)
  return `t=${t},v1=${sign(toBuffer(payload), t, secret)}`
}

export interface Webhooks {
  constructEvent: typeof constructEvent
  verifySignature: typeof verifySignature
  generateTestHeader: typeof generateTestHeader
}

/** Webhook helpers. Also available as `warp.webhooks`. */
export const webhooks: Webhooks = { constructEvent, verifySignature, generateTestHeader }
