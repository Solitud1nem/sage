/**
 * Capability → handler map for the generic worker.
 *
 * A handler is the pure "do the work" part of an identity: it receives the
 * decoded job (instruction + optional material, per the ADR-0018 envelope
 * convention) and returns the result string that will be submitted via
 * `completeTask`. Everything on-chain (accept / complete / guards / retries)
 * lives in `executor.ts`; handlers stay testable without any chain mocks.
 *
 * M12.1+ pipeline capabilities (copywriter / builder / packager, …) register
 * here alongside their `IDENTITY_TABLE` entries. Boot fails fast when a
 * hosted identity's capability has no handler — see `server.ts`.
 */

import { echoHandler } from './echo.js';

export interface WorkerJob {
  /** The instruction — envelope `spec`, or the raw specUri on the legacy path. */
  readonly spec: string;
  /** Material to apply the instruction to (envelope inputs/source), if any. */
  readonly material: string | null;
}

export interface HandlerContext {
  readonly identityId: string;
  readonly capability: string;
  readonly openaiApiKey: string | undefined;
}

export type CapabilityHandler = (job: WorkerJob, ctx: HandlerContext) => Promise<string>;

export const HANDLERS: Readonly<Record<string, CapabilityHandler>> = {
  echo: echoHandler,
};
