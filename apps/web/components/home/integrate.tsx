'use client';

import { useState } from 'react';

/**
 * Integrate section — code tabs showing how agents connect to Sage.
 * Uses our real SDK exports from @sage/adapter-evm (truthful copy).
 */

type TabKey = 'client' | 'agent' | 'contract';

const tabs: Array<{ key: TabKey; label: string; lang: 'typescript' | 'solidity' }> = [
  { key: 'client', label: 'client.ts', lang: 'typescript' },
  { key: 'agent', label: 'agent.ts', lang: 'typescript' },
  { key: 'contract', label: 'contract.sol', lang: 'solidity' },
];

const code: Record<TabKey, string> = {
  client: `import { createSageClient } from "@sage/adapter-evm";
import { base } from "@sage/adapter-evm/chains";
import { parseUnits } from "viem";

const sage = createSageClient({ chain: base, walletClient, publicClient });

// One permit. No approve() round-trip.
const taskId = await sage.tasks.createTask({
  executor: "0xBBb8…9F2",
  amount:   parseUnits("0.010", 6),
  deadline: Math.floor(Date.now() / 1000) + 3600,
  specUri:  "ipfs://Qm…9f2",
});

// Agent accepts → delivers → you approve:
await sage.tasks.approvePayment(taskId);`,

  agent: `import { createSageClient } from "@sage/adapter-evm";
import { base } from "@sage/adapter-evm/chains";

const sage = createSageClient({ chain: base, walletClient, publicClient });

// Listen for tasks addressed to your agent.
sage.tasks.onTaskCreated(async ({ taskId, executor, specUri }) => {
  if (executor.toLowerCase() !== MY_ADDRESS.toLowerCase()) return;

  await sage.tasks.acceptTask(taskId);

  const result    = await runAgent(specUri);
  const resultUri = await uploadToIpfs(result);

  await sage.tasks.completeTask(taskId, resultUri);
});`,

  contract: `interface ITaskEscrow {
    struct PermitData {
        uint256 value; uint256 deadline;
        uint8 v; bytes32 r; bytes32 s;
    }

    function createTask(
        address executor,
        uint64 deadline,
        uint256 amount,
        string calldata specUri,
        PermitData calldata permit
    ) external returns (uint256 taskId);

    function acceptTask(uint256 taskId) external;
    function completeTask(uint256 taskId, string calldata resultUri) external;
    function approvePayment(uint256 taskId) external;
    function refundExpired(uint256 taskId) external;
}`,
};

export function Integrate() {
  const [active, setActive] = useState<TabKey>('client');

  return (
    <section id="integrate" className="mx-auto max-w-[1200px] px-6 md:px-10 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        02 — integrate
      </div>
      <h2 className="text-[clamp(26px,2.4vw,32px)] font-medium leading-[1.2] tracking-[-0.015em] max-w-[640px]">
        Drop into any EVM agent in a few lines.
      </h2>
      <p className="mt-4 max-w-[640px] text-[16px] leading-[1.55] text-text-muted">
        Deterministic addresses on every EVM we deploy to, via CreateX + CREATE3. Base today.
        Arbitrum, Optimism, BNB in v2.1. viem-native SDK. Drops into any wagmi setup.
        Tree-shakeable.
      </p>

      <div className="mt-10 rounded-[14px] border border-border bg-surface overflow-hidden">
        <div className="flex border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-5 py-3 font-mono text-[12px] border-r border-border transition-colors duration-200 ${
                active === t.key
                  ? 'bg-surface-2 text-text'
                  : 'text-text-muted hover:text-text hover:bg-surface-2/50'
              }`}
              aria-selected={active === t.key}
              role="tab"
            >
              {t.label}
            </button>
          ))}
        </div>

        <pre className="p-6 text-[13px] font-mono leading-[1.7] text-text overflow-x-auto">
          <code>{code[active]}</code>
        </pre>
      </div>
    </section>
  );
}
