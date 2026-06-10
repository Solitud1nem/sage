/**
 * Placeholder handler for the generic-worker каркас (M12.0.2).
 *
 * Exists so the framework is dispatchable end-to-end (unit tests, local smoke
 * runs) before the first real pipeline capability lands in M12.1. Never
 * registered in AgentRegistryV2, so no classifier-routed task reaches it.
 */

import type { CapabilityHandler } from './index.js';

export const echoHandler: CapabilityHandler = (job) => {
  const head = `ECHO: ${job.spec}`;
  return Promise.resolve(
    job.material !== null ? `${head}\n\nMATERIAL (${job.material.length} chars)` : head,
  );
};
