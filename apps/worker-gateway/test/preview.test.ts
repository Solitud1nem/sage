/**
 * Hosted site preview (M12.1.7): serves files from a manifest artifact with
 * containment headers; refuses non-manifest artifacts; canonicalizes the
 * bare-sha URL so relative links resolve.
 */
import { describe, it, expect } from 'vitest';

import { handlePreview } from '../src/preview';

const SHA = 'a'.repeat(64);
const MANIFEST = {
  files: [
    { path: 'index.html', content: '<!DOCTYPE html><html><body>hello</body></html>' },
    { path: 'styles.css', content: 'body{color:red}' },
  ],
};

function makeEnv(objects: Record<string, { json: unknown; contentType: string }>) {
  return {
    ARTIFACTS: {
      async get(key: string) {
        const o = objects[key];
        if (!o) return null;
        return {
          httpMetadata: { contentType: o.contentType },
          json: async () => o.json,
        };
      },
    },
  } as unknown as Parameters<typeof handlePreview>[1];
}

const env = makeEnv({ [SHA]: { json: MANIFEST, contentType: 'application/json' } });

const get = (path: string) => handlePreview(new Request(`https://gw.example${path}`), env);

describe('handlePreview', () => {
  it('serves index.html at the directory root with containment headers', async () => {
    const res = await get(`/preview/${SHA}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('hello');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
  });

  it('serves sub-files with their mime', async () => {
    const res = await get(`/preview/${SHA}/styles.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('redirects bare /preview/<sha> to the trailing-slash form', async () => {
    const res = await get(`/preview/${SHA}`);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`https://gw.example/preview/${SHA}/`);
  });

  it('404s a missing file, a missing artifact, and a non-manifest artifact', async () => {
    expect((await get(`/preview/${SHA}/nope.js`)).status).toBe(404);
    expect((await get(`/preview/${'b'.repeat(64)}/`)).status).toBe(404);
    const zipEnv = makeEnv({ [SHA]: { json: MANIFEST, contentType: 'application/zip' } });
    const res = await handlePreview(new Request(`https://gw.example/preview/${SHA}/`), zipEnv);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed sha and non-GET methods', async () => {
    expect((await get('/preview/zzz/')).status).toBe(400);
    const res = await handlePreview(
      new Request(`https://gw.example/preview/${SHA}/`, { method: 'PUT' }),
      env,
    );
    expect(res.status).toBe(405);
  });
});
