/**
 * Packager — final step of the website pipeline (M12.1.1, ADR-0020): the
 * artifact the user actually takes away — «zip с проектом, готовым к деплою
 * + README-инструкции».
 *
 * Input: the builder's artifact envelope (via inputs chaining). The handler
 * downloads the site manifest through the store — which verifies the bytes
 * against the on-chain sha256 BEFORE we package anything — re-validates the
 * manifest defensively, adds a generated README.md with deploy
 * instructions, zips everything (fflate — the one sanctioned dependency
 * addition of M12.1.1), and uploads the zip as the final artifact.
 *
 * No LLM: this step is deterministic packaging — its price covers gas +
 * hosting of the verification/packaging compute.
 */

import { zipSync, unzipSync, strToU8 } from 'fflate';

import { decodeArtifactResult } from '../artifacts.js';
import { validateManifest, type SiteManifest } from './builder.js';
import type { CapabilityHandler } from './index.js';

export { unzipSync }; // re-export for tests (round-trip the produced zip)

export function buildReadme(manifest: SiteManifest, siteTitle: string): string {
  const fileList = manifest.files.map((f) => `- \`${f.path}\``).join('\n');
  return [
    `# ${siteTitle} — static site package`,
    '',
    'Built by the Sage website pipeline (copywriter → builder → packager), settled per-step on Base.',
    '',
    '## Files',
    '',
    fileList,
    '',
    '## Deploy',
    '',
    'This is a plain static site — no build step. Any static host works:',
    '',
    '- **Cloudflare Pages:** `npx wrangler pages deploy .` from the unzipped folder',
    '- **Netlify:** drag the unzipped folder into app.netlify.com/drop',
    '- **GitHub Pages:** push the files to a repo, enable Pages on the root',
    '- **Anywhere else:** serve the folder with any web server (`npx serve .`)',
    '',
    'Entry point: `index.html`.',
    '',
  ].join('\n');
}

function siteTitleFromManifest(manifest: SiteManifest): string {
  const index = manifest.files.find((f) => f.path.toLowerCase() === 'index.html');
  const m = index ? /<title>([^<]*)<\/title>/i.exec(index.content) : null;
  return m?.[1]?.trim() || 'Website';
}

export const packagerHandler: CapabilityHandler = async (job, ctx) => {
  if (!ctx.artifacts) {
    throw new Error('artifact store unavailable — packager cannot fetch or deliver artifacts');
  }
  if (!job.material) {
    throw new Error('packager needs the builder artifact envelope as material');
  }
  const ref = decodeArtifactResult(job.material);
  if (!ref) {
    throw new Error('packager material is not an artifact envelope (expected builder output)');
  }

  // download() verifies sha256 against the envelope — we package only bytes
  // that match what the builder committed on-chain.
  const manifestBytes = await ctx.artifacts.download(ref);
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));

  const title = siteTitleFromManifest(manifest);
  const entries: Record<string, Uint8Array> = {
    'README.md': strToU8(buildReadme(manifest, title)),
  };
  for (const f of manifest.files) {
    entries[f.path] = strToU8(f.content);
  }
  const zipBytes = zipSync(entries, { level: 6 });

  const zipRef = await ctx.artifacts.upload(zipBytes, 'application/zip');
  return JSON.stringify({
    artifact: zipRef,
    manifest: {
      title,
      files: manifest.files.map((f) => ({
        path: f.path,
        bytes: Buffer.byteLength(f.content, 'utf8'),
      })),
    },
  });
};
