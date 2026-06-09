import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  awaitUserDecision,
  resolveUserDecision,
  hasPendingDecision,
  DEFAULT_PAUSE_TIMEOUT_MS,
  __testing,
} from '../../src/parent/run-registry.js';

describe('run-registry', () => {
  beforeEach(() => {
    __testing.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __testing.clear();
  });

  it('resolves the pending decision with retry action', async () => {
    const p = awaitUserDecision('run-1', 2, 'dispute-retry');
    expect(hasPendingDecision('run-1')).toBe(true);

    const status = resolveUserDecision('run-1', 2, { kind: 'retry' });
    expect(status).toBe('ok');
    expect(hasPendingDecision('run-1')).toBe(false);

    await expect(p).resolves.toEqual({ kind: 'retry' });
  });

  it('resolves with retry + newExecutor', async () => {
    const p = awaitUserDecision('run-2', 3, 'dispute-retry');
    const newExec = '0xa61b00000000000000000000000000000000001c' as const;
    resolveUserDecision('run-2', 3, { kind: 'retry', newExecutor: newExec });
    await expect(p).resolves.toEqual({ kind: 'retry', newExecutor: newExec });
  });

  it('resolves with cancel', async () => {
    const p = awaitUserDecision('run-3', 1, 'dispute-retry');
    resolveUserDecision('run-3', 1, { kind: 'cancel' });
    await expect(p).resolves.toEqual({ kind: 'cancel' });
  });

  it('returns "not-found" when no pause exists for the runId', () => {
    expect(resolveUserDecision('nope', 1, { kind: 'cancel' })).toBe('not-found');
  });

  it('returns "sub-mismatch" when subId does not match the paused one', async () => {
    const p = awaitUserDecision('run-4', 7, 'dispute-retry');
    const status = resolveUserDecision('run-4', 8, { kind: 'cancel' });
    expect(status).toBe('sub-mismatch');
    expect(hasPendingDecision('run-4')).toBe(true);
    // Cleanup so vitest doesn't hang on the pending promise.
    resolveUserDecision('run-4', 7, { kind: 'cancel' });
    await p;
  });

  it('resolves as timeout after DEFAULT_PAUSE_TIMEOUT_MS', async () => {
    const p = awaitUserDecision('run-5', 1, 'dispute-retry');
    await vi.advanceTimersByTimeAsync(DEFAULT_PAUSE_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual({ kind: 'timeout' });
    expect(hasPendingDecision('run-5')).toBe(false);
  });

  it('resolves as timeout after a custom timeoutMs', async () => {
    const p = awaitUserDecision('run-6', 1, 'dispute-retry', 5_000);
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(p).resolves.toEqual({ kind: 'timeout' });
  });

  it('a late resolve after timeout is a no-op', async () => {
    const p = awaitUserDecision('run-7', 1, 'dispute-retry', 5_000);
    await vi.advanceTimersByTimeAsync(5_001);
    await p;
    expect(resolveUserDecision('run-7', 1, { kind: 'retry' })).toBe('not-found');
  });

  it('throws when a second pause is opened for the same runId', () => {
    const p = awaitUserDecision('run-8', 1, 'dispute-retry');
    expect(() => awaitUserDecision('run-8', 2, 'dispute-retry')).toThrow(/already has a pending decision/);
    resolveUserDecision('run-8', 1, { kind: 'cancel' });
    return p;
  });

  it('cleanup clears in-flight pauses', () => {
    awaitUserDecision('run-9a', 1, 'dispute-retry');
    awaitUserDecision('run-9b', 1, 'dispute-retry');
    expect(__testing.size()).toBe(2);
    __testing.clear();
    expect(__testing.size()).toBe(0);
  });

  // Gate typing (code review 2026-06-09, finding H2): a decision kind aimed
  // at the other gate must be rejected and must leave the pause open.
  it('rejects cancel/retry aimed at a review gate with "wrong-gate"', async () => {
    const p = awaitUserDecision('run-10', 1, 'review');
    expect(resolveUserDecision('run-10', 1, { kind: 'cancel' })).toBe('wrong-gate');
    expect(resolveUserDecision('run-10', 1, { kind: 'retry' })).toBe('wrong-gate');
    // Pause is untouched and still resolvable by the right gate's kinds.
    expect(hasPendingDecision('run-10')).toBe(true);
    expect(resolveUserDecision('run-10', 1, { kind: 'approve' })).toBe('ok');
    await expect(p).resolves.toEqual({ kind: 'approve' });
  });

  it('rejects approve/dispute aimed at a dispute-retry gate with "wrong-gate"', async () => {
    const p = awaitUserDecision('run-11', 1, 'dispute-retry');
    expect(resolveUserDecision('run-11', 1, { kind: 'approve' })).toBe('wrong-gate');
    expect(resolveUserDecision('run-11', 1, { kind: 'dispute', reason: 'nope' })).toBe('wrong-gate');
    expect(hasPendingDecision('run-11')).toBe(true);
    expect(resolveUserDecision('run-11', 1, { kind: 'retry' })).toBe('ok');
    await expect(p).resolves.toEqual({ kind: 'retry' });
  });

  it('resolves approve and dispute on a review gate', async () => {
    const p1 = awaitUserDecision('run-12', 1, 'review');
    expect(resolveUserDecision('run-12', 1, { kind: 'dispute', reason: 'bad output' })).toBe('ok');
    await expect(p1).resolves.toEqual({ kind: 'dispute', reason: 'bad output' });
  });
});
