/**
 * SSRF/egress guard (M13.2.1, ADR-0023 §Layer 4). Verifies that
 * `fetchPublicPage` defends the host's cloud-metadata endpoint and private
 * network against an untrusted (LLM- or foreign-supplied) URL across all four
 * vectors: scheme, hostname, resolved IP, and redirect target.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  fetchPublicPage,
  isPrivateIp,
  isBlockedHostname,
  MAX_PAGE_BYTES,
  type LookupImpl,
} from '../../src/worker/net.js';

/** A Response factory — body, status, headers. */
function resp(body: string | null, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

/** Lookup that maps hostname → IPs; defaults to a public address. */
function lookupFor(map: Record<string, string[]> = {}): LookupImpl {
  return async (hostname: string) =>
    (map[hostname] ?? ['93.184.216.34']).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

describe('isPrivateIp', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1', // CGNAT
    '192.0.0.1',
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:10.0.0.1',
    '256.1.1.1', // out of range → fail closed
    'not-an-ip',
    '',
  ])('treats %s as private/unsafe', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1', // just below the 172.16/12 block
    '172.32.0.1', // just above
    '100.128.0.1', // just above CGNAT
    '2606:4700:4700::1111', // public IPv6
  ])('treats %s as public', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('isBlockedHostname', () => {
  it.each(['localhost', 'gateway.internal', 'db.local', '127.0.0.1', '10.0.0.1', '[::1]'])(
    'blocks %s',
    (h) => expect(isBlockedHostname(h)).toBe(true),
  );
  it.each(['example.com', 'sub.example.org', 'a.example'])('allows %s', (h) =>
    expect(isBlockedHostname(h)).toBe(false),
  );
});

describe('fetchPublicPage scheme + hostname guards', () => {
  it('rejects non-https', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchPublicPage('http://example.com/', { fetchImpl })).rejects.toThrow(/only https/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://gw.internal/x'])(
    'rejects blocked host %s before any fetch',
    async (url) => {
      const fetchImpl = vi.fn();
      await expect(fetchPublicPage(url, { fetchImpl })).rejects.toThrow(/not a public research source/);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe('fetchPublicPage resolved-IP guard', () => {
  it('rejects a public hostname whose DNS points at cloud metadata', async () => {
    const fetchImpl = vi.fn();
    const lookupImpl = lookupFor({ 'evil.example': ['169.254.169.254'] });
    await expect(
      fetchPublicPage('https://evil.example/x', { fetchImpl, lookupImpl }),
    ).rejects.toThrow(/not a public research source/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects when ANY resolved address is private (mixed A records)', async () => {
    const fetchImpl = vi.fn();
    const lookupImpl = lookupFor({ 'evil.example': ['93.184.216.34', '10.0.0.5'] });
    await expect(
      fetchPublicPage('https://evil.example/x', { fetchImpl, lookupImpl }),
    ).rejects.toThrow(/not a public research source/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows a public hostname that resolves to public IPs', async () => {
    const fetchImpl = vi.fn(async () => resp('<p>ok</p>', 200, { 'content-type': 'text/html' }));
    const lookupImpl = lookupFor({ 'ok.example': ['93.184.216.34'] });
    await expect(
      fetchPublicPage('https://ok.example/x', { fetchImpl, lookupImpl }),
    ).resolves.toContain('ok');
  });
});

describe('fetchPublicPage redirect re-validation', () => {
  it('blocks an https→http downgrade redirect', async () => {
    const fetchImpl = vi.fn(async () =>
      resp(null, 302, { location: 'http://169.254.169.254/latest/meta-data/' }),
    );
    await expect(fetchPublicPage('https://news.example/a', { fetchImpl })).rejects.toThrow(/only https/);
  });

  it('blocks a redirect to a blocked hostname', async () => {
    const fetchImpl = vi.fn(async () => resp(null, 302, { location: 'https://localhost/x' }));
    await expect(fetchPublicPage('https://news.example/a', { fetchImpl })).rejects.toThrow(
      /not a public research source/,
    );
  });

  it('blocks a redirect whose target resolves to a private IP', async () => {
    const fetchImpl = vi.fn(async () => resp(null, 302, { location: 'https://evil.example/x' }));
    const lookupImpl = lookupFor({ 'news.example': ['93.184.216.34'], 'evil.example': ['10.0.0.9'] });
    await expect(
      fetchPublicPage('https://news.example/a', { fetchImpl, lookupImpl }),
    ).rejects.toThrow(/not a public research source/);
  });

  it('follows a single safe redirect to a 200', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://news.example/a') return resp(null, 302, { location: 'https://news.example/b' });
      return resp('<p>final</p>', 200, { 'content-type': 'text/html' });
    });
    await expect(fetchPublicPage('https://news.example/a', { fetchImpl })).resolves.toContain('final');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect loop past the cap', async () => {
    const fetchImpl = vi.fn(async () => resp(null, 302, { location: 'https://news.example/loop' }));
    await expect(fetchPublicPage('https://news.example/a', { fetchImpl })).rejects.toThrow(
      /too many redirects/,
    );
  });

  it('rejects a 3xx with no Location header', async () => {
    const fetchImpl = vi.fn(async () => resp(null, 302, {}));
    await expect(fetchPublicPage('https://news.example/a', { fetchImpl })).rejects.toThrow(
      /without a Location/,
    );
  });
});

describe('fetchPublicPage response guards', () => {
  it('rejects non-2xx', async () => {
    const fetchImpl = vi.fn(async () => resp('nope', 404, { 'content-type': 'text/html' }));
    await expect(fetchPublicPage('https://ok.example/x', { fetchImpl })).rejects.toThrow(/HTTP 404/);
  });

  it('rejects a non-text content-type', async () => {
    const fetchImpl = vi.fn(async () => resp('PDF', 200, { 'content-type': 'application/pdf' }));
    await expect(fetchPublicPage('https://ok.example/x', { fetchImpl })).rejects.toThrow(
      /unsupported content-type/,
    );
  });

  it('rejects an over-cap response', async () => {
    const big = 'a'.repeat(MAX_PAGE_BYTES + 1);
    const fetchImpl = vi.fn(async () => resp(big, 200, { 'content-type': 'text/html' }));
    await expect(fetchPublicPage('https://ok.example/x', { fetchImpl })).rejects.toThrow(/max/);
  });

  it('returns decoded body on success', async () => {
    const fetchImpl = vi.fn(async () => resp('<h1>Title</h1>', 200, { 'content-type': 'text/html; charset=utf-8' }));
    await expect(fetchPublicPage('https://ok.example/x', { fetchImpl })).resolves.toBe('<h1>Title</h1>');
  });
});
