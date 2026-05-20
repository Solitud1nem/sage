/**
 * @sage/adapter-arc — Arc adapter for Sage protocol.
 *
 * Status: scaffold (M11 / 2026-05-21). The package implements the
 * `ChainAdapter` interface from `@sage/core` so consumers can hold a
 * reference to "the Arc adapter" and the type system treats it
 * identically to `@sage/adapter-evm`. Every operation throws
 * `NotImplementedError` with an explicit pointer to ADR-0014 — there
 * are no silent stubs, no mock RPC, and no fake transaction hashes
 * masquerading as real ones.
 *
 * Why scaffold-only:
 * - Arc is testnet-only at time of writing (2026-05-21); mainnet is
 *   "expected 2026" with no published date.
 * - ERC-8183 (Job composability) and ERC-8004 (Agent identity) are the
 *   intended underlying primitives, but their canonical deployed
 *   addresses on Arc testnet have not been confirmed to a degree we
 *   are willing to bake into the SDK.
 * - The CreateX deployment matrix on Arc is not yet published per
 *   `docs/market/chain-expansion-recon-2026-05-13.md`; the same-address
 *   strategy from ADR-0001 cannot be assumed.
 *
 * Real implementation lands when:
 * - Arc testnet RPC + chainId are stable and documented.
 * - ERC-8183 / ERC-8004 reference contracts on Arc testnet have
 *   addresses we trust to wire against.
 * - A test wallet on Arc testnet can roundtrip a Job lifecycle.
 *
 * Until then, `createSageArcClient()` returns a fully-typed
 * `ChainAdapter` whose every entry point throws. This is a *structural*
 * commitment to multi-chain Sage — visible in the SDK surface, in the
 * dependency graph, and in the architecture page — without pretending
 * to settle work that the substrate does not yet support.
 *
 * See: ADR-0014 (`docs/adr/0014-arc-adapter-native-erc-8183.md`) and
 * `docs/research/observable-decomposition.md` §4 for the angle this
 * adapter is meant to extend.
 */

import type {
  AgentClient,
  AgentId,
  AgentRecord,
  ChainAdapter,
  ChainInfo,
  ListAgentsOptions,
  ListAgentsResult,
  TaskClient,
  TaskId,
  TaskRecord,
  TaskSpec,
} from '@sage/core';

import { ARC_TESTNET_CHAIN_INFO } from './chain.js';

export { ARC_TESTNET_CHAIN_INFO } from './chain.js';

/**
 * Thrown by every operation in the Arc adapter scaffold. The message
 * includes the operation name and a pointer to ADR-0014 so callers can
 * see *why* the call failed and *where* to track the work that unblocks
 * it.
 *
 * This is intentionally distinct from a generic `Error`: callers that
 * want to gate UI on "Arc adapter is pending" can `instanceof`-check
 * for `NotImplementedError` without conflating it with RPC failures,
 * validation errors, or chain mismatches.
 */
export class NotImplementedError extends Error {
  /** The operation that was attempted (e.g. `'tasks.createTask'`). */
  public readonly operation: string;

  constructor(operation: string) {
    super(
      `[@sage/adapter-arc] '${operation}' is not implemented. ` +
        `Arc adapter is currently a scaffold; real implementation is ` +
        `pending Arc testnet RPC availability and ERC-8183/8004 contract ` +
        `address confirmation. See ADR-0014 ` +
        `(docs/adr/0014-arc-adapter-native-erc-8183.md) for status and ` +
        `the conditions that unblock concrete implementation.`,
    );
    this.name = 'NotImplementedError';
    this.operation = operation;
  }
}

function notImplementedAsync<T>(operation: string): Promise<T> {
  return Promise.reject(new NotImplementedError(operation));
}

/**
 * Construct an Arc-flavoured `ChainAdapter`. The returned object is
 * fully typed against `@sage/core` interfaces; every method throws
 * `NotImplementedError`. The shape exists so multi-chain code paths
 * (`@sage/adapter-arc` swapped in for `@sage/adapter-evm`) compile
 * today and surface a clear failure mode at runtime.
 *
 * No constructor arguments yet — once concrete wiring lands the
 * signature will mirror `createSageClient` from `@sage/adapter-evm`
 * (chain config + publicClient + walletClient bundle). Adding it now
 * would bake assumptions about the eventual primitive (viem on Arc?
 * a different SDK?) that we are deliberately not pre-committing to.
 */
export function createSageArcClient(): ChainAdapter {
  const chain: ChainInfo = ARC_TESTNET_CHAIN_INFO;

  const agents: AgentClient = {
    registerAgent: (_params: { endpoint: string }): Promise<string> =>
      notImplementedAsync('agents.registerAgent'),
    updateProfile: (_params: { endpoint: string }): Promise<string> =>
      notImplementedAsync('agents.updateProfile'),
    pauseAgent: (): Promise<string> =>
      notImplementedAsync('agents.pauseAgent'),
    resumeAgent: (): Promise<string> =>
      notImplementedAsync('agents.resumeAgent'),
    getAgent: (_id: AgentId): Promise<AgentRecord | null> =>
      notImplementedAsync('agents.getAgent'),
    listAgents: (_options: ListAgentsOptions): Promise<ListAgentsResult> =>
      notImplementedAsync('agents.listAgents'),
  };

  const tasks: TaskClient = {
    createTask: (_spec: TaskSpec): Promise<TaskId> =>
      notImplementedAsync('tasks.createTask'),
    acceptTask: (_taskId: TaskId): Promise<string> =>
      notImplementedAsync('tasks.acceptTask'),
    completeTask: (_taskId: TaskId, _resultUri: string): Promise<string> =>
      notImplementedAsync('tasks.completeTask'),
    approvePayment: (_taskId: TaskId): Promise<string> =>
      notImplementedAsync('tasks.approvePayment'),
    disputeTask: (_taskId: TaskId, _reason: string): Promise<string> =>
      notImplementedAsync('tasks.disputeTask'),
    refundExpired: (_taskId: TaskId): Promise<string> =>
      notImplementedAsync('tasks.refundExpired'),
    claimAutoRelease: (_taskId: TaskId): Promise<string> =>
      notImplementedAsync('tasks.claimAutoRelease'),
    getTask: (_taskId: TaskId): Promise<TaskRecord | null> =>
      notImplementedAsync('tasks.getTask'),
  };

  return { chain, agents, tasks };
}
