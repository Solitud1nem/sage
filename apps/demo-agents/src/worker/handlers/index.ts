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

import type { ArtifactStore } from '../artifacts.js';
import { echoHandler } from './echo.js';
import { copywriterHandler } from './copywriter.js';
import { builderHandler } from './builder.js';
import { packagerHandler } from './packager.js';
import { qaWebsiteHandler } from './qa-website.js';

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
  /**
   * Anthropic key (M12.1.6): frontier handlers (builder → Opus, copywriter /
   * qa-judge → Sonnet) prefer it; absent → graceful OpenAI fallback.
   */
  readonly anthropicApiKey?: string | undefined;
  /**
   * R2-backed artifact store (M12.0.3/M12.1.1). Absent when the worker env
   * lacks a gateway URL or backend key — handlers that need it throw, which
   * surfaces as an honest `Task failed` instead of a silent wrong path.
   */
  readonly artifacts?: ArtifactStore;
}

export type CapabilityHandler = (job: WorkerJob, ctx: HandlerContext) => Promise<string>;

export const HANDLERS: Readonly<Record<string, CapabilityHandler>> = {
  echo: echoHandler,
  copywrite: copywriterHandler,
  'build-website': builderHandler,
  'package-archive': packagerHandler,
  'qa-website': qaWebsiteHandler,
};
