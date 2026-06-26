import { describe, it, expect } from 'vitest';
import {
  encodeAgentManifest,
  parseAgentManifest,
  validateAgentManifest,
  type AgentManifest,
} from '../src/index.js';

const VALID: AgentManifest = {
  version: 1,
  operator: { name: 'Sage', contact: 'https://sage-protocol.pages.dev', pseudonymous: false },
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6', zeroRetention: true, noTraining: true },
  dataHandling: { retentionDays: 0, secondaryUse: false, subProcessors: ['Anthropic'] },
};

describe('agent manifest — encode/parse round-trip', () => {
  it('round-trips a valid manifest through the data URI', () => {
    const uri = encodeAgentManifest(VALID);
    expect(uri.startsWith('data:application/json,')).toBe(true);
    expect(parseAgentManifest(uri)).toEqual(VALID);
  });

  it('round-trips a minimal manifest (no optional operator fields)', () => {
    const m: AgentManifest = {
      version: 1,
      operator: { name: 'op' },
      model: { provider: 'self-hosted', model: 'llama-3', zeroRetention: true, noTraining: true },
      dataHandling: { retentionDays: 7, secondaryUse: false, subProcessors: [] },
    };
    expect(parseAgentManifest(encodeAgentManifest(m))).toEqual(m);
  });
});

describe('parseAgentManifest — rejects non-manifest profileUris', () => {
  it('returns null for empty / hosted / non-manifest URIs', () => {
    expect(parseAgentManifest('')).toBeNull();
    expect(parseAgentManifest('https://example.com/profile.json')).toBeNull();
    expect(parseAgentManifest('ipfs://Qm…')).toBeNull();
    expect(parseAgentManifest('data:application/json,not%20json')).toBeNull();
  });
});

describe('validateAgentManifest — strict field validation', () => {
  const base = () => JSON.parse(JSON.stringify(VALID)) as Record<string, unknown>;

  it('accepts the canonical manifest', () => {
    expect(validateAgentManifest(VALID)).toEqual(VALID);
  });

  it('rejects a wrong/absent version', () => {
    expect(validateAgentManifest({ ...base(), version: 2 })).toBeNull();
    expect(validateAgentManifest({ ...base(), version: undefined })).toBeNull();
  });

  it('rejects a missing or empty operator name', () => {
    expect(validateAgentManifest({ ...base(), operator: { name: '' } })).toBeNull();
    expect(validateAgentManifest({ ...base(), operator: {} })).toBeNull();
  });

  it('rejects an unknown provider', () => {
    const m = base();
    (m['model'] as Record<string, unknown>)['provider'] = 'gemini';
    expect(validateAgentManifest(m)).toBeNull();
  });

  it('rejects non-boolean privacy flags', () => {
    const m = base();
    (m['model'] as Record<string, unknown>)['zeroRetention'] = 'yes';
    expect(validateAgentManifest(m)).toBeNull();
  });

  it('rejects negative or non-numeric retention', () => {
    const neg = base();
    (neg['dataHandling'] as Record<string, unknown>)['retentionDays'] = -1;
    expect(validateAgentManifest(neg)).toBeNull();
    const nan = base();
    (nan['dataHandling'] as Record<string, unknown>)['retentionDays'] = 'forever';
    expect(validateAgentManifest(nan)).toBeNull();
  });

  it('rejects non-string sub-processors', () => {
    const m = base();
    (m['dataHandling'] as Record<string, unknown>)['subProcessors'] = ['Anthropic', 42];
    expect(validateAgentManifest(m)).toBeNull();
  });

  it('drops unknown extra fields rather than rejecting', () => {
    const m = { ...base(), surprise: 'extra' };
    const parsed = validateAgentManifest(m);
    expect(parsed).toEqual(VALID);
    expect(parsed && 'surprise' in parsed).toBe(false);
  });
});
