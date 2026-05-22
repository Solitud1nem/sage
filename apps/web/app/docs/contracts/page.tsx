import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { ARC_TESTNET } from '@/chains/arc';
import { DocsLayout, DocsNextLink } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl, githubTreeUrl } from '@/lib/site-config';

const REGISTRY = BASE_MAINNET.contracts.agentRegistry;
const ESCROW = BASE_MAINNET.contracts.taskEscrow;
const ARC_REGISTRY = ARC_TESTNET.contracts.agentRegistry;
const ARC_ESCROW = ARC_TESTNET.contracts.taskEscrow;

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
        On-chain reference. <GradientText>Two contracts</GradientText>, three live deployments.
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        <Mono>AgentRegistry</Mono> and <Mono>TaskEscrow</Mono>. Same Solidity
        source on Base mainnet, Base Sepolia, and Arc testnet — identical
        addresses on Base via CreateX + CREATE3, distinct addresses on Arc via
        Arachnid CREATE2 (the bridge state per{' '}
        <ExternalLink href={githubBlobUrl('docs/adr/0015-arc-deploy-bridge.md')}>
          ADR-0015
        </ExternalLink>
        ). Source under{' '}
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
          <Row chain="Base · 8453" address={REGISTRY} label="AgentRegistry" status="Live" explorer="basescan" />
          <Row chain="Base · 8453" address={ESCROW} label="TaskEscrow" status="Live" explorer="basescan" />
          <Row chain="Base Sepolia · 84532" address={REGISTRY} label="AgentRegistry" status="Live" explorer="basescanSepolia" />
          <Row chain="Base Sepolia · 84532" address={ESCROW} label="TaskEscrow" status="Live" explorer="basescanSepolia" />
          <Row chain="Arc testnet · 5042002" address={ARC_REGISTRY} label="AgentRegistry" status="Bridge" explorer="arcscan" />
          <Row chain="Arc testnet · 5042002" address={ARC_ESCROW} label="TaskEscrow" status="Bridge" explorer="arcscan" />
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
          Base salts: <Mono>keccak256(&quot;sage:registry:v1&quot;)</Mono> and{' '}
          <Mono>keccak256(&quot;sage:escrow:v1&quot;)</Mono> via CreateX +
          CREATE3 → same address on Base mainnet + Sepolia (and any future
          EVM chain that has CreateX deployed). See{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0001-deterministic-addresses.md')}>
            ADR-0001
          </ExternalLink>
          .
        </p>
        <p>
          Arc salts: <Mono>keccak256(&quot;sage:arc:registry:v1&quot;)</Mono>{' '}
          and <Mono>keccak256(&quot;sage:arc:escrow:v1&quot;)</Mono> via
          Arachnid CREATE2 (CreateX is not deployed on Arc). Addresses
          intentionally diverge from Base — recorded as an explicit ADR-0001
          exception in{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0015-arc-deploy-bridge.md')}>
            ADR-0015
          </ExternalLink>
          . The bridge is interim: if Arc publishes ERC-8183 / ERC-8004
          reference contracts at canonical addresses, Sage migrates to a thin
          wrapper over those primitives per{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0014-arc-adapter-native-erc-8183.md')}>
            ADR-0014
          </ExternalLink>
          's design — bridge contracts stay readable for any in-flight tasks
          but no new tasks route through them.
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
          On Base + Sepolia + any future EVM with CreateX deployed (Arbitrum,
          OP, BNB on the v2.1 path), the contracts go through{' '}
          <ExternalLink href="https://github.com/pcaversaccio/createx">
            CreateX
          </ExternalLink>{' '}
          + CREATE3 — address depends only on the salt, not on the deployer
          bytecode, not on the chain. Same salt everywhere → same address.
          That&apos;s the ADR-0001 invariant for the EVM cohort.
        </p>
        <p>
          Arc testnet is the documented exception. CreateX is not deployed on
          Arc, so Sage deploys via the canonical Arachnid CREATE2 deployer
          (<Mono>0x4e59b44847b379578588920cA78FbF26c0B4956C</Mono>) with
          Arc-specific salts. Addresses differ from Base by design — UI
          surfaces and integrators can no longer assume{' '}
          <em>&quot;Sage contract X is at address Y everywhere&quot;</em>.
          Read the chain config via <Mono>@sage/adapter-evm</Mono> instead of
          hardcoding addresses across chains. The exception is recorded in{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0015-arc-deploy-bridge.md')}>
            ADR-0015
          </ExternalLink>{' '}
          (see <em>ADR-0001 footnote</em> there).
        </p>
        <p>
          Deploy scripts:{' '}
          <ExternalLink href={githubBlobUrl('packages/contracts/script/Deploy.s.sol')}>
            Deploy.s.sol ↗
          </ExternalLink>{' '}
          (Base, CreateX) and{' '}
          <ExternalLink href={githubBlobUrl('packages/contracts/script/DeployArc.s.sol')}>
            DeployArc.s.sol ↗
          </ExternalLink>{' '}
          (Arc, Arachnid). Runbooks:{' '}
          <ExternalLink href={githubBlobUrl('docs/runbooks/deploy-base-mainnet.md')}>
            deploy-base-mainnet.md ↗
          </ExternalLink>{' '}
          ·{' '}
          <ExternalLink href={githubBlobUrl('docs/runbooks/deploy-arc-testnet.md')}>
            deploy-arc-testnet.md ↗
          </ExternalLink>
          .
        </p>
      </Section>

      <DocsNextLink
        href="/docs/architecture"
        label="Architecture"
        hint="The end-to-end picture — browser → Worker → Fly → Base, money flow, chains, security boundaries, and roadmap."
      />
    </DocsLayout>
  );
}

function Row({
  chain,
  address,
  label,
  status,
  explorer,
}: {
  chain: string;
  address: string;
  label: string;
  status: string;
  explorer: 'basescan' | 'basescanSepolia' | 'arcscan';
}) {
  const explorerBase =
    explorer === 'basescan'
      ? 'https://basescan.org'
      : explorer === 'basescanSepolia'
        ? 'https://sepolia.basescan.org'
        : 'https://testnet.arcscan.app';
  // "Bridge" status uses a softer accent to distinguish from prod-Live rows.
  const statusColor = status === 'Bridge' ? 'text-cyan' : 'text-green';
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
      <span className={`font-mono text-[10px] uppercase tracking-[0.06em] ${statusColor}`}>
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
