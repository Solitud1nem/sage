/**
 * Shared SSRF/egress guard for worker capabilities that fetch a URL chosen by
 * an LLM or a foreign caller (M13.2.1, ADR-0023 §Layer 4). The extractor and
 * fact-checker both route through `fetchPublicPage`; any new URL-fetching
 * capability — and any foreign-agent fork — MUST do the same instead of
 * calling `fetch` directly.
 *
 * Threat model: a URL transits an LLM (or a foreign brief), so it is untrusted
 * input. The asset worth protecting is the host's cloud metadata endpoint
 * (169.254.169.254 — instance credentials) and any private network the worker
 * sits in. Defenses, in order:
 *   1. https only — no file:, gopher:, http: downgrade.
 *   2. Hostname blocklist — fast reject of obvious private / loopback / *.local
 *      / *.internal / IPv6-literal targets before any DNS or socket.
 *   3. Resolved-IP check — DNS-resolve the hostname and reject if ANY address
 *      is private / loopback / link-local / metadata. Closes the "public
 *      hostname whose A-record points at 169.254.169.254" rebinding case.
 *   4. Manual redirects, re-validated per hop — native fetch follows 3xx
 *      silently, so a trusted URL could 302 to http://169.254.169.254. We
 *      follow redirects ourselves and run steps 1–3 on every hop.
 *   5. Timeout + response size cap + content-type allowlist.
 *
 * Residual risk: a DNS-rebinding attacker who flips the A-record between our
 * lookup (step 3) and the socket connect inside `fetch` could still slip a
 * private IP through (TOCTOU). Closing that fully needs connection-level IP
 * pinning (an undici dispatcher with a validating `connect`/`lookup`); it is a
 * documented follow-up, not in this guard, because it adds a dependency and
 * the metadata endpoint is already covered against the redirect + static-DNS
 * cases that are trivially exploitable.
 */

import { lookup as dnsLookupCb } from 'node:dns';
import { promisify } from 'node:util';

const dnsLookup = promisify(dnsLookupCb);

/** Page fetch limits: a research source is an article, not a download. */
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** A trusted source rarely redirects more than a couple of hops. */
export const MAX_REDIRECTS = 5;

const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.(local|internal)$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[/, // any IPv6 literal — public research sources have hostnames
];

/** Fast hostname-string reject (no DNS). Catches literals + private names. */
export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((p) => p.test(hostname));
}

/** True for a private / loopback / link-local / metadata / reserved IPv4. */
function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return true; // unparseable → fail closed
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return true;
  const [a, b, c] = o as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 ("this host")
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** True for a loopback / unspecified / ULA / link-local / mapped-private IPv6. */
function isPrivateIpv6(ip: string): boolean {
  const a = ip.split('%')[0]!.toLowerCase(); // strip zone id
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  if (a === '::1' || a === '::') return true; // loopback / unspecified
  if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(a)) return true; // fc00::/7 unique-local
  return false;
}

/** True for any non-public IP (string form, v4 or v6). Fail-closed on garbage. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.trim();
  if (addr.length === 0) return true;
  return addr.includes(':') ? isPrivateIpv6(addr) : isPrivateIpv4(addr);
}

export type LookupResult = { address: string; family: number };
export type LookupImpl = (hostname: string) => Promise<LookupResult[]>;

/** Real DNS resolver — every A/AAAA record, so we can reject if ANY is private. */
const realLookupAll: LookupImpl = async (hostname) => {
  const res = await dnsLookup(hostname, { all: true });
  return res.map((r) => ({ address: r.address, family: r.family }));
};

/** Permissive stub used when the network is mocked (a `fetchImpl` is injected):
 *  the test controls the socket, so the DNS guard is moot unless it also
 *  injects a `lookupImpl`. Returns a public address so real hosts pass. */
const allowAllLookup: LookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];

export interface FetchPublicPageOpts {
  fetchImpl?: typeof fetch;
  /** DNS resolver — defaults to real DNS on the prod path, permissive when a
   *  `fetchImpl` is injected (see `allowAllLookup`). Inject to test the guard. */
  lookupImpl?: LookupImpl;
  timeoutMs?: number;
}

/** Parse a URL, enforce https, and fast-reject blocked hostnames. */
function parseGuarded(raw: string, base?: URL): URL {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (u.protocol !== 'https:') {
    throw new Error(`only https sources are fetched (got ${u.protocol}//)`);
  }
  if (isBlockedHostname(u.hostname)) {
    throw new Error(`host "${u.hostname}" is not a public research source`);
  }
  return u;
}

/**
 * Guarded fetch for an untrusted (LLM- or foreign-supplied) public URL.
 * Returns the decoded page text. See the file header for the full threat model.
 * Drop-in compatible with the old `extractor.fetchPublicPage` signature.
 */
export async function fetchPublicPage(
  url: string,
  opts: FetchPublicPageOpts = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Real DNS on the prod path; permissive when the caller mocks the network.
  const lookup = opts.lookupImpl ?? (opts.fetchImpl ? allowAllLookup : realLookupAll);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let target = parseGuarded(url);
    for (let hop = 0; ; hop++) {
      // Re-validate the resolved IPs on every hop (initial + each redirect).
      const addrs = await lookup(target.hostname);
      if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
        throw new Error(`host "${target.hostname}" is not a public research source`);
      }

      const res = await fetchImpl(target.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: { Accept: 'text/html,application/xhtml+xml,text/plain' },
      });

      // Follow redirects ourselves so each Location is re-validated.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`HTTP ${res.status} without a Location header`);
        if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
        target = parseGuarded(location, target); // relative Locations resolve against current
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml|text\/plain|^$/.test(contentType)) {
        throw new Error(`unsupported content-type "${contentType}"`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_PAGE_BYTES) {
        throw new Error(`page is ${buf.byteLength} bytes — max ${MAX_PAGE_BYTES}`);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
  } finally {
    clearTimeout(timer);
  }
}
