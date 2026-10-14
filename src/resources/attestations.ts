import type { HttpClient } from '../http'
import type { Attestation } from '../types'
import { encodePathSegment } from './checkout'

export class Attestations {
  constructor(private readonly http: HttpClient) {}

  /** Retrieves an attestation's public status. Public endpoint: the secret key is not sent. */
  retrieve(id: string): Promise<Attestation> {
    return this.http.request({ method: 'GET', path: `/v1/attestations/${encodePathSegment(id, 'id')}`, auth: false })
  }
}
