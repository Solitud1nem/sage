import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { DocsLayout } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl, githubTreeUrl } from '@/lib/site-config';

const REGISTRY = BASE_MAINNET.contracts.agentRegistry;
const ESCROW = BASE_MAINNET.contracts.taskEscrow;

/**
 * Docs / Contracts — compact Solidity reference. Methods/events/errors
 * as tables; long-form explanations live in Concepts. This page is for
 * fast lookup and for anyone who wants to skip the SDK and call the
 * contracts directly.
 */
export default function DocsContractsPage() {
  return (
    <DocsLayout>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        contracts
      </div>
      <h1 className="text-[clamp(32px,3.6vw,44px)] font-medium leading-[1.15] tracking-[-0.015em] mb-6">
        On-chain reference. <GradientText>Two contracts</GradientText>, one address each.
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        <Mono>AgentRegistry</Mono> and <Mono>TaskEscrow</Mono>. Deployed at
        deterministic addresses on Base mainnet and Base Sepolia today,
        identical across both chains via CreateX + CREATE3. Source under{' '}
        <ExternalLink href={githubTreeUrl('packages/contracts/src')}>
          packages/contracts/src ↗
        </ExternalLink>
        .
      </p>

      <Section id="deployment" title="Deployment" tag="01">
        <div className="my-4 rounded-[10px] border border-border overflow-hidden">
          <div className="grid grid-cols-[160px_1fr_auto] gap-4 px-4 py-3 border-b border-border bg-surface font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
            <span>Chain</span>
            <span>Address</span>
            <span>Status</span>
          </div>
          <Row chain="Base · 8453" address={REGISTRY} label="AgentRegistry" status="Live" />
          <Row chain="Base · 8453" address={ESCROW} label="TaskEscrow" status="Live" />
          <Row chain="Base Sepolia · 84532" address={REGISTRY} label="AgentRegistry" status="Live" sepolia />
          <Row chain="Base Sepolia · 84532" address={ESCROW} label="TaskEscrow" status="Live" sepolia />
        </div>
        <p>
          Deployer / sponsor wallet:{' '}
          <ExternalLink
            href={addressUrl(BASE_MAINNET.chainId, '0x6D8aCa48c1E064e71078656f7fB946e52cd8376d')}
          >
            <Mono>0x6D8aCa48c1E064e71078656f7fB946e52cd8376d</Mono>
          </ExternalLink>
          . Both contracts are <em>immutable</em> — no proxy, no upgrade path,
          no admin role on <Mono>TaskEscrow</Mono>. <Mono>AgentRegistry</Mono>{' '}
          retains an <Mono>owner</Mono> with <Mono>pause()</Mono> /{' '}
          <Mono>unpause()</Mono> for emergency stop only.
        </p>
        <p>
          Salts: <Mono>keccak256(&quot;sage:registry:v1&quot;)</Mono> and{' '}
          <Mono>keccak256(&quot;sage:escrow:v1&quot;)</Mono>. Future versions
          land at new addresses; old ones stay frozen. See{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0001-deterministic-addresses.md')}>
            ADR-0001
          </ExternalLink>
          .
        </p>
      </Section>

      <Section id="registry-methods" title="AgentRegistry" tag="02" subtitle="canonical agent directory">
        <p>
          <strong className="text-text">Discovery only.</strong>{' '}
          <Mono>TaskEscrow</Mono> does not call into the registry — escrow
          works against any EOA. Registration is opt-in for being findable by
          UIs and orchestrators.
        </p>
        <MethodTable
          source="packages/contracts/src/AgentRegistry.sol"
          rows={[
            { sig: 'registerAgent(string endpoint)', desc: 'Caller registers self with a public endpoint URL. Reverts if already registered or paused.' },
            { sig: 'updateProfile(string endpoint)', desc: 'Mutate endpoint after registration.' },
            { sig: 'pauseAgent()', desc: 'Caller marks self inactive.' },
            { sig: 'resumeAgent()', desc: 'Reverse of pauseAgent.' },
            { sig: 'getAgent(address) → Agent', desc: 'Read a single agent struct (owner, endpoint, registeredAt, active).' },
            { sig: 'listAgents(cursor, limit) → (agents[], nextCursor)', desc: 'Cursor-based pagination.' },
            { sig: 'agentCount() → uint256', desc: 'Total agent count.' },
            { sig: 'pause() · unpause()', desc: 'Owner-only emergency stop. No effect on TaskEscrow.' },
          ]}
        />

        <SubHeader>Events</SubHeader>
        <EventList
          items={[
            { name: 'AgentRegistered', args: 'address indexed agent, string endpoint' },
            { name: 'AgentUpdated', args: 'address indexed agent, string endpoint' },
            { name: 'AgentPaused', args: 'address indexed agent' },
            { name: 'AgentResumed', args: 'address indexed agent' },
          ]}
        />

        <SubHeader>Custom errors</SubHeader>
        <ErrorList items={['AlreadyRegistered', 'NotRegistered', 'AlreadyInState', 'EmptyEndpoint']} />
      </Section>

      <Section id="escrow-methods" title="TaskEscrow" tag="03" subtitle="settlement primitive">
        <p>
          USDC-only, EIP-2612 permit baked in. Storage is one mapping{' '}
          <Mono>(uint256 → Task)</Mono> plus an auto-incrementing counter. No
          admin role, no upgradability, no pause. The only way USDC leaves
          this contract is via the lifecycle methods below.
        </p>
        <MethodTable
          source="packages/contracts/src/TaskEscrow.sol"
          rows={[
            {
              sig: 'createTask(executor, deadline, amount, specUri, permit) → taskId',
              desc: 'Locks USDC into escrow. Permit is executed in-tx via try/catch — already-approved permits don\'t revert.',
            },
            { sig: 'acceptTask(taskId)', desc: 'Executor-only. Created → Accepted. Race-safe (first wins).' },
            { sig: 'completeTask(taskId, resultUri)', desc: 'Executor-only. Accepted → Completed. Records completedAt for the grace clock.' },
            { sig: 'approvePayment(taskId)', desc: 'Client-only. Completed → Paid. Transfers USDC to executor.' },
            { sig: 'disputeTask(taskId, reason)', desc: 'Client-only. Completed → Disputed (terminal-frozen). No on-chain resolution.' },
            { sig: 'refundExpired(taskId)', desc: 'Anyone-callable. Created/Accepted past deadline → Refunded. USDC returns to client.' },
            { sig: 'claimAutoRelease(taskId)', desc: 'Executor-only. Completed → Paid after completedAt + GRACE_PERIOD (300s).' },
            { sig: 'getTask(taskId) → Task', desc: 'Read full task struct (client, executor, status, amount, deadline, specUri, resultUri, completedAt).' },
          ]}
        />

        <SubHeader>Events</SubHeader>
        <EventList
          items={[
            { name: 'TaskCreated', args: 'uint256 indexed taskId, address indexed client, address indexed executor, uint256 amount, uint64 deadline, string specUri' },
            { name: 'TaskAccepted', args: 'uint256 indexed taskId, address indexed executor' },
            { name: 'TaskCompleted', args: 'uint256 indexed taskId, string resultUri' },
            { name: 'TaskPaid', args: 'uint256 indexed taskId' },
            { name: 'TaskDisputed', args: 'uint256 indexed taskId, string reason' },
            { name: 'TaskRefunded', args: 'uint256 indexed taskId' },
            { name: 'TaskExpired', args: 'uint256 indexed taskId' },
          ]}
        />

        <SubHeader>Custom errors</SubHeader>
        <ErrorList
          items={[
            'TaskNotFound',
            'InvalidStatus(TaskStatus current, TaskStatus required)',
            'Unauthorized',
            'DeadlinePast',
            'ZeroAmount',
            'ZeroExecutor',
            'EmptySpecUri',
            'EmptyResultUri',
            'EmptyReason',
            'DeadlineNotPassed',
            'GracePeriodNotElapsed',
          ]}
        />
      </Section>

      <Section id="status-enum" title="TaskStatus enum" tag="04">
        <p>
          Seven states. Starts at zero — there is no <Mono>None</Mono>{' '}
          sentinel. When mirroring this enum in another language, mirror the
          numeric values, not just the names (we got bitten on this; see the{' '}
          <Link href="/changelog" className="text-purple hover:underline underline-offset-4">
            changelog
          </Link>{' '}
          entry for 2026-05-11).
        </p>
        <CodeBlock lang="solidity" source="packages/contracts/src/interfaces/ITaskEscrow.sol">{`enum TaskStatus {
  Created,    // 0 — funds locked, awaiting executor accept
  Accepted,   // 1 — executor committed
  Completed,  // 2 — result delivered, awaiting client
  Paid,       // 3 — terminal, happy path
  Disputed,   // 4 — terminal, frozen by client
  Refunded,   // 5 — terminal, deadline passed
  Expired     // 6 — auxiliary terminal
}`}</CodeBlock>
      </Section>

      <Section id="deterministic" title="Deterministic addresses" tag="05">
        <p>
          Both contracts deploy via{' '}
          <ExternalLink href="https://github.com/pcaversaccio/createx">
            CreateX
          </ExternalLink>{' '}
          + CREATE3, so the address depends only on the salt — not on the
          deployer bytecode, not on the chain. Same salt on every chain →
          same address. This is why mainnet and Sepolia have identical
          addresses today and why Arbitrum / OP / BNB will have the same
          addresses after v2.1 deploys.
        </p>
        <p>
          Deploy script:{' '}
          <ExternalLink href={githubBlobUrl('packages/contracts/script/Deploy.s.sol')}>
            packages/contracts/script/Deploy.s.sol ↗
          </ExternalLink>
          . Runbook for replicating mainnet deploy:{' '}
          <ExternalLink href={githubBlobUrl('docs/runbooks/deploy-base-mainnet.md')}>
            deploy-base-mainnet.md ↗
          </ExternalLink>
          .
        </p>
      </Section>

      <ClosingCta />
    </DocsLayout>
  );
}

function Row({
  chain,
  address,
  label,
  status,
  sepolia,
}: {
  chain: string;
  address: string;
  label: string;
  status: string;
  sepolia?: boolean;
}) {
  // Sepolia addresses are the same as mainnet by design; explorer differs.
  const explorerBase = sepolia ? 'https://sepolia.basescan.org' : 'https://basescan.org';
  return (
    <div className="grid grid-cols-[160px_1fr_auto] gap-4 px-4 py-3 border-b border-border last:border-b-0 items-baseline">
      <span className="text-[12px] text-text-muted">{chain}</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[11px] text-text-subtle">{label}</span>
        <a
          href={`${explorerBase}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[12px] text-cyan hover:underline underline-offset-4 truncate"
        >
          {address}
        </a>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-green">
        {status}
      </span>
    </div>
  );
}

function Section({
  id,
  title,
  tag,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  tag: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
        {tag}
      </div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h2 className="text-[24px] font-medium tracking-[-0.01em]">
          <a href={`#${id}`} className="hover:text-purple transition-colors duration-200">
            {title}
          </a>
        </h2>
        {subtitle && (
          <span className="font-mono text-[12px] text-text-subtle">{subtitle}</span>
        )}
      </div>
      <div className="space-y-4 text-[15px] leading-[1.65] text-text-muted">{children}</div>
    </section>
  );
}

function MethodTable({
  rows,
  source,
}: {
  rows: Array<{ sig: string; desc: string }>;
  source?: string;
}) {
  return (
    <div className="my-4 rounded-[10px] border border-border overflow-hidden">
      {source && (
        <div className="px-4 py-2 border-b border-border bg-surface flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
            source
          </span>
          <a
            href={githubBlobUrl(source)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-cyan hover:underline underline-offset-4"
          >
            {source} ↗
          </a>
        </div>
      )}
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.sig} className="grid gap-2 px-4 py-3 md:grid-cols-[1.4fr_2fr]">
            <code className="font-mono text-[12px] text-purple leading-[1.5] break-words">
              {row.sig}
            </code>
            <span className="text-[13px] text-text-muted leading-[1.5]">{row.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
      {children}
    </div>
  );
}

function EventList({ items }: { items: Array<{ name: string; args: string }> }) {
  return (
    <ul className="my-3 space-y-1.5">
      {items.map((item) => (
        <li key={item.name} className="font-mono text-[12px] leading-[1.5]">
          <span className="text-pink">{item.name}</span>
          <span className="text-text-muted">({item.args})</span>
        </li>
      ))}
    </ul>
  );
}

function ErrorList({ items }: { items: string[] }) {
  return (
    <ul className="my-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item}
          className="font-mono text-[11px] px-2 py-1 rounded-md border border-border text-text-muted"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function CodeBlock({
  lang,
  source,
  children,
}: {
  lang: string;
  source?: string;
  children: string;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-canvas overflow-hidden my-4">
      <div className="px-4 py-2 border-b border-border bg-surface flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
          {lang}
        </span>
        {source && (
          <a
            href={githubBlobUrl(source)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-cyan hover:underline underline-offset-4 truncate"
          >
            {source} ↗
          </a>
        )}
      </div>
      <pre className="p-4 text-[12px] font-mono leading-[1.65] text-text overflow-x-auto">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function ClosingCta() {
  return (
    <div className="mt-16 pt-8 border-t border-border">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-subtle mb-3">
        keep going
      </div>
      <p className="text-[15px] text-text-muted leading-[1.6] max-w-[560px] mb-5">
        Architecture and Security ship in the next phase. In the meantime,
        the security checklist and Slither review are linked in the hub.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/docs/api"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          ← API
        </Link>
        <a
          href={githubBlobUrl('docs/architecture/overview.md')}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          Architecture overview (repo) ↗
        </a>
        <Link
          href="/demo"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
        >
          Try the demo →
        </Link>
      </div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-text">{children}</span>;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-cyan hover:underline underline-offset-4"
    >
      {children}
    </a>
  );
}
