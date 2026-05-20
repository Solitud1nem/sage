/**
 * Arc chain info for Sage adapter.
 *
 * Status: scaffold. Arc is Circle's L1 for stablecoin finance, currently
 * testnet-only with mainnet "expected 2026" (no published date as of
 * 2026-05-21). The placeholders below are conservative — they get
 * concrete values when Arc publishes a stable testnet endpoint, chainId,
 * and block explorer URL.
 *
 * Why the values are what they are:
 * - `chainId: '0'` — TBD. arc.network has not published a stable
 *   testnet chainId at time of writing; replace with the canonical
 *   numeric chainId (as a string per `ChainInfo` typing) when
 *   announced.
 * - `name: 'Arc'` — confirmed via Circle's introductory post and the
 *   arc.network landing page (see ADR-0014 references).
 * - `explorerUrl: 'https://testnet.arcscan.app'` — placeholder per
 *   arc.io docs references seen at the time of writing; verify against
 *   arc.network's authoritative docs once the testnet block explorer
 *   is publicly reachable and stable.
 *
 * Once these are confirmed and a real adapter implementation lands,
 * this file becomes the single edit point; the adapter shell
 * (`createSageArcClient` in `index.ts`) does not bake in any of them.
 */

import type { ChainInfo } from '@sage/core';

export const ARC_TESTNET_CHAIN_INFO: ChainInfo = {
  chainId: '0',
  name: 'Arc',
  explorerUrl: 'https://testnet.arcscan.app',
};
