import { describe, it, expect } from 'vitest';
import { SAGE_PROTOCOL_VERSION } from '../src/index.js';

describe('@sage/adapter-evm', () => {
  it('re-exports core protocol version', () => {
    expect(SAGE_PROTOCOL_VERSION).toBe('2.0.0');
  });
});
