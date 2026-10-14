<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/symbol_white.png" />
    <img src="./.github/assets/symbol_black.png" alt="Warp" height="64" />
  </picture>
</p>

<h1 align="center">Pay with Warp: Node.js SDK</h1>

<p align="center">
  The server-side library for the <a href="https://usewarp.net">Pay with Warp</a> API.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usewarp/node"><img src="https://img.shields.io/npm/v/@usewarp/node?color=9E1FAA" alt="npm" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <a href="https://developer.usewarp.net"><img src="https://img.shields.io/badge/docs-developer.usewarp.net-9E1FAA" alt="Docs" /></a>
</p>

---

Your server creates a checkout session with your secret key and sends the customer to its `checkout_url`. The customer pays on the hosted checkout, or in an embedded one with [@usewarp/js](https://github.com/WarpCompany/warp-js). Warp verifies the payment on-chain and sends a signed webhook to your server, which you check with this library before fulfilling the order.

> [!WARNING]
> This project is under active development. Test with `sk_test_` keys on testnets before accepting mainnet payments.

## Features

- Checkout sessions: create, retrieve, list and iterate over every page
- Webhook signature verification with replay protection
- ZK proof verification, nonces and verifier contract details
- Public attestation lookups
- Typed requests, responses and errors, with the `X-Request-Id` on every API error
- Automatic retries for reads, timeouts, and no runtime dependencies

## Installation

Requirements: Node.js 18 or later. Use it on your server only.

```bash
npm install @usewarp/node
```

## Usage

Create a session on your server and redirect the customer to it:

```ts
import express from 'express'
import Warp from '@usewarp/node'

const warp = new Warp(process.env.WARP_SECRET_KEY!)
const app = express()

app.post('/checkout', async (req, res) => {
  const session = await warp.checkout.sessions.create({
    amount_usd: '49.00',
    description: 'Pro plan',
    metadata: { order_id: '1234' },
    return_url: 'https://shop.example/orders/1234',
    cancel_url: 'https://shop.example/cart',
  })
  res.redirect(303, session.checkout_url)
})
```

`amount_usd` accepts a number or a string with at most two decimals and is always returned as a string, for example `"49.00"`. Sessions expire after 30 minutes. `sk_test_` keys create testnet sessions and `sk_live_` keys create mainnet sessions; `warp.mode` is `'test'` or `'live'`.

CommonJS works too: `const { Warp } = require('@usewarp/node')`.

### Return page

The redirect back to `return_url` is a UI signal only. Retrieve the session to show its current status, and fulfill orders from the webhook:

```ts
app.get('/orders/:id', async (req, res) => {
  const order = await db.orders.find(req.params.id)
  const session = await warp.checkout.sessions.retrieve(order.warpSessionId)

  if (session.status === 'completed') {
    res.render('thanks', { txHash: session.payment?.tx_hash })
  } else {
    res.render('pending', { status: session.status })
  }
})
```

### Listing sessions

`list` returns one page, newest first. `listAll` follows `starting_after` for you:

```ts
const page = await warp.checkout.sessions.list({ status: 'completed', limit: 20 })
console.log(page.data.length, page.has_more)

for await (const session of warp.checkout.sessions.listAll({ status: 'completed' })) {
  console.log(session.id, session.amount_usd, session.payment?.tx_hash)
}
```

### Webhooks

Warp signs each delivery with the `Warp-Signature` header. Verify it against the raw request body, so mount `express.raw()` on the webhook route instead of `express.json()`:

```ts
import express from 'express'
import Warp, { WarpSignatureVerificationError } from '@usewarp/node'

const warp = new Warp(process.env.WARP_SECRET_KEY!)
const app = express()

app.post('/webhooks/warp', express.raw({ type: 'application/json' }), async (req, res) => {
  let event
  try {
    event = warp.webhooks.constructEvent(req.body, req.get('Warp-Signature'), process.env.WARP_WEBHOOK_SECRET!)
  } catch (err) {
    if (err instanceof WarpSignatureVerificationError) return res.status(400).send('Invalid signature')
    throw err
  }

  // Deliveries can repeat. Process each event ID once.
  if (await alreadyProcessed(event.id)) return res.sendStatus(200)

  const session = event.data.object
  switch (event.type) {
    case 'payment.completed':
      await markOrderPaid(session.metadata.order_id, session.payment?.tx_hash)
      break
    case 'payment.failed':
    case 'payment.expired':
      await releaseOrder(session.metadata.order_id)
      break
  }

  await recordProcessed(event.id)
  res.sendStatus(200)
})
```

`constructEvent` throws `WarpSignatureVerificationError` if the header is missing or malformed, the signature does not match, or the timestamp is more than 300 seconds from your clock (pass a fourth argument to change the tolerance). The body can be a `Buffer`, `Uint8Array` or string.

The webhook helpers do not use your API key. Import them directly where you have no client:

```ts
import { verifySignature } from '@usewarp/node'

const ok = verifySignature(rawBody, signatureHeader, process.env.WARP_WEBHOOK_SECRET!)
```

In your own tests, `generateTestHeader({ payload, secret })` returns a valid header for a payload.

### ZK proofs

Request a nonce, bind it into the proof as a public input, then verify the proof server-side:

```ts
const { nonce } = await warp.zk.proofs.createNonce(proofId)

// ...generate the proof with snarkjs, using `nonce` as the nonce input...

const result = await warp.zk.proofs.verify(proofId, {
  proof,                   // snarkjs Groth16 proof: { pi_a, pi_b, pi_c }
  public_signals: publicSignals,
  nonce,
  onchain: false,          // true also calls the deployed verifier contract
})

if (result.valid) {
  // result.receipt is a signed JWS, verifiable against /v1/.well-known/jwks.json
}
console.log(result.checks) // { offchain, policy, nonce?, nullifier?, onchain? }
```

`warp.zk.proofs.getInterface(proofId)` returns the verifier contract address, chain, ABI and ready-to-use snippets. `warp.attestations.retrieve(id)` returns an attestation's public status and does not send your key.

### Errors

Every error is a `WarpError` with `message`, `status`, `code` and `requestId` (the `X-Request-Id` header; include it when contacting support):

```ts
import { WarpError, WarpInvalidRequestError } from '@usewarp/node'

try {
  await warp.checkout.sessions.create({ amount_usd: '49.999' })
} catch (err) {
  if (err instanceof WarpInvalidRequestError) {
    console.error(err.code, err.message) // invalid_request amount_usd: must be a positive amount with at most 2 decimals
  } else if (err instanceof WarpError) {
    console.error(err.status, err.code, err.requestId)
  }
  throw err
}
```

| Class | When |
| ----- | ---- |
| `WarpAuthenticationError` | 401: missing or invalid secret key |
| `WarpInvalidRequestError` | 400 or 422: invalid parameters |
| `WarpNotFoundError` | 404: no such resource for this key's project and network |
| `WarpRateLimitError` | 429: too many requests |
| `WarpAPIError` | 5xx: the API failed to handle the request |
| `WarpConnectionError` | Network error or timeout (`code` is `connection_error` or `timeout`) |
| `WarpSignatureVerificationError` | A webhook signature could not be verified |

Other statuses, such as 409 `proof_not_ready`, are thrown as `WarpError`.

### Configuration

```ts
const warp = new Warp(process.env.WARP_SECRET_KEY!, { timeout: 10_000, maxRetries: 3 })
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `baseUrl` | `https://api.usewarp.net` | API origin |
| `timeout` | `30000` | Timeout per attempt, in milliseconds |
| `maxRetries` | `2` | Retries for GET requests on network errors, 429 and 5xx, with exponential backoff. POST requests are never retried, because the API has no idempotency keys. |
| `fetch` | global `fetch` | Custom fetch implementation |
| `dangerouslyAllowBrowser` | `false` | The constructor throws in a browser, where it would expose your secret key. Set to `true` only if you understand the risk. |

The constructor also throws if the key does not start with `sk_test_` or `sk_live_`.

## API

| Export | Description |
| ------ | ----------- |
| `Warp` (default) | Client. `new Warp(secretKey, options?)` |
| `warp.checkout.sessions.create(params)` | Create a checkout session |
| `warp.checkout.sessions.retrieve(id)` | Retrieve a session by ID |
| `warp.checkout.sessions.list(params?)` | One page of sessions: `{ object: 'list', data, has_more }` |
| `warp.checkout.sessions.listAll(params?)` | Async iterator over every matching session |
| `warp.zk.proofs.createNonce(proofId)` | Issue a single-use nonce, valid for 10 minutes |
| `warp.zk.proofs.verify(proofId, params)` | Verify a Groth16 proof and get a signed receipt |
| `warp.zk.proofs.getInterface(proofId)` | Verifier contract, ABI and snippets |
| `warp.attestations.retrieve(id)` | Public attestation status |
| `warp.webhooks` | `constructEvent`, `verifySignature`, `generateTestHeader` |
| `constructEvent(body, header, secret, tolerance?)` | Verify a webhook and return the `WarpEvent` |
| `verifySignature(body, header, secret, tolerance?)` | Verify a webhook, returning `true` or `false` |
| `generateTestHeader({ payload, secret, timestamp? })` | Build a valid `Warp-Signature` header for tests |
| `WarpError` and subclasses | See [Errors](#errors) |
| Types | `CheckoutSession`, `CheckoutSessionCreateParams`, `CheckoutSessionListParams`, `List`, `WarpEvent`, `ZkVerifyParams`, `ZkVerifyResult`, `ZkNonce`, `ZkProofInterface`, `Attestation` and more |

## Documentation

| Topic | Description |
| ----- | ----------- |
| [Pay with Warp](https://developer.usewarp.net/warp-pay) | Checkout sessions and the payment flow |
| [Webhooks](https://developer.usewarp.net/warp-pay/webhooks) | Signature verification and retries |
| [ZK Proofs](https://developer.usewarp.net/zkproofs/introduction) | Circuits, policies, nonces and server-side verification |
| [API reference](https://developer.usewarp.net/api-reference/introduction) | Endpoints, parameters and errors |

Full product documentation is at [developer.usewarp.net](https://developer.usewarp.net).

## Development

```bash
git clone https://github.com/WarpCompany/warp-node.git
cd warp-node
npm install
npm test
npm run build
```

## Project structure

```
src/            Client, HTTP layer, errors, webhooks and types
src/resources/  Checkout sessions, ZK proofs and attestations
test/           Vitest tests with a mocked fetch
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Please report security issues privately as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
