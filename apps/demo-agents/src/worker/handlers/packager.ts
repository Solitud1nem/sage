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

/**
 * Laconic-but-deep README (M12.1.7 feedback): preview link first, ONE honest
 * publish path (registration steps not hidden — the old text oversold
 * Netlify Drop as registration-free), alternatives one line each.
 */
export function buildReadme(manifest: SiteManifest, siteTitle: string, previewUrl?: string): string {
  const fileList = manifest.files.map((f) => `\`${f.path}\``).join(', ');
  return [
    `# ${siteTitle}`,
    '',
    `Static site, no build step — these files (${fileList}) are the whole thing.`,
    'Built and QA-verified by the Sage pipeline, settled per-step on Base.',
    '',
    ...(previewUrl
      ? [`**Live preview (already online, expires in ~30 days):** <${previewUrl}>`, '']
      : []),
    '**See it locally:** unzip and double-click `index.html`.',
    '',
    '## Publish (Netlify, free, ~5 min)',
    '',
    '1. Create a free account at netlify.com (email is enough).',
    '2. Open <https://app.netlify.com/drop> and drag the unzipped folder onto the page.',
    '3. Your site is live at `https://<name>.netlify.app`. Custom domain: Site settings → Domain management.',
    '',
    'Alternatives: **Cloudflare Pages** — `npx wrangler pages deploy .` (needs Node.js + free account); **GitHub Pages** — push files to a repo, Settings → Pages → deploy from branch.',
    '',
    '**Edit later:** text lives in `index.html`, colors/fonts in `styles.css` — plain files, any editor; re-upload after changes.',
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
  // M12.1.7: the manifest artifact doubles as the hosted preview — derive the
  // preview URL from the artifact URL shape (same gateway origin).
  const previewUrl = ref.url.includes('/api/artifacts/')
    ? `${ref.url.replace('/api/artifacts/', '/preview/')}/`
    : undefined;
  const entries: Record<string, Uint8Array> = {
    'README.md': strToU8(buildReadme(manifest, title, previewUrl)),
  };
  for (const f of manifest.files) {
    entries[f.path] = strToU8(f.content);
  }
  const zipBytes = zipSync(entries, { level: 6 });

  const zipRef = await ctx.artifacts.upload(zipBytes, 'application/zip');
  return JSON.stringify({
    artifact: zipRef,
    ...(previewUrl ? { previewUrl } : {}),
    manifest: {
      title,
      files: manifest.files.map((f) => ({
        path: f.path,
        bytes: Buffer.byteLength(f.content, 'utf8'),
      })),
    },
  });
};
