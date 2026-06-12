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
    `# ${siteTitle} — your website, ready to publish`,
    '',
    'Built by the Sage website pipeline (copywriter → builder → QA → packager), each step paid and verified on Base.',
    '',
    'This is a plain static site: **no build step, no dependencies, nothing to install.** The files below are the whole site.',
    '',
    fileList,
    '',
    '## See it right now (10 seconds)',
    '',
    'Unzip this archive and double-click `index.html` — it opens in your browser exactly as visitors will see it.',
    '',
    '## Put it online — pick ONE option',
    '',
    '### Option A — Netlify Drop (easiest, ~2 minutes, free, no terminal)',
    '',
    '1. Unzip this archive into a folder.',
    '2. Open <https://app.netlify.com/drop> in your browser (sign up free if asked — email is enough).',
    '3. Drag the unzipped FOLDER onto the page.',
    '4. Done — Netlify shows your live URL (like `https://your-site.netlify.app`). Share it.',
    '',
    '### Option B — Cloudflare Pages (free, ~5 minutes, needs Node.js installed)',
    '',
    '1. Unzip the archive and open a terminal in that folder.',
    '2. Run: `npx wrangler pages deploy . --project-name my-site`',
    '3. First run asks you to log in to a free Cloudflare account — follow the browser prompt.',
    '4. The command prints your live URL when it finishes.',
    '',
    '### Option C — GitHub Pages (free, good if you already use GitHub)',
    '',
    '1. Create a new repository on github.com and upload these files to its root.',
    '2. Repository → Settings → Pages → "Deploy from a branch" → branch `main`, folder `/ (root)` → Save.',
    '3. After ~1 minute your site is live at `https://<your-username>.github.io/<repo-name>/`.',
    '',
    '## Want your own domain?',
    '',
    'All three hosts above let you attach a custom domain (like `yourbar.com`) for free in their dashboard — buy the domain at any registrar, then follow the host\'s "custom domain" guide.',
    '',
    '## Editing the site later',
    '',
    `Text lives in \`index.html\`, colors and fonts in \`styles.css\` — both are plain files you can open in any editor. Re-upload after changes (same steps as above).`,
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
