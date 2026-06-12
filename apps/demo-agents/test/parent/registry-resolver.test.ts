import { describe, expect, it } from 'vitest';
import type { AgentRecordV2 } from '@sage/core';
import { agentId, capability } from '@sage/core';
import {
  capabilityNameForType,
  pickAgentForCapability,
  resolveExecutorFromRegistry,
} from '../../src/parent/registry-resolver.js';

function mkAgent(
  addr: string,
  caps: Array<{ name: string; price: bigint }>,
  opts: { active?: boolean } = {},
): AgentRecordV2 {
  return {
    id: agentId(addr),
    endpoint: 'on-chain://task-events',
    profileUri: '',
    capabilities: caps.map((c) => ({ name: capability(c.name), price: c.price })),
    registeredAt: 0,
    active: opts.active ?? true,
  };
}

const SUMMARIZER = '0x0DA5892C26222fF2992BEe22613d1f9C06a92593';
const TRANSLATOR = '0xa61bd5efa704805B08970C34Cd639fA5D6Ce1c8c';
const SENTIMENT = '0x5218857Ef2631e0AC35fA8062671785954e918B5';
const VISION = '0xB889a7aAe3F9a5DC1CAC68459bc5e3118D9863Fb';

describe('capabilityNameForType (stem buckets)', () => {
  it('maps translate variants to translate capability', () => {
    expect(capabilityNameForType('translate-text')).toBe('translate');
    expect(capabilityNameForType('translation')).toBe('translate');
    expect(capabilityNameForType('Translation')).toBe('translate'); // case-insensitive
  });

  it('maps vision/image variants to vision-describe', () => {
    expect(capabilityNameForType('image-description')).toBe('vision-describe');
    expect(capabilityNameForType('vision-describe')).toBe('vision-describe');
    expect(capabilityNameForType('describe-screenshot')).toBe('vision-describe');
    expect(capabilityNameForType('caption-image')).toBe('vision-describe');
  });

  it('maps sentiment/classify variants to sentiment-classify', () => {
    expect(capabilityNameForType('sentiment-classification')).toBe('sentiment-classify');
    expect(capabilityNameForType('classify-tone')).toBe('sentiment-classify');
    expect(capabilityNameForType('emotion-analysis')).toBe('sentiment-classify');
  });

  it('maps summarizer/generalist variants to summarize', () => {
    expect(capabilityNameForType('summarize-text')).toBe('summarize');
    expect(capabilityNameForType('summarization')).toBe('summarize');
    expect(capabilityNameForType('comparative-analysis')).toBe('summarize');
    expect(capabilityNameForType('research')).toBe('summarize');
    expect(capabilityNameForType('write-report')).toBe('summarize');
    expect(capabilityNameForType('plan-itinerary')).toBe('summarize');
  });

  it('maps website-pipeline variants to live capabilities (M12.1.5)', () => {
    expect(capabilityNameForType('content_creation')).toBe('copywrite'); // observed live, 2026-06-12
    expect(capabilityNameForType('copywriting')).toBe('copywrite');
    expect(capabilityNameForType('build-website')).toBe('build-website');
    expect(capabilityNameForType('site-development')).toBe('build-website');
    expect(capabilityNameForType('landing-page')).toBe('build-website');
    expect(capabilityNameForType('package-archive')).toBe('package-archive');
    // copywrite contains 'write' — the copywrite bucket must win over summarize.
    expect(capabilityNameForType('copywrite')).toBe('copywrite');
    // qa-types deliberately unmapped (handler needs an EvaluationCase).
    expect(capabilityNameForType('quality-assurance')).toBeNull();
  });

  it('returns null for unmatched types', () => {
    expect(capabilityNameForType('crypto-transaction')).toBeNull();
    expect(capabilityNameForType('book-flight')).toBeNull();
    expect(capabilityNameForType('search-web')).toBeNull();
  });

  it('translator-first ordering wins on compound stems', () => {
    // "translate-and-summarize" should resolve to translate, not summarize.
    expect(capabilityNameForType('translate-and-summarize')).toBe('translate');
  });
});

describe('pickAgentForCapability', () => {
  const summarizerAgent = mkAgent(SUMMARIZER, [{ name: 'summarize', price: 1000n }]);
  const translatorAgent = mkAgent(TRANSLATOR, [{ name: 'translate', price: 1000n }]);
  const cheaperSummarizer = mkAgent(
    '0x0000000000000000000000000000000000000abc',
    [{ name: 'summarize', price: 500n }],
  );

  it('returns null when no agent supports the capability', () => {
    expect(pickAgentForCapability('vision-describe', [summarizerAgent, translatorAgent])).toBeNull();
  });

  it('returns the only candidate when exactly one matches', () => {
    const pick = pickAgentForCapability('translate', [summarizerAgent, translatorAgent]);
    expect(pick).not.toBeNull();
    expect(pick!.address.toLowerCase()).toBe(TRANSLATOR.toLowerCase());
    expect(pick!.price).toBe(1000n);
  });

  it('picks the cheapest when multiple agents support the capability', () => {
    const pick = pickAgentForCapability('summarize', [summarizerAgent, cheaperSummarizer]);
    expect(pick).not.toBeNull();
    expect(pick!.price).toBe(500n);
  });

  it('skips inactive agents', () => {
    const inactive = mkAgent(SUMMARIZER, [{ name: 'summarize', price: 1000n }], { active: false });
    expect(pickAgentForCapability('summarize', [inactive])).toBeNull();
  });

  it('breaks price ties deterministically by lowercased address ordering', () => {
    const high = mkAgent('0xFfffffffffffffffffffffffffffffffffffffff', [{ name: 'summarize', price: 1000n }]);
    const low = mkAgent('0x0000000000000000000000000000000000000001', [{ name: 'summarize', price: 1000n }]);
    const pick = pickAgentForCapability('summarize', [high, low]);
    expect(pick!.address.toLowerCase()).toBe('0x0000000000000000000000000000000000000001');
  });
});

describe('resolveExecutorFromRegistry — end-to-end', () => {
  // Realistic registry state: 4 mainnet demo workers as registered.
  const agents: AgentRecordV2[] = [
    mkAgent(SUMMARIZER, [{ name: 'summarize', price: 1000n }]),
    mkAgent(TRANSLATOR, [{ name: 'translate', price: 1000n }]),
    mkAgent(SENTIMENT, [{ name: 'sentiment-classify', price: 1000n }]),
    mkAgent(VISION, [{ name: 'vision-describe', price: 1000n }]),
  ];

  it('resolves common LLM type strings to the right demo worker', () => {
    expect(resolveExecutorFromRegistry('translate-text', agents)?.address.toLowerCase()).toBe(
      TRANSLATOR.toLowerCase(),
    );
    expect(resolveExecutorFromRegistry('image-description', agents)?.address.toLowerCase()).toBe(
      VISION.toLowerCase(),
    );
    expect(resolveExecutorFromRegistry('sentiment-classification', agents)?.address.toLowerCase()).toBe(
      SENTIMENT.toLowerCase(),
    );
    expect(resolveExecutorFromRegistry('comparative-analysis', agents)?.address.toLowerCase()).toBe(
      SUMMARIZER.toLowerCase(),
    );
  });

  it('returns null for high-stakes / unrecognised types', () => {
    expect(resolveExecutorFromRegistry('crypto-transaction', agents)).toBeNull();
    expect(resolveExecutorFromRegistry('book-flight', agents)).toBeNull();
  });

  it('returns null when registry is empty', () => {
    expect(resolveExecutorFromRegistry('translate-text', [])).toBeNull();
  });

  it('surfaces registry price for downstream cost estimate', () => {
    const result = resolveExecutorFromRegistry('summarize-text', agents);
    expect(result).not.toBeNull();
    expect(result!.price).toBe(1000n);
    expect(result!.capability).toBe('summarize');
  });

  it('picks cheaper foreign agent when one outbids the demo worker', () => {
    // Simulate a foreign agent registered with the same capability at half price.
    const foreignAgents = [
      ...agents,
      mkAgent('0x0000000000000000000000000000000000000fff', [{ name: 'summarize', price: 500n }]),
    ];
    const result = resolveExecutorFromRegistry('summarize-text', foreignAgents);
    expect(result!.address.toLowerCase()).toBe('0x0000000000000000000000000000000000000fff');
    expect(result!.price).toBe(500n);
  });
});
