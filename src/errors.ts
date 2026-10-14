export interface WarpErrorOptions {
  status?: number
  code?: string
  requestId?: string
  cause?: unknown
}

/** Base class for every error thrown by the SDK. */
export class WarpError extends Error {
  /** HTTP status code, when the error came from an API response. */
  readonly status: number | undefined
  /** Machine-readable error code, e.g. `invalid_request` or `not_found`. */
  readonly code: string
  /** Value of the `X-Request-Id` response header. Include it when contacting support. */
  readonly requestId: string | undefined

  constructor(message: string, options: WarpErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.status = options.status
    this.code = options.code ?? 'warp_error'
    this.requestId = options.requestId
  }
}

/** 401: missing, malformed or revoked secret key. */
export class WarpAuthenticationError extends WarpError {}

/** 400 or 422: the request was rejected by validation. */
export class WarpInvalidRequestError extends WarpError {}

/** 404: the resource does not exist for this key's project and network. */
export class WarpNotFoundError extends WarpError {}

/** 429: too many requests. */
export class WarpRateLimitError extends WarpError {}

/** 5xx: the API failed to handle the request. */
export class WarpAPIError extends WarpError {}

/** The request did not reach the API, or timed out. */
export class WarpConnectionError extends WarpError {}

/** A webhook signature could not be verified. */
export class WarpSignatureVerificationError extends WarpError {}

/** Maps an HTTP error response to the matching error class. */
export function errorFromResponse(status: number, body: unknown, requestId: string | undefined): WarpError {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null | undefined)?.error
  const code = typeof error?.code === 'string' ? error.code : 'http_error'
  const message = typeof error?.message === 'string' ? error.message : `Request failed with status ${status}`
  const options = { status, code, requestId }

  if (status === 401) return new WarpAuthenticationError(message, options)
  if (status === 400 || status === 422) return new WarpInvalidRequestError(message, options)
  if (status === 404) return new WarpNotFoundError(message, options)
  if (status === 429) return new WarpRateLimitError(message, options)
  if (status >= 500) return new WarpAPIError(message, options)
  return new WarpError(message, options)
}
