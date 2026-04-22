import { describe, it, expect } from 'vitest';
import {
  SAGE_PROTOCOL_VERSION,
  agentId,
  taskId,
  capability,
  TaskStatus,
  PaymentMethod,
} from '../src/index.js';

describe('@sage/core', () => {
  it('exports protocol version', () => {
    expect(SAGE_PROTOCOL_VERSION).toBe('2.0.0');
  });
});

describe('branded types', () => {
  it('creates AgentId', () => {
    const id = agentId('0xAAA');
    expect(id).toBe('0xAAA');
  });

  it('creates TaskId', () => {
    const id = taskId('42');
    expect(id).toBe('42');
  });

  it('creates Capability', () => {
    const cap = capability('summarize');
    expect(cap).toBe('summarize');
  });
});

describe('TaskStatus enum', () => {
  it('has all lifecycle states', () => {
    expect(TaskStatus.Created).toBe('Created');
    expect(TaskStatus.Accepted).toBe('Accepted');
    expect(TaskStatus.Completed).toBe('Completed');
    expect(TaskStatus.Paid).toBe('Paid');
    expect(TaskStatus.Disputed).toBe('Disputed');
    expect(TaskStatus.Refunded).toBe('Refunded');
    expect(TaskStatus.Expired).toBe('Expired');
  });
});

describe('PaymentMethod enum', () => {
  it('has all payment methods', () => {
    expect(PaymentMethod.Escrow).toBe('Escrow');
    expect(PaymentMethod.X402).toBe('X402');
    expect(PaymentMethod.Direct).toBe('Direct');
  });
});
