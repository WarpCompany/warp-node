import { describe, expect, it } from 'vitest'
import { Warp, type Attestation, type ZkProofInterface, type ZkVerifyResult } from '../src'
import { TEST_KEY, jsonResponse, mockFetch, session, sessionId } from './helpers'

const PROOF_ID = '5b0f1c1e-8f0a-4c3e-9d4b-2a7f6c1d9e10'

describe('checkout.sessions', () => {
  it('creates a session', async () => {
    const created = session()
    const { fetch, calls } = mockFetch(jsonResponse(201, created))
    const warp = new Warp(TEST_KEY, { fetch })

    const result = await warp.checkout.sessions.create({
      amount_usd: 49,
      description: 'Pro plan',
      metadata: { order_id: '1234' },
      return_url: 'https://shop.example/thanks',
    })

    expect(result).toEqual(created)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.pathname).toBe('/v1/checkout/sessions')
    expect(calls[0]!.body).toEqual({
      amount_usd: 49,
      description: 'Pro plan',
      metadata: { order_id: '1234' },
      return_url: 'https://shop.example/thanks',
    })
  })

  it('retrieves a session', async () => {
    const id = sessionId(7)
    const { fetch, calls } = mockFetch(jsonResponse(200, session({ id, status: 'completed' })))
    const warp = new Warp(TEST_KEY, { fetch })

    const result = await warp.checkout.sessions.retrieve(id)

    expect(result.status).toBe('completed')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.pathname).toBe(`/v1/checkout/sessions/${id}`)
    expect(calls[0]!.body).toBeUndefined()
  })

  it('encodes the id and rejects an empty one', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(404, { error: { code: 'not_found', message: 'Session not found' } }))
    const warp = new Warp(TEST_KEY, { fetch })
    await expect(warp.checkout.sessions.retrieve('../x?y')).rejects.toThrow('Session not found')
    expect(calls[0]!.url.pathname).toBe('/v1/checkout/sessions/..%2Fx%3Fy')
    expect(() => warp.checkout.sessions.retrieve('')).toThrow(TypeError)
  })

  it('lists sessions with query parameters', async () => {
    const page = { object: 'list', data: [session()], has_more: false }
    const { fetch, calls } = mockFetch(jsonResponse(200, page))
    const warp = new Warp(TEST_KEY, { fetch })

    const result = await warp.checkout.sessions.list({ status: 'completed', limit: 5, starting_after: sessionId(9) })

    expect(result).toEqual(page)
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      status: 'completed',
      limit: '5',
      starting_after: sessionId(9),
    })
  })

  it('lists without query parameters by default', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(200, { object: 'list', data: [], has_more: false }))
    await new Warp(TEST_KEY, { fetch }).checkout.sessions.list()
    expect(calls[0]!.url.search).toBe('')
  })

  it('listAll follows starting_after across pages', async () => {
    const { fetch, calls } = mockFetch(
      jsonResponse(200, { object: 'list', data: [session({ id: sessionId(5) }), session({ id: sessionId(4) })], has_more: true }),
      jsonResponse(200, { object: 'list', data: [session({ id: sessionId(3) }), session({ id: sessionId(2) })], has_more: true }),
      jsonResponse(200, { object: 'list', data: [session({ id: sessionId(1) })], has_more: false }),
    )
    const warp = new Warp(TEST_KEY, { fetch })

    const ids: string[] = []
    for await (const s of warp.checkout.sessions.listAll({ status: 'completed', limit: 2 })) ids.push(s.id)

    expect(ids).toEqual([5, 4, 3, 2, 1].map(sessionId))
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.url.searchParams.get('starting_after'))).toEqual([null, sessionId(4), sessionId(2)])
    expect(calls.every((c) => c.url.searchParams.get('status') === 'completed')).toBe(true)
    expect(calls.every((c) => c.url.searchParams.get('limit') === '2')).toBe(true)
  })

  it('listAll uses limit 100 by default and stops on an empty page', async () => {
    const { fetch, calls } = mockFetch(jsonResponse(200, { object: 'list', data: [], has_more: true }))
    const warp = new Warp(TEST_KEY, { fetch })
    const all = []
    for await (const s of warp.checkout.sessions.listAll()) all.push(s)
    expect(all).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.searchParams.get('limit')).toBe('100')
  })

  it('listAll can stop early without fetching more pages', async () => {
    const { fetch, calls } = mockFetch(
      jsonResponse(200, { object: 'list', data: [session({ id: sessionId(2) }), session({ id: sessionId(1) })], has_more: true }),
    )
    const warp = new Warp(TEST_KEY, { fetch })
    for await (const s of warp.checkout.sessions.listAll()) {
      expect(s.id).toBe(sessionId(2))
      break
    }
    expect(calls).toHaveLength(1)
  })
})

describe('zk.proofs', () => {
  const proof = { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4'], ['1', '0']], pi_c: ['5', '6', '1'] }

  it('creates a nonce', async () => {
    const nonce = { nonce: '42', nonce_hex: `0x${'0'.repeat(60)}2a`, expires_at: '2026-10-15T12:10:00.000Z' }
    const { fetch, calls } = mockFetch(jsonResponse(201, nonce))
    const result = await new Warp(TEST_KEY, { fetch }).zk.proofs.createNonce(PROOF_ID)
    expect(result).toEqual(nonce)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.pathname).toBe(`/v1/zk/proofs/${PROOF_ID}/nonces`)
    expect(calls[0]!.headers['Content-Type']).toBeUndefined()
  })

  it('verifies a proof', async () => {
    const verified: ZkVerifyResult = {
      valid: true,
      proof_id: PROOF_ID,
      checks: { offchain: true, nonce: 'ok', policy: 'ok' },
      verified_at: '2026-10-15T12:00:00.000Z',
      receipt: 'eyJhbGciOiJFZERTQSJ9.e30.sig',
    }
    const { fetch, calls } = mockFetch(jsonResponse(200, verified))
    const params = { proof, public_signals: ['33', '42'], nonce: '42', onchain: false }

    const result = await new Warp(TEST_KEY, { fetch }).zk.proofs.verify(PROOF_ID, params)

    expect(result).toEqual(verified)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.pathname).toBe(`/v1/zk/proofs/${PROOF_ID}/verify`)
    expect(calls[0]!.body).toEqual(params)
  })

  it('gets the verifier interface', async () => {
    const iface: ZkProofInterface = {
      contract_address: null,
      chain_id: null,
      network: null,
      abi: [
        {
          type: 'function',
          name: 'verifyProof',
          stateMutability: 'view',
          inputs: [{ name: '_pubSignals', type: 'uint256[2]' }],
          outputs: [{ name: '', type: 'bool' }],
        },
      ],
      public_signal_count: 2,
      snippets: { curl: 'curl', viem: 'viem', cast: 'cast', solidity: 'solidity' },
    }
    const { fetch, calls } = mockFetch(jsonResponse(200, iface))
    expect(await new Warp(TEST_KEY, { fetch }).zk.proofs.getInterface(PROOF_ID)).toEqual(iface)
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.pathname).toBe(`/v1/zk/proofs/${PROOF_ID}/interface`)
  })
})

describe('attestations', () => {
  it('retrieves an attestation without sending the secret key', async () => {
    const attestation: Attestation = {
      id: PROOF_ID,
      status: 'active',
      type: 'ownership',
      valid: true,
      expires_at: null,
      chain_id: 84532,
      registry_address: '0x0000000000000000000000000000000000000001',
    }
    const { fetch, calls } = mockFetch(jsonResponse(200, attestation))
    expect(await new Warp(TEST_KEY, { fetch }).attestations.retrieve(PROOF_ID)).toEqual(attestation)
    expect(calls[0]!.url.pathname).toBe(`/v1/attestations/${PROOF_ID}`)
    expect(calls[0]!.headers.Authorization).toBeUndefined()
  })
})
