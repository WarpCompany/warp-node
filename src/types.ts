/** Network a key and its sessions belong to: `sk_live_` keys are mainnet, `sk_test_` keys are testnet. */
export type Network = 'mainnet' | 'testnet'

export type CheckoutSessionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired'

/** On-chain payment details. Present once the customer has submitted a transaction. */
export interface CheckoutSessionPayment {
  /** Chain the customer paid on, e.g. `base-sepolia`. */
  chain: string | null
  /** Token symbol, e.g. `USDC`. */
  token: string | null
  tx_hash: string
  /** Amount paid, in token units. */
  amount: string | null
  confirmations: number
  completed_at: string | null
}

export interface CheckoutSession {
  /** `ps_` followed by 32 hex characters. */
  id: string
  object: 'checkout.session'
  /** Decimal string with two decimals, e.g. `"49.00"`. */
  amount_usd: string
  currency: 'USD'
  description: string | null
  metadata: Record<string, string>
  /** A pending session past `expires_at` is reported as `expired`. */
  status: CheckoutSessionStatus
  network: Network
  return_url: string | null
  cancel_url: string | null
  /** ISO 8601 timestamp, 30 minutes after creation. */
  expires_at: string
  /** ISO 8601 timestamp. */
  created_at: string
  /** Hosted checkout page. Redirect the customer here. */
  checkout_url: string
  payment: CheckoutSessionPayment | null
}

export interface CheckoutSessionCreateParams {
  /** Amount in USD: a number or decimal string with at most 2 decimals, greater than 0 and at most 1,000,000,000. */
  amount_usd: string | number
  /** Up to 500 characters. */
  description?: string | null
  /** Up to 50 keys (1-40 characters) with string values (up to 500 characters). Keys starting with `_warp_` are reserved. */
  metadata?: Record<string, string> | null
  /** http(s) URL the customer returns to after paying. Defaults to the project's return URL. */
  return_url?: string | null
  /** http(s) URL the customer returns to on cancel. */
  cancel_url?: string | null
}

export interface CheckoutSessionListParams {
  status?: CheckoutSessionStatus
  /** 1 to 100. Defaults to 20. */
  limit?: number
  /** Session ID cursor. Returns sessions created before this one. */
  starting_after?: string
}

export interface List<T> {
  object: 'list'
  data: T[]
  has_more: boolean
}

export interface ZkNonce {
  /** Decimal string below 2^248. Valid once, for 10 minutes. */
  nonce: string
  /** The same nonce as 0x-prefixed, 62-digit hex. */
  nonce_hex: string
  expires_at: string
}

/** A snarkjs Groth16 proof. Coordinates are decimal strings. */
export interface Groth16Proof {
  pi_a: string[]
  pi_b: string[][]
  pi_c: string[]
  protocol?: 'groth16'
  curve?: 'bn128'
}

export interface ZkVerifyParams {
  proof: Groth16Proof
  /** Decimal strings, one per public signal. */
  public_signals: string[]
  /** Decimal nonce from `createNonce`. */
  nonce?: string
  /** Also call the deployed verifier contract. */
  onchain?: boolean
}

export type ZkPolicyCheck = 'ok' | 'mismatch' | 'n/a' | 'invalid_policy'

/** `mismatch`: the nonce is not the proof's nonce signal. `unbound`: accepted, but the circuit has no nonce signal. */
export type ZkNonceCheck = 'ok' | 'missing' | 'used' | 'expired' | 'mismatch' | 'unbound'

export interface ZkOnchainCheck {
  chain_id: number
  contract_address: string
  result: boolean
}

export interface ZkVerifyResult {
  valid: boolean
  proof_id: string
  checks: {
    offchain: boolean
    onchain?: ZkOnchainCheck
    nonce?: ZkNonceCheck
    nullifier?: 'ok' | 'reused'
    policy: ZkPolicyCheck
  }
  verified_at: string
  /** Compact JWS (EdDSA), verifiable against `/v1/.well-known/jwks.json`. */
  receipt: string
}

export interface ZkAbiParameter {
  name: string
  type: string
}

export interface ZkAbiFunction {
  type: 'function'
  name: 'verifyProof'
  stateMutability: 'view'
  inputs: ZkAbiParameter[]
  outputs: ZkAbiParameter[]
}

export interface ZkProofInterface {
  contract_address: string | null
  chain_id: number | null
  network: string | null
  abi: ZkAbiFunction[]
  public_signal_count: number
  snippets: {
    curl: string
    viem: string
    cast: string
    solidity: string
  }
}

export type AttestationStatus =
  | 'draft'
  | 'compiling'
  | 'compiled'
  | 'proving'
  | 'attesting'
  | 'active'
  | 'revoked'
  | 'expired'
  | 'failed'

export type AttestationType = 'ownership' | 'compliance' | 'provenance'

export interface Attestation {
  id: string
  status: AttestationStatus
  type: AttestationType
  /** True only for an active, unexpired, unrevoked attestation registered on-chain. */
  valid: boolean
  expires_at: string | null
  chain_id?: number
  registry_address?: string
}

export type WarpEventType = 'payment.completed' | 'payment.failed' | 'payment.expired'

/** A webhook event. `data.object` is the checkout session in its final state. */
export interface WarpEvent {
  /** `evt_...`. Same value as the `Warp-Event-Id` header. */
  id: string
  type: WarpEventType
  /** Unix timestamp in seconds. */
  created: number
  data: {
    object: CheckoutSession
  }
}
