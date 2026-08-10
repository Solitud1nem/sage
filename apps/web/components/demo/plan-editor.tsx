'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  fetchRegistryAgents,
  fetchReputation,
  type RegistryAgent,
  type WirePlan,
  type WireSubTask,
} from '@/hooks/use-composite-demo';
import { formatUsdc, type Settlement } from '@/lib/format-usdc';
import { settlementOf } from '@/chains/base';

/**
 * Editable variant of `plan-card`. Toggles in via the parent page when the
 * user clicks Edit on the plan-card. Save commits the edited plan back to
 * the caller (which then either re-displays the plan-card or runs Approve
 * immediately, depending on UX choice).
 *
 * Two editing shapes (M13.1.1):
 *   - Composite (LLM) plans: full editing — add / remove / reorder / type /
 *     depends_on, plus per-subtask fields.
 *   - `locked` template plans (website / research): the pipeline structure is
 *     fixed because evaluator wiring (`evaluates`) and the dependency DAG are
 *     load-bearing. Structure is read-only; the user still reassigns the
 *     executor and tweaks spec / cost / deadline. This restores the editing
 *     pillar (ADR-0007) to those pipelines without letting an edit break the
 *     qa-website / fact-checker wiring (ADR-0022 / ADR-0023).
 *
 * Executor selection (M13.1.1): candidates come from the chain's V2 registry
 * (GET /api/demo/composite/agents) filtered by each sub-task's capability —
 * the env-var four were the only executors the editor used to know, none of
 * which serve the website/research pipelines. Registry fetch is best-effort;
 * on failure the editor falls back to the env-var executors plus a free-text
 * "Custom address…" field.
 *
 * Reputation ranking (M13.1.2): candidates are ordered best-reputation first
 * (tiebreak cheapest), mirroring the backend resolver
 * (`registry-resolver.pickAgentForCapability`); the score is shown in the
 * label and the top pick marked. An unassigned sub-task is pre-filled with the
 * best candidate. Reputation fetch is best-effort — an empty map degrades to
 * the registry's own order (neutral ranking), never blocking the editor.
 */

const COMMON_TYPES = [
  'research-web',
  'summarize-text',
  'translate-text',
  'sentiment-text',
  'describe-image',
  'compare',
  'clarify-with-user',
];

interface KnownExecutor {
  label: string;
  address: `0x${string}`;
}

function loadKnownExecutors(): KnownExecutor[] {
  const candidates: Array<[string, string | undefined]> = [
    ['Summarizer', process.env.NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS],
    ['Translator', process.env.NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS],
    ['Sentiment', process.env.NEXT_PUBLIC_DEMO_SENTIMENT_ADDRESS],
    ['Vision', process.env.NEXT_PUBLIC_DEMO_VISION_ADDRESS],
  ];
  return candidates.flatMap(([label, addr]) =>
    addr && /^0x[a-fA-F0-9]{40}$/.test(addr)
      ? [{ label, address: addr as `0x${string}` }]
      : [],
  );
}

interface ExecutorOption {
  label: string;
  address: `0x${string}`;
}

/** Parse a USDC-base-unit decimal string to bigint; null on malformed input. */
function safeBig(s: string): bigint | null {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Build the executor dropdown options for a sub-task of capability `type`.
 * Priority: registry agents that declare this exact capability → (if none)
 * any registry agent labelled by its capability → env-var known executors.
 * Deduped by address. The caller always appends "unassigned" / "custom".
 *
 * Options are ranked best-reputation first, tiebreak cheapest — the same order
 * `registry-resolver.pickAgentForCapability` uses server-side. Unknown agents
 * score the neutral 0.5, so with no reputation data the order falls back to the
 * registry's own sequence. When any candidate has real history the label shows
 * `rep NN%` and the top pick gets a ★.
 */
function executorOptionsFor(
  type: string,
  registryAgents: readonly RegistryAgent[],
  envKnown: readonly KnownExecutor[],
  reputation: ReadonlyMap<string, number>,
  settlement?: Settlement,
): ExecutorOption[] {
  const NEUTRAL = 0.5;
  interface Cand {
    label: string;
    address: `0x${string}`;
    price: bigint | null;
    score: number;
  }
  const cands: Cand[] = [];
  const seen = new Set<string>();
  const push = (label: string, address: `0x${string}`, price: bigint | null) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cands.push({ label, address, price, score: reputation.get(key) ?? NEUTRAL });
  };

  for (const a of registryAgents) {
    const cap = a.capabilities.find((c) => c.name === type);
    if (cap)
      push(
        `${type} · ${shortAddr(a.address)} · ${formatUsdc(cap.price, settlement)}`,
        a.address,
        safeBig(cap.price),
      );
  }
  // No exact-capability match (e.g. a composite plan whose `type` is a free
  // descriptor): still offer every registry agent so the dropdown isn't empty.
  if (cands.length === 0) {
    for (const a of registryAgents) {
      const cap = a.capabilities[0];
      push(
        cap ? `${cap.name} · ${shortAddr(a.address)}` : shortAddr(a.address),
        a.address,
        cap ? safeBig(cap.price) : null,
      );
    }
  }
  // Env-var executors are a last-resort fallback ONLY when the registry gave
  // us nothing at all (backend not deployed, or a chain without a V2 registry
  // such as Arc). When the registry is live it is authoritative — the legacy
  // four are nonsensical options for a copywrite / web-search step.
  if (cands.length === 0) {
    for (const k of envKnown) push(`${k.label} (${shortAddr(k.address)})`, k.address, null);
  }

  // Rank by reputation desc, tiebreak price asc — mirrors the backend resolver.
  cands.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.price !== null && y.price !== null && x.price !== y.price) return x.price < y.price ? -1 : 1;
    return 0;
  });

  // Only annotate with rep when at least one candidate has real settled history
  // (otherwise every option is a neutral 0.5 and "rep 50%" is just noise).
  const hasHistory = cands.some((c) => reputation.has(c.address.toLowerCase()));
  return cands.map((c, i) => ({
    label: hasHistory ? `${c.label} · rep ${Math.round(c.score * 100)}%${i === 0 ? ' ★' : ''}` : c.label,
    address: c.address,
  }));
}

interface PlanEditorProps {
  initialPlan: WirePlan;
  /** Chain whose V2 registry supplies executor candidates. */
  chainId: number;
  /**
   * Fixed-template plan (website / research): lock structure (no add / remove /
   * reorder, read-only type & depends_on & evaluator wiring); keep per-subtask
   * fields editable. Default false → full editing for composite plans.
   */
  locked?: boolean;
  onSave: (plan: WirePlan) => void;
  onDiscard: () => void;
}

export function PlanEditor({
  initialPlan,
  chainId,
  locked = false,
  onSave,
  onDiscard,
}: PlanEditorProps) {
  const [brief] = useState(initialPlan.brief);
  const [subtasks, setSubtasks] = useState<WireSubTask[]>(initialPlan.subtasks);
  // Settlement-token metadata for price labels (ADR-0026): WMON on Monad.
  // Memoized so effects depending on it don't re-fire on identity churn.
  const settlement = useMemo(() => settlementOf(chainId), [chainId]);
  const envKnown = useMemo(loadKnownExecutors, []);
  const [registryAgents, setRegistryAgents] = useState<RegistryAgent[]>([]);
  const [reputation, setReputation] = useState<ReadonlyMap<string, number>>(new Map());

  useEffect(() => {
    let live = true;
    void fetchRegistryAgents(chainId).then((agents) => {
      if (live) setRegistryAgents(agents);
    });
    // Reputation is gateway-native and Base-only, so it isn't chain-scoped; we
    // still refetch on chain change (harmless) to keep the two in lockstep.
    void fetchReputation(chainId).then((r) => {
      if (live) setReputation(r);
    });
    return () => {
      live = false;
    };
  }, [chainId]);

  // Pre-fill the best-reputation executor for any sub-task the plan left
  // unassigned (M13.1.2). Runs only when the registry/reputation data lands;
  // it touches empty slots only, so it never overrides a template's or the
  // user's explicit choice and cannot loop (a filled slot is skipped next pass).
  useEffect(() => {
    if (registryAgents.length === 0) return;
    setSubtasks((prev) =>
      prev.map((s) => {
        if (s.executor_address) return s;
        const best = executorOptionsFor(s.type, registryAgents, envKnown, reputation, settlement)[0];
        return best ? { ...s, executor_address: best.address } : s;
      }),
    );
  }, [registryAgents, reputation, envKnown, settlement]);

  const totalCost = useMemo(
    () =>
      subtasks.reduce((acc, s) => {
        try {
          return acc + BigInt(s.estimated_cost_units);
        } catch {
          return acc;
        }
      }, 0n),
    [subtasks],
  );

  const move = (idx: number, dir: -1 | 1) => {
    setSubtasks((prev) => {
      const next = prev.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[idx]!;
      const b = next[target]!;
      next[idx] = b;
      next[target] = a;
      return next;
    });
  };

  const remove = (id: number) => {
    setSubtasks((prev) =>
      prev
        .filter((s) => s.id !== id)
        // Strip dropped id from any remaining depends_on lists.
        .map((s) =>
          s.depends_on
            ? { ...s, depends_on: s.depends_on.filter((d) => d !== id) }
            : s,
        ),
    );
  };

  const add = () => {
    setSubtasks((prev) => {
      const nextId = (prev.reduce((max, s) => Math.max(max, s.id), 0) || 0) + 1;
      const fresh: WireSubTask = {
        id: nextId,
        type: 'summarize-text',
        estimated_cost_units: '100000',
        deadline_offset_s: 600,
        spec: '',
      };
      return [...prev, fresh];
    });
  };

  // Allow explicit `undefined` to delete an optional field — `Partial<WireSubTask>`
  // alone is rejected under `exactOptionalPropertyTypes`. The patch loop below
  // strips undefined keys instead of writing them.
  type SubTaskPatch = { [K in keyof WireSubTask]?: WireSubTask[K] | undefined };

  const update = (id: number, patch: SubTaskPatch) => {
    setSubtasks((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next: Record<string, unknown> = { ...s };
        for (const key of Object.keys(patch) as Array<keyof SubTaskPatch>) {
          const value = patch[key];
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        return next as unknown as WireSubTask;
      }),
    );
  };

  const onSavePressed = () => {
    onSave({
      ...initialPlan,
      brief,
      subtasks,
      estimated_total_cost_units: totalCost.toString(),
    });
  };

  return (
    <section className="rounded-[14px] border border-border bg-surface overflow-hidden">
      <header className="px-6 md:px-8 pt-6 pb-4 border-b border-border">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-mono text-[13px]">
            <span className="text-text-subtle">02</span>{' '}
            <span className="font-medium">Edit plan</span>
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            {subtasks.length} sub-task{subtasks.length === 1 ? '' : 's'}
          </span>
        </div>
        {locked && (
          <p className="mb-3 text-[12px] leading-[1.55] text-text-muted">
            This is a fixed pipeline — its steps and evaluator wiring stay as-is. You can reassign
            executors and adjust the spec, cost, and deadline of each step.
          </p>
        )}
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
          Brief (read-only)
        </div>
        <p className="text-[13px] leading-[1.55] text-text-muted">{brief}</p>
      </header>

      <ol className="divide-y divide-border">
        {subtasks.map((sub, idx) => (
          <SubTaskEditorRow
            key={sub.id}
            sub={sub}
            locked={locked}
            executorOptions={executorOptionsFor(sub.type, registryAgents, envKnown, reputation, settlement)}
            allIds={subtasks.map((s) => s.id).filter((id) => id !== sub.id)}
            canMoveUp={idx > 0}
            canMoveDown={idx < subtasks.length - 1}
            onMoveUp={() => move(idx, -1)}
            onMoveDown={() => move(idx, 1)}
            onRemove={() => remove(sub.id)}
            onUpdate={(patch) => update(sub.id, patch)}
          />
        ))}
      </ol>

      {!locked && (
        <div className="px-6 md:px-8 py-4 border-t border-border">
          <button
            type="button"
            onClick={add}
            className="h-9 px-3 rounded-[8px] border border-dashed border-border text-text-muted font-mono text-[12px] hover:text-text hover:border-text-muted transition-colors"
          >
            + Add sub-task
          </button>
        </div>
      )}

      <footer className="px-6 md:px-8 py-5 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            Total cost
          </div>
          <div className="font-mono text-[16px] text-text font-medium">
            {formatUsdc(totalCost.toString(), settlement)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text-muted hover:text-text hover:border-text-muted transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSavePressed}
            disabled={subtasks.length === 0}
            className="h-9 px-5 rounded-[8px] bg-cyan text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#7AEAF8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save changes
          </button>
        </div>
      </footer>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────

interface SubTaskEditorRowProps {
  sub: WireSubTask;
  locked: boolean;
  executorOptions: ExecutorOption[];
  allIds: number[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onUpdate: (patch: { [K in keyof WireSubTask]?: WireSubTask[K] | undefined }) => void;
}

function SubTaskEditorRow({
  sub,
  locked,
  executorOptions,
  allIds,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdate,
}: SubTaskEditorRowProps) {
  // "Depends on" edits buffer locally and commit on blur/Enter. Parsing on
  // every keystroke ate commas and partial ids: the parsed value fed straight
  // back into the controlled input, so "1," collapsed to "1" mid-typing.
  const [dependsDraft, setDependsDraft] = useState<string | null>(null);

  const matchedExecutor = executorOptions.find(
    (k) => k.address.toLowerCase() === sub.executor_address?.toLowerCase(),
  );
  const executorMode: 'preset' | 'custom' | 'unset' = matchedExecutor
    ? 'preset'
    : sub.executor_address
      ? 'custom'
      : 'unset';

  return (
    <li className="px-6 md:px-8 py-4 grid grid-cols-1 lg:grid-cols-[40px_1fr_auto] gap-x-4 gap-y-3 items-start">
      <div className="flex lg:flex-col items-center gap-1">
        <span className="font-mono text-[13px] text-text-subtle">#{sub.id}</span>
        {!locked && (
          <div className="flex lg:flex-col gap-1">
            <IconButton onClick={onMoveUp} disabled={!canMoveUp} label="Move up">
              ↑
            </IconButton>
            <IconButton onClick={onMoveDown} disabled={!canMoveDown} label="Move down">
              ↓
            </IconButton>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Type">
            {locked ? (
              <div className="flex flex-wrap items-center gap-2 h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F]/40 font-mono text-[12px] text-text-muted">
                <span className="text-text">{sub.type}</span>
                {sub.evaluates !== undefined && (
                  <span
                    className="font-mono text-[11px] px-2 py-[1px] rounded-full border"
                    style={{ borderColor: '#A78BFA', color: '#A78BFA' }}
                    title="Paid evaluator: its verdict releases or disputes the judged step's payment."
                  >
                    ⚖ judges #{sub.evaluates}
                  </span>
                )}
              </div>
            ) : (
              <>
                <input
                  list={`type-suggestions-${sub.id}`}
                  value={sub.type}
                  onChange={(e) => onUpdate({ type: e.target.value })}
                  className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text focus:outline-none focus:border-cyan"
                />
                <datalist id={`type-suggestions-${sub.id}`}>
                  {COMMON_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field label="Executor">
            <select
              value={executorMode === 'preset' ? matchedExecutor!.address : executorMode}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'custom') {
                  onUpdate({ executor_address: '0x' });
                } else if (v === 'unset') {
                  onUpdate({ executor_address: undefined });
                } else {
                  onUpdate({ executor_address: v as `0x${string}` });
                }
              }}
              className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text focus:outline-none focus:border-cyan"
            >
              <option value="unset">— unassigned —</option>
              {executorOptions.map((k) => (
                <option key={k.address} value={k.address}>
                  {k.label}
                </option>
              ))}
              <option value="custom">Custom address…</option>
            </select>
          </Field>
        </div>

        {executorMode === 'custom' && (
          <Field label="Custom address">
            <input
              value={sub.executor_address ?? ''}
              onChange={(e) =>
                onUpdate({ executor_address: e.target.value as `0x${string}` })
              }
              placeholder="0x…"
              className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text focus:outline-none focus:border-cyan"
              spellCheck={false}
            />
          </Field>
        )}

        <Field label="Spec">
          <textarea
            value={sub.spec}
            onChange={(e) => onUpdate({ spec: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text leading-[1.5] focus:outline-none focus:border-cyan"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Cost (USDC base units)">
            <input
              value={sub.estimated_cost_units}
              onChange={(e) =>
                onUpdate({ estimated_cost_units: e.target.value.replace(/\D/g, '') || '0' })
              }
              inputMode="numeric"
              className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text focus:outline-none focus:border-cyan"
            />
          </Field>
          <Field label="Deadline (s)">
            <input
              type="number"
              min={0}
              value={sub.deadline_offset_s}
              onChange={(e) =>
                onUpdate({ deadline_offset_s: Math.max(0, Number(e.target.value) || 0) })
              }
              className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text focus:outline-none focus:border-cyan"
            />
          </Field>
          <Field label="Depends on">
            {locked ? (
              <div className="w-full h-9 px-3 inline-flex items-center rounded-[8px] border border-border bg-[#0A0A0F]/40 font-mono text-[12px] text-text-muted">
                {(sub.depends_on ?? []).length > 0
                  ? (sub.depends_on ?? []).map((d) => `#${d}`).join(', ')
                  : '—'}
              </div>
            ) : (
              <input
                value={dependsDraft ?? (sub.depends_on ?? []).join(',')}
                onChange={(e) => setDependsDraft(e.target.value)}
                onBlur={() => {
                  if (dependsDraft === null) return;
                  const parsed = dependsDraft
                    .split(',')
                    .map((s) => parseInt(s.trim(), 10))
                    .filter((n) => Number.isFinite(n) && allIds.includes(n));
                  onUpdate({ depends_on: parsed.length > 0 ? parsed : undefined });
                  setDependsDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder={`e.g. ${allIds.slice(0, 2).join(',') || '(none)'}`}
                className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text-muted focus:outline-none focus:border-cyan"
              />
            )}
          </Field>
        </div>
      </div>

      <div className="flex lg:flex-col gap-2 lg:items-end">
        {!locked && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove sub-task"
            className="h-9 w-9 rounded-[8px] border border-border text-text-subtle hover:text-pink hover:border-pink transition-colors font-mono"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-6 w-6 inline-flex items-center justify-center rounded-[6px] border border-border text-text-subtle hover:text-text hover:border-text-muted disabled:opacity-25 disabled:cursor-not-allowed font-mono text-[11px]"
    >
      {children}
    </button>
  );
}

function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
