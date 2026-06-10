import { describe, it, expect } from 'vitest';

import {
  loadIdentities,
  privateKeyEnvName,
  IDENTITY_TABLE,
  type IdentityConfig,
} from '../../src/worker/identities.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const TABLE: readonly IdentityConfig[] = [
  { id: 'echo', capability: 'echo', priceUnits: 10_000n },
  { id: 'fact-checker', capability: 'fact-check', priceUnits: 50_000n },
];

describe('privateKeyEnvName', () => {
  it('upper-cases and converts dashes to underscores', () => {
    expect(privateKeyEnvName('echo')).toBe('ECHO_PRIVATE_KEY');
    expect(privateKeyEnvName('fact-checker')).toBe('FACT_CHECKER_PRIVATE_KEY');
  });
});

describe('loadIdentities', () => {
  it('selects the WORKER_IDENTITIES subset and binds keys', () => {
    const loaded = loadIdentities(
      { WORKER_IDENTITIES: 'echo', ECHO_PRIVATE_KEY: KEY },
      TABLE,
    );
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: 'echo', capability: 'echo', privateKey: KEY });
  });

  it('hosts the full table when WORKER_IDENTITIES is absent', () => {
    const loaded = loadIdentities(
      { ECHO_PRIVATE_KEY: KEY, FACT_CHECKER_PRIVATE_KEY: KEY },
      TABLE,
    );
    expect(loaded.map((l) => l.id)).toEqual(['echo', 'fact-checker']);
  });

  it('tolerates whitespace and empty segments in the csv', () => {
    const loaded = loadIdentities(
      { WORKER_IDENTITIES: ' echo , ,fact-checker', ECHO_PRIVATE_KEY: KEY, FACT_CHECKER_PRIVATE_KEY: KEY },
      TABLE,
    );
    expect(loaded.map((l) => l.id)).toEqual(['echo', 'fact-checker']);
  });

  it('throws on an unknown identity id (a typo must not silently drop one)', () => {
    expect(() =>
      loadIdentities({ WORKER_IDENTITIES: 'ekho', ECHO_PRIVATE_KEY: KEY }, TABLE),
    ).toThrow(/unknown identity "ekho"/);
  });

  it('fails fast naming the missing env var', () => {
    expect(() => loadIdentities({ WORKER_IDENTITIES: 'fact-checker' }, TABLE)).toThrow(
      /FACT_CHECKER_PRIVATE_KEY is not set/,
    );
  });

  it('throws when nothing is selectable', () => {
    expect(() => loadIdentities({}, [])).toThrow(/No identities selected/);
  });

  it('default table ships the каркас echo placeholder', () => {
    expect(IDENTITY_TABLE.some((t) => t.id === 'echo')).toBe(true);
  });
});
