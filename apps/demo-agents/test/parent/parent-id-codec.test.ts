import { describe, it, expect } from 'vitest';
import {
  encodeParentId,
  decodeParentId,
  decodeSpec,
  decodeEnvelope,
} from '../../src/parent/parent-id-codec.js';

describe('encodeParentId', () => {
  it('produces a data:application/json URI', () => {
    const uri = encodeParentId({ run: 'r1', sub: 2 }, 'do the thing');
    expect(uri.startsWith('data:application/json,')).toBe(true);
  });

  it('throws on non-positive sub', () => {
    expect(() => encodeParentId({ run: 'r1', sub: 0 }, 'x')).toThrow(/sub/);
    expect(() => encodeParentId({ run: 'r1', sub: -1 }, 'x')).toThrow(/sub/);
    expect(() => encodeParentId({ run: 'r1', sub: 1.5 }, 'x')).toThrow(/sub/);
  });

  it('throws on empty run', () => {
    expect(() => encodeParentId({ run: '', sub: 1 }, 'x')).toThrow(/run/);
  });

  it('encodes special characters in spec safely', () => {
    const spec = 'translate "Hello, world!"\nЛишь пара строк — and \u{1F600}';
    const uri = encodeParentId({ run: 'r1', sub: 1 }, spec);
    expect(decodeSpec(uri)).toBe(spec);
  });
});

describe('decodeParentId', () => {
  it('round-trips encoded payloads', () => {
    const uri = encodeParentId({ run: 'run-abc-123', sub: 7 }, 'whatever');
    expect(decodeParentId(uri)).toEqual({ run: 'run-abc-123', sub: 7 });
  });

  it('returns null for non-data URIs', () => {
    expect(decodeParentId('https://example.com/spec.json')).toBeNull();
    expect(decodeParentId('ipfs://Qm…')).toBeNull();
    expect(decodeParentId('plain text spec')).toBeNull();
  });

  it('returns null for data: URIs with the wrong mediatype', () => {
    expect(decodeParentId('data:text/plain,hello')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(decodeParentId('data:application/json,not-json')).toBeNull();
    expect(decodeParentId('data:application/json,{not:valid}')).toBeNull();
  });

  it('returns null when parent field is missing', () => {
    const uri = `data:application/json,${encodeURIComponent(JSON.stringify({ spec: 'hi' }))}`;
    expect(decodeParentId(uri)).toBeNull();
  });

  it('returns null when parent.run is not a non-empty string', () => {
    const noRun = `data:application/json,${encodeURIComponent(
      JSON.stringify({ parent: { sub: 1 }, spec: 'hi' }),
    )}`;
    const emptyRun = `data:application/json,${encodeURIComponent(
      JSON.stringify({ parent: { run: '', sub: 1 }, spec: 'hi' }),
    )}`;
    expect(decodeParentId(noRun)).toBeNull();
    expect(decodeParentId(emptyRun)).toBeNull();
  });

  it('returns null when parent.sub is not a positive integer', () => {
    const cases = [{ sub: 0 }, { sub: -1 }, { sub: 1.5 }, { sub: '1' }, { /* missing */ }];
    for (const partial of cases) {
      const uri = `data:application/json,${encodeURIComponent(
        JSON.stringify({ parent: { run: 'r', ...partial }, spec: 'hi' }),
      )}`;
      expect(decodeParentId(uri)).toBeNull();
    }
  });

  it('returns null when spec is missing or wrong type', () => {
    const noSpec = `data:application/json,${encodeURIComponent(
      JSON.stringify({ parent: { run: 'r', sub: 1 } }),
    )}`;
    const numericSpec = `data:application/json,${encodeURIComponent(
      JSON.stringify({ parent: { run: 'r', sub: 1 }, spec: 42 }),
    )}`;
    expect(decodeParentId(noSpec)).toBeNull();
    expect(decodeParentId(numericSpec)).toBeNull();
  });

  it('returns null on malformed percent-encoding', () => {
    expect(decodeParentId('data:application/json,%E0%A4%A')).toBeNull();
  });
});

describe('decodeSpec', () => {
  it('returns the spec text from a valid envelope', () => {
    const uri = encodeParentId({ run: 'r', sub: 3 }, 'summarize this');
    expect(decodeSpec(uri)).toBe('summarize this');
  });

  it('returns null for invalid envelopes', () => {
    expect(decodeSpec('data:text/plain,hi')).toBeNull();
    expect(decodeSpec('plain spec without wrapper')).toBeNull();
  });

  it('preserves empty-string spec', () => {
    const uri = encodeParentId({ run: 'r', sub: 1 }, '');
    expect(decodeSpec(uri)).toBe('');
  });
});

describe('format inspection', () => {
  it('encoded URI decodes to the documented JSON shape', () => {
    const uri = encodeParentId({ run: 'run-x', sub: 4 }, 'do work');
    const json = decodeURIComponent(uri.slice('data:application/json,'.length));
    expect(JSON.parse(json)).toEqual({
      parent: { run: 'run-x', sub: 4 },
      spec: 'do work',
    });
  });

  it('omits source/inputs keys entirely when no content is passed (back-compat wire format)', () => {
    const uri = encodeParentId({ run: 'r', sub: 1 }, 'instruction');
    const obj = JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
    expect(Object.keys(obj).sort()).toEqual(['parent', 'spec']);
  });
});

describe('content envelope (ADR-0018)', () => {
  it('round-trips source through encode → decodeEnvelope', () => {
    const uri = encodeParentId({ run: 'r', sub: 1 }, 'Translate to French', {
      source: 'The quick brown fox.',
    });
    expect(decodeEnvelope(uri)).toEqual({
      parent: { run: 'r', sub: 1 },
      spec: 'Translate to French',
      source: 'The quick brown fox.',
    });
  });

  it('round-trips inputs (numeric keys) through encode → decodeEnvelope', () => {
    const uri = encodeParentId({ run: 'r', sub: 2 }, 'Summarize', {
      inputs: { 1: 'Le renard brun rapide.' },
    });
    expect(decodeEnvelope(uri)).toEqual({
      parent: { run: 'r', sub: 2 },
      spec: 'Summarize',
      inputs: { 1: 'Le renard brun rapide.' },
    });
  });

  it('drops an empty inputs object on encode', () => {
    const uri = encodeParentId({ run: 'r', sub: 1 }, 'x', { inputs: {} });
    const obj = JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
    expect('inputs' in obj).toBe(false);
  });

  it('decodeEnvelope returns spec-only for a legacy envelope', () => {
    const uri = encodeParentId({ run: 'r', sub: 1 }, 'legacy');
    expect(decodeEnvelope(uri)).toEqual({ parent: { run: 'r', sub: 1 }, spec: 'legacy' });
  });

  it('decodeSpec / decodeParentId stay unchanged when content is present', () => {
    const uri = encodeParentId({ run: 'r', sub: 3 }, 'Translate', {
      source: 'hello',
      inputs: { 1: 'world' },
    });
    expect(decodeSpec(uri)).toBe('Translate');
    expect(decodeParentId(uri)).toEqual({ run: 'r', sub: 3 });
  });

  it('decodeEnvelope returns null for raw text', () => {
    expect(decodeEnvelope('plain raw content')).toBeNull();
  });
});
