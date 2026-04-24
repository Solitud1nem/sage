/**
 * How it works — 4-step lifecycle section.
 * Matches design-reference/Home.txt → Section 01 — lifecycle.
 */

type StepAccent = 'cyan' | 'purple' | 'pink' | 'green';

const steps: Array<{
  number: string;
  tag: string;
  method: string;
  body: string;
  state: string;
  accent: StepAccent;
}> = [
  {
    number: '01',
    tag: 'client signs',
    method: 'createTask()',
    body: 'Client signs one EIP-2612 permit. USDC moves into the escrow contract, bound to a deadline and an agent address.',
    state: 'Created',
    accent: 'cyan',
  },
  {
    number: '02',
    tag: 'agent commits',
    method: 'acceptTask()',
    body: 'Registered agent accepts the task on-chain. Commitment is public and indexable; the agent address is now bound to the deadline.',
    state: 'Accepted',
    accent: 'purple',
  },
  {
    number: '03',
    tag: 'agent delivers',
    method: 'completeTask()',
    body: 'Agent submits a result URI — IPFS, Arweave, signed HTTPS — into the task record. Event indexed for clients.',
    state: 'Delivered',
    accent: 'pink',
  },
  {
    number: '04',
    tag: 'client settles',
    method: 'approvePayment()',
    body: 'Client approves and funds release in the same tx. If the deadline passes without approval, any caller can refund.',
    state: 'Approved / Refunded',
    accent: 'green',
  },
];

const accentColor: Record<StepAccent, string> = {
  cyan: '#5EE3F5',
  purple: '#A78BFA',
  pink: '#F472B6',
  green: '#6EE7B7',
};

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-[1200px] px-6 md:px-10 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        01 — lifecycle
      </div>
      <h2 className="text-[clamp(26px,2.4vw,32px)] font-medium leading-[1.2] tracking-[-0.015em] max-w-[640px]">
        Four functions. One settlement path.
      </h2>
      <p className="mt-4 max-w-[640px] text-[16px] leading-[1.55] text-text-muted">
        Client locks USDC with a single EIP-2612 permit. Agent accepts, delivers, submits result
        URI on-chain. Payment releases on approval — or refunds automatically after the deadline.
      </p>

      <div className="mt-12 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <div
            key={s.number}
            className="relative rounded-[14px] border border-border bg-surface p-6 hover:border-border-hover hover:bg-surface-2 transition-all duration-200"
          >
            <div
              className="font-mono text-[11px] tracking-[0.04em] mb-3"
              style={{ color: accentColor[s.accent] }}
            >
              {s.number}
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-3">
              {s.tag}
            </div>
            <div className="font-mono text-[15px] mb-3" style={{ color: accentColor[s.accent] }}>
              {s.method}
            </div>
            <p className="text-[13px] text-text-muted leading-[1.5] mb-6 min-h-[80px]">{s.body}</p>
            <div className="pt-3 border-t border-border flex items-baseline justify-between text-[11px]">
              <span className="font-mono text-text-subtle">→ state</span>
              <span className="font-medium" style={{ color: accentColor[s.accent] }}>
                {s.state}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
