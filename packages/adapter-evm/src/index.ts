/**
 * @sage/adapter-evm — EVM adapter for Sage protocol.
 *
 * Implements @sage/core interfaces using viem for all EVM-compatible chains.
 * Primary chain: Base (chain ID 8453).
 */

// Re-export core types for convenience
export { SAGE_PROTOCOL_VERSION } from '@sage/core';
export type {
  AgentId,
  AgentRecord,
  AgentRecordV2,
  AgentProfile,
  RegistryCapability,
  TaskId,
  TaskRecord,
  TaskSpec,
  DisputeOutcome,
  AgentClient,
  AgentClientV2,
  TaskClient,
  TaskClientV2,
  ChainAdapter,
} from '@sage/core';

// TaskStatus is a runtime enum (value), not just a type — re-export it as a
// value so `import { TaskStatus } from '@sage/adapter-evm'` works for callers
// that compare against it (previously type-only → broke value imports).
export { TaskStatus } from '@sage/core';

// Client
export { createSageClient } from './client.js';
export type { CreateSageClientOptions, SageClient } from './client.js';

// Chain configs
export { base, baseSepolia } from './chains/base.js';
export { arcTestnet } from './chains/arc.js';
export type { ChainConfig } from './chains/base.js';

// x402 pay-per-call
export { createX402Client } from './x402.js';
export type { X402Client, CallAgentOptions, CallAgentResult } from './x402.js';

// Direct payment escape-hatch
export { createPayDirectClient } from './pay-direct.js';
export type { PayDirectClient, PayDirectParams } from './pay-direct.js';

// Events
export { createEventSubscriptions } from './events.js';
export type { SageEventSubscriptions, UnwatchFn, EventSubscriptionOptions } from './events.js';

// ABIs (for advanced usage)
export { agentRegistryAbi, agentRegistryV2Abi, taskEscrowAbi, taskEscrowV2Abi } from './abi/index.js';

// V2 task-escrow client (ADR-0017 arbitration layer)
export { createTaskEscrowV2Client } from './task-escrow-v2.js';

// V2 agent-registry client (M11.2 platform layer)
export { createAgentRegistryV2Client, listActiveAgentsV2 } from './agent-registry-v2.js';
