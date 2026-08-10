import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertMoneyEnvForSettlement } from '../../src/shared/env.js';
import { formatUsdc } from '../../src/orchestrator/guards.js';

const MONEY_VARS = [
  'TASK_AMOUNT',
  'SPONSOR_MIN_BALANCE_USDC',
  'MAX_SUBTASK_UNITS',
  'MAX_PLAN_TOTAL_UNITS',
  'MAX_RUN_SPEND_UNITS',
  'QUARANTINE_MAX_UNITS',
  'FIRST_PARTY_AGENTS',
] as const;

const WMON = { symbol: 'WMON', decimals: 18 };

describe('assertMoneyEnvForSettlement (ADR-0026 fail-loud)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of MONEY_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of MONEY_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('no-ops for 6-decimal settlement (USDC posture) and for absent settlement', () => {
    expect(() => assertMoneyEnvForSettlement(undefined)).not.toThrow();
    expect(() => assertMoneyEnvForSettlement({ symbol: 'USDC', decimals: 6 })).not.toThrow();
  });

  it('throws listing every missing money var on an 18-decimal chain', () => {
    expect(() => assertMoneyEnvForSettlement(WMON)).toThrow(
      /TASK_AMOUNT.*SPONSOR_MIN_BALANCE_USDC.*MAX_SUBTASK_UNITS.*MAX_PLAN_TOTAL_UNITS.*MAX_RUN_SPEND_UNITS/s,
    );
  });

  it('passes when every money var is explicitly set', () => {
    process.env.TASK_AMOUNT = '500000000000000000';
    process.env.SPONSOR_MIN_BALANCE_USDC = '2000000000000000000';
    process.env.MAX_SUBTASK_UNITS = '25000000000000000000';
    process.env.MAX_PLAN_TOTAL_UNITS = '100000000000000000000';
    process.env.MAX_RUN_SPEND_UNITS = '150000000000000000000';
    expect(() => assertMoneyEnvForSettlement(WMON)).not.toThrow();
  });

  it('requires QUARANTINE_MAX_UNITS only when the foreign framework is armed', () => {
    process.env.TASK_AMOUNT = '1';
    process.env.SPONSOR_MIN_BALANCE_USDC = '1';
    process.env.MAX_SUBTASK_UNITS = '1';
    process.env.MAX_PLAN_TOTAL_UNITS = '1';
    process.env.MAX_RUN_SPEND_UNITS = '1';
    expect(() => assertMoneyEnvForSettlement(WMON)).not.toThrow();

    process.env.FIRST_PARTY_AGENTS = '0x6d8aca48c1e064e71078656f7fb946e52cd8376d';
    expect(() => assertMoneyEnvForSettlement(WMON)).toThrow(/QUARANTINE_MAX_UNITS/);
  });
});

describe('formatUsdc with settlement decimals', () => {
  it('keeps the 6-decimal default behavior', () => {
    expect(formatUsdc(5_000_000n)).toBe('5.000');
    expect(formatUsdc(1_500n)).toBe('0.001');
  });

  it('formats 18-decimal WMON base units', () => {
    expect(formatUsdc(2_000_000_000_000_000_000n, 18)).toBe('2.000');
    expect(formatUsdc(500_000_000_000_000_000n, 18)).toBe('0.500');
    // 6-decimal-sized dust on an 18-decimal chain renders as ~zero — the
    // exact silent failure the boot assert exists to prevent.
    expect(formatUsdc(5_000_000n, 18)).toBe('0.000');
  });
});
