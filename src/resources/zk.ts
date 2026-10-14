import type { HttpClient } from '../http'
import type { ZkNonce, ZkProofInterface, ZkVerifyParams, ZkVerifyResult } from '../types'
import { encodePathSegment } from './checkout'

export class ZkProofs {
  constructor(private readonly http: HttpClient) {}

  /** Issues a single-use nonce (valid 10 minutes) to bind into the next proof. Not retried. */
  createNonce(proofId: string): Promise<ZkNonce> {
    return this.http.request({ method: 'POST', path: `${proofPath(proofId)}/nonces` })
  }

  /** Verifies a Groth16 proof and returns the result with a signed receipt. Not retried. */
  verify(proofId: string, params: ZkVerifyParams): Promise<ZkVerifyResult> {
    return this.http.request({ method: 'POST', path: `${proofPath(proofId)}/verify`, body: params })
  }

  /** Returns the verifier contract, ABI and integration snippets for a proof. */
  getInterface(proofId: string): Promise<ZkProofInterface> {
    return this.http.request({ method: 'GET', path: `${proofPath(proofId)}/interface` })
  }
}

export class Zk {
  readonly proofs: ZkProofs

  constructor(http: HttpClient) {
    this.proofs = new ZkProofs(http)
  }
}

function proofPath(proofId: string): string {
  return `/v1/zk/proofs/${encodePathSegment(proofId, 'proofId')}`
}
