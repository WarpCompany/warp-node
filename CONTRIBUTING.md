# Contributing

Thanks for your interest in @warpfi/node.

## Development

1. Fork the repository and create a branch from `main`.
2. Follow the setup in the [README](./README.md).
3. Before opening a pull request, make sure these pass:

   ```bash
   npm run lint
   npm test
   npm run build
   ```

4. Open a pull request describing what changed and why. Link any related issue.

Use `sk_test_` keys and testnet sessions when testing against the API. Never use an `sk_live_` key in tests.

## Guidelines

- Keep pull requests focused on a single change.
- Never commit secrets or `.env` files.
- The package has no runtime dependencies. Please keep it that way.
- For larger changes, open an issue first so we can agree on the approach.

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](./SECURITY.md).
