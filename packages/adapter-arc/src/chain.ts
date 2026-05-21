/**
 * Arc chain info for Sage adapter.
 *
 * Status: scaffold reserved for the native-wrap path (ADR-0014). Today
 * Arc traffic flows through `@sage/adapter-evm` with the `arcTestnet`
 * chain config (ADR-0015 bridge). The values here mirror the bridge
 * config so when this package becomes active no metadata change is
 * needed — only the operations get implementation bodies.
 *
 * - `chainId: '5042002'` — confirmed via `docs.arc.io/arc/references/connect-to-arc`
 *   on 2026-05-21.
 * - `name: 'Arc'` — confirmed via Circle's introductory post and the
 *   arc.network landing page (see ADR-0014 references).
 * - `explorerUrl: 'https://testnet.arcscan.app'` — confirmed via
 *   `docs.arc.io`.
 *
 * When ERC-8183 / ERC-8004 reference contracts ship on Arc and this
 * package becomes the active client (ADR-0014 / ADR-0016), the chain
 * info here remains the single point of truth.
 */

import type { ChainInfo } from '@sage/core';

export const ARC_TESTNET_CHAIN_INFO: ChainInfo = {
  chainId: '5042002',
  name: 'Arc',
  explorerUrl: 'https://testnet.arcscan.app',
};
