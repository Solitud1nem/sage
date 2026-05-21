import { describe, it, expect } from 'vitest';

import {
  createSageArcClient,
  NotImplementedError,
  ARC_TESTNET_CHAIN_INFO,
} from '../src/index.js';
import { agentId, taskId } from '@sage/core';

/**
 * Conformance tests for the Arc adapter scaffold.
 *
 * These do not exercise any Arc network — Arc testnet is not yet stable
 * and ERC-8183/8004 reference addresses are not confirmed. Instead, they
 * assert the structural contract:
 *
 *   1. `createSageArcClient()` returns an object conforming to
 *      `ChainAdapter` (chain + agents + tasks slots).
 *   2. Every operation throws `NotImplementedError` whose message
 *      mentions the operation name and points at ADR-0014.
 *
 * When the real adapter lands, these tests get replaced with operation
 * roundtrip tests against Arc testnet.
 */

describe('@sage/adapter-arc — scaffold conformance', () => {
  const adapter = createSageArcClient();

  it('returns a ChainInfo with Arc name + confirmed chainId', () => {
    expect(adapter.chain).toEqual(ARC_TESTNET_CHAIN_INFO);
    expect(adapter.chain.name).toBe('Arc');
    // Arc testnet chainId confirmed via docs.arc.io on 2026-05-21.
    expect(adapter.chain.chainId).toBe('5042002');
    expect(adapter.chain.explorerUrl).toBe('https://testnet.arcscan.app');
  });

  it('exposes an `agents` slot with every AgentClient method', () => {
    const a = adapter.agents;
    expect(typeof a.registerAgent).toBe('function');
    expect(typeof a.updateProfile).toBe('function');
    expect(typeof a.pauseAgent).toBe('function');
    expect(typeof a.resumeAgent).toBe('function');
    expect(typeof a.getAgent).toBe('function');
    expect(typeof a.listAgents).toBe('function');
  });

  it('exposes a `tasks` slot with every TaskClient method', () => {
    const t = adapter.tasks;
    expect(typeof t.createTask).toBe('function');
    expect(typeof t.acceptTask).toBe('function');
    expect(typeof t.completeTask).toBe('function');
    expect(typeof t.approvePayment).toBe('function');
    expect(typeof t.disputeTask).toBe('function');
    expect(typeof t.refundExpired).toBe('function');
    expect(typeof t.claimAutoRelease).toBe('function');
    expect(typeof t.getTask).toBe('function');
  });
});

describe('@sage/adapter-arc — NotImplementedError on every operation', () => {
  const adapter = createSageArcClient();

  // Every operation: assert it rejects with NotImplementedError whose
  // `operation` field matches the dotted path the user would see in a
  // stack trace.
  const ops: ReadonlyArray<{ name: string; run: () => Promise<unknown> }> = [
    { name: 'agents.registerAgent', run: () => adapter.agents.registerAgent({ endpoint: 'https://x' }) },
    { name: 'agents.updateProfile', run: () => adapter.agents.updateProfile({ endpoint: 'https://x' }) },
    { name: 'agents.pauseAgent', run: () => adapter.agents.pauseAgent() },
    { name: 'agents.resumeAgent', run: () => adapter.agents.resumeAgent() },
    { name: 'agents.getAgent', run: () => adapter.agents.getAgent(agentId('0x0000000000000000000000000000000000000000')) },
    { name: 'agents.listAgents', run: () => adapter.agents.listAgents({ cursor: 0, limit: 10 }) },
    { name: 'tasks.createTask', run: () => adapter.tasks.createTask({ executor: agentId('0x0000000000000000000000000000000000000000'), deadline: 0, amount: 0n, specUri: '' }) },
    { name: 'tasks.acceptTask', run: () => adapter.tasks.acceptTask(taskId('1')) },
    { name: 'tasks.completeTask', run: () => adapter.tasks.completeTask(taskId('1'), '') },
    { name: 'tasks.approvePayment', run: () => adapter.tasks.approvePayment(taskId('1')) },
    { name: 'tasks.disputeTask', run: () => adapter.tasks.disputeTask(taskId('1'), 'r') },
    { name: 'tasks.refundExpired', run: () => adapter.tasks.refundExpired(taskId('1')) },
    { name: 'tasks.claimAutoRelease', run: () => adapter.tasks.claimAutoRelease(taskId('1')) },
    { name: 'tasks.getTask', run: () => adapter.tasks.getTask(taskId('1')) },
  ];

  for (const { name, run } of ops) {
    it(`${name} rejects with NotImplementedError`, async () => {
      await expect(run()).rejects.toBeInstanceOf(NotImplementedError);
      try {
        await run();
      } catch (err) {
        expect(err).toBeInstanceOf(NotImplementedError);
        const e = err as NotImplementedError;
        expect(e.operation).toBe(name);
        expect(e.message).toContain(name);
        expect(e.message).toContain('ADR-0014');
        expect(e.message).toContain('@sage/adapter-arc');
      }
    });
  }
});
