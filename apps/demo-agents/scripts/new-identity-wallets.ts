/**
 * Mint fresh EOAs for generic-worker identities (M12.0.4).
 *
 *   pnpm --filter @sage/demo-agents exec tsx scripts/new-identity-wallets.ts copywriter builder
 *
 * Prints, per identity, the address (for the funding list) and the
 * ready-to-paste `fly secrets set` command. Keys are NEVER written to disk —
 * stdout only, into your terminal; clear scrollback after staging.
 */

/* eslint-disable no-console -- CLI tool: stdout is the interface */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('usage: tsx scripts/new-identity-wallets.ts <identity-id> [...]');
  process.exit(1);
}

const secrets: string[] = [];
for (const id of ids) {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const envName = `${id.toUpperCase().replace(/-/g, '_')}_PRIVATE_KEY`;
  console.log(`${id}: ${account.address}`);
  secrets.push(`${envName}=${pk}`);
}

console.log('\n# Stage onto the worker app (applies on next deploy/restart):');
console.log(
  `fly secrets set -c apps/demo-agents/fly.workers.toml --stage \\\n  ${secrets.join(' \\\n  ')}`,
);
console.log('\n# Fund each address with ~0.0005 ETH on Base for registration + task gas.');
