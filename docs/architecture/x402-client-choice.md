# x402 Client Choice

**Decision:** Use `@x402/fetch` + `@x402/evm` (v2.x) from the x402 Foundation / Coinbase.

## Package details

| Package | Version | Purpose |
|---------|---------|---------|
| `@x402/fetch` | ^2.10.0 | Wraps native `fetch` — auto-handles 402, signs payment, retries |
| `@x402/evm` | ^2.10.0 | EVM payment scheme (Base, Ethereum, etc.) |
| `@x402/core` | ^2.10.0 | Shared protocol types (transitive dep) |

## Why these packages

- **Official x402 ecosystem** — maintained by Coinbase / x402 Foundation, Apache-2.0.
- **Production proven** — 75M+ transactions, $24M+ volume (as of 2026-04).
- **viem compatible** — uses viem ^2.x internally, same as our SDK.
- **Drop-in fetch wrapper** — `wrapFetchWithPaymentFromConfig(fetch, config)` transparently handles the 402 flow.
- **No peer deps** — everything bundled, minimal setup.

## API usage in Sage SDK

```typescript
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }],
});

const response = await fetchWithPayment(agentEndpoint, { method: 'POST', body });
```

## Rejected alternatives

- **`x402-fetch` (v1.x)** — legacy, deprecated in favor of `@x402/*` v2.
- **Custom x402 client** — unnecessary given official packages exist and are well-maintained.
- **`@coinbase/x402`** — Coinbase-scoped fork, less actively maintained than `@x402/*`.
