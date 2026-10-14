import { Warp } from './client'

export { Warp, DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT } from './client'
export type { WarpMode, WarpOptions } from './client'
export type { FetchLike } from './http'
export {
  WarpAPIError,
  WarpAuthenticationError,
  WarpConnectionError,
  WarpError,
  WarpInvalidRequestError,
  WarpNotFoundError,
  WarpRateLimitError,
  WarpSignatureVerificationError,
} from './errors'
export type { WarpErrorOptions } from './errors'
export {
  DEFAULT_TOLERANCE_SECONDS,
  constructEvent,
  generateTestHeader,
  verifySignature,
  webhooks,
} from './webhooks'
export type { SignatureHeader, TestHeaderOptions, WebhookPayload, Webhooks } from './webhooks'
export { Checkout, CheckoutSessions } from './resources/checkout'
export { Zk, ZkProofs } from './resources/zk'
export { Attestations } from './resources/attestations'
export type * from './types'
export { VERSION } from './version'

export default Warp
