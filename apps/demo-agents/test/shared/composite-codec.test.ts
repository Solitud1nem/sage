import { describe, it, expect } from 'vitest';

import {
  decodeCompositeSpec,
  decodeCompositeEnvelope,
  materialFromEnvelope,
  COMPOSITE_PREFIX,
} from '../../src/shared/composite-codec.js';

function envelope(payload: unknown): string {
  return `${COMPOSITE_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

describe('decodeCompositeSpec — happy paths', () => {
  it('returns the inner spec when envelope is well-formed', () => {
    const uri = envelope({ parent: { run: 'r1', sub: 1 }, spec: 'translate this' });
    expect(decodeCompositeSpec(uri)).toBe('translate this');
  });

  it('survives unicode + url-encoded characters', () => {
    const uri = envelope({ parent: { run: 'r', sub: 2 }, spec: 'résumé this — emoji 🚀 OK' });
    expect(decodeCompositeSpec(uri)).toBe('résumé this — emoji 🚀 OK');
  });

  it('accepts arbitrary parent shape as long as field is present', () => {
    // The parent shape contract is enforced by parent-id-codec on encode;
    // decodeCompositeSpec only requires `parent` to be truthy.
    const uri = envelope({ parent: 'opaque', spec: 'do it' });
    expect(decodeCompositeSpec(uri)).toBe('do it');
  });
});

describe('decodeCompositeSpec — fall-through to null', () => {
  it('returns null for raw text (3-mode path)', () => {
    expect(decodeCompositeSpec('Some raw article content.')).toBeNull();
  });

  it('returns null for an unrelated data URI', () => {
    expect(decodeCompositeSpec('data:text/plain,hello')).toBeNull();
  });

  it('returns null for a URL', () => {
    expect(decodeCompositeSpec('https://example.com/article')).toBeNull();
  });

  it('returns null for malformed JSON inside the envelope', () => {
    expect(decodeCompositeSpec(`${COMPOSITE_PREFIX}{not-json`)).toBeNull();
  });

  it('returns null when spec field is missing', () => {
    const uri = envelope({ parent: { run: 'r', sub: 1 } });
    expect(decodeCompositeSpec(uri)).toBeNull();
  });

  it('returns null when parent field is missing', () => {
    const uri = envelope({ spec: 'orphan task' });
    expect(decodeCompositeSpec(uri)).toBeNull();
  });

  it('returns null when spec is not a string', () => {
    const uri = envelope({ parent: { run: 'r', sub: 1 }, spec: 42 });
    expect(decodeCompositeSpec(uri)).toBeNull();
  });

  it('returns null when payload is an array (not object)', () => {
    const uri = `${COMPOSITE_PREFIX}${encodeURIComponent('[1,2,3]')}`;
    expect(decodeCompositeSpec(uri)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeCompositeSpec('')).toBeNull();
  });

  it('returns null for envelope prefix only (empty payload)', () => {
    expect(decodeCompositeSpec(COMPOSITE_PREFIX)).toBeNull();
  });
});

describe('decodeCompositeEnvelope — content fields (ADR-0018)', () => {
  it('returns spec only for a legacy {parent, spec} envelope (back-compat)', () => {
    const uri = envelope({ parent: { run: 'r', sub: 1 }, spec: 'do it' });
    expect(decodeCompositeEnvelope(uri)).toEqual({ spec: 'do it' });
  });

  it('returns source when attached', () => {
    const uri = envelope({
      parent: { run: 'r', sub: 1 },
      spec: 'Translate to French',
      source: 'The quick brown fox.',
    });
    expect(decodeCompositeEnvelope(uri)).toEqual({
      spec: 'Translate to French',
      source: 'The quick brown fox.',
    });
  });

  it('returns inputs keyed by numeric sub id', () => {
    const uri = envelope({
      parent: { run: 'r', sub: 2 },
      spec: 'Summarize',
      inputs: { 1: 'Le renard brun rapide.' },
    });
    expect(decodeCompositeEnvelope(uri)).toEqual({
      spec: 'Summarize',
      inputs: { 1: 'Le renard brun rapide.' },
    });
  });

  it('drops malformed inputs entries but keeps the decode', () => {
    const uri = envelope({
      parent: { run: 'r', sub: 2 },
      spec: 'Summarize',
      inputs: { 1: 'ok', 0: 'bad-key', 2: 99, abc: 'bad-key' },
    });
    expect(decodeCompositeEnvelope(uri)).toEqual({ spec: 'Summarize', inputs: { 1: 'ok' } });
  });

  it('omits inputs entirely when it has no valid entries', () => {
    const uri = envelope({ parent: { run: 'r', sub: 1 }, spec: 'x', inputs: {} });
    expect(decodeCompositeEnvelope(uri)).toEqual({ spec: 'x' });
  });

  it('returns null for raw text (3-mode path)', () => {
    expect(decodeCompositeEnvelope('Some raw article content.')).toBeNull();
  });
});

describe('materialFromEnvelope — ADR-0018 material convention', () => {
  it('prefers inputs (dependent sub-task) over source', () => {
    const env = { spec: 'Summarize', source: 'original', inputs: { 1: 'upstream result' } };
    expect(materialFromEnvelope(env)).toBe('upstream result');
  });

  it('concatenates multiple inputs in ascending sub-id order', () => {
    const env = { spec: 'Merge', inputs: { 2: 'second', 1: 'first', 10: 'third' } };
    expect(materialFromEnvelope(env)).toBe('first\n\nsecond\n\nthird');
  });

  it('falls back to source for a root sub-task', () => {
    expect(materialFromEnvelope({ spec: 'Translate', source: 'hello' })).toBe('hello');
  });

  it('returns null when neither inputs nor source present (spec-only)', () => {
    expect(materialFromEnvelope({ spec: 'self-contained instruction' })).toBeNull();
  });

  it('returns null when source is an empty string', () => {
    expect(materialFromEnvelope({ spec: 'x', source: '' })).toBeNull();
  });
});

describe('decodeCompositeSpec — interop with parent-id-codec encoder', () => {
  it('decodes what parent-id-codec encodes (cross-module compatibility check)', async () => {
    // Importing the parent encoder lazily keeps the worker bundle independent
    // by default; this test specifically asserts the format stays in sync.
    const { encodeParentId } = await import('../../src/parent/parent-id-codec.js');
    const uri = encodeParentId({ run: 'plan-run-7', sub: 3 }, 'execute this composite step');
    expect(decodeCompositeSpec(uri)).toBe('execute this composite step');
  });
});
