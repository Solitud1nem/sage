'use client';

import { useMemo, useState } from 'react';

import type { WirePlan, WireSubTask } from '@/hooks/use-composite-demo';
import { formatUsdc } from '@/lib/format-usdc';

/**
 * Editable variant of `plan-card`. Toggles in via the parent page when the
 * user clicks Edit on the plan-card. Save commits the edited plan back to
 * the caller (which then either re-displays the plan-card or runs Approve
 * immediately, depending on UX choice).
 *
 * v1 implementation notes (per M10.3.4):
 * - Reordering uses ↑/↓ arrow buttons. The PARENT-PLAN intent was native
 *   drag-and-drop, but adding a drag library (`@dnd-kit`) for one screen is
 *   excessive — arrow buttons are accessible-by-default and unblock the
 *   acceptance criterion. Future polish task in IDEAS.md if it matters.
 * - Executor selection: known production agents (Summarizer / Translator /
 *   Sentiment / Vision) pulled from `NEXT_PUBLIC_DEMO_*_ADDRESS` env vars,
 *   plus a "Custom" option that reveals a free-text input. Same pattern as
 *   `use-wallet-demo.ts` resolves executor addresses.
 * - Live total cost recomputed on every edit.
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

interface PlanEditorProps {
  initialPlan: WirePlan;
  onSave: (plan: WirePlan) => void;
  onDiscard: () => void;
}

export function PlanEditor({ initialPlan, onSave, onDiscard }: PlanEditorProps) {
  const [brief] = useState(initialPlan.brief);
  const [subtasks, setSubtasks] = useState<WireSubTask[]>(initialPlan.subtasks);
  const knownExecutors = useMemo(loadKnownExecutors, []);

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
            allIds={subtasks.map((s) => s.id).filter((id) => id !== sub.id)}
            knownExecutors={knownExecutors}
            canMoveUp={idx > 0}
            canMoveDown={idx < subtasks.length - 1}
            onMoveUp={() => move(idx, -1)}
            onMoveDown={() => move(idx, 1)}
            onRemove={() => remove(sub.id)}
            onUpdate={(patch) => update(sub.id, patch)}
          />
        ))}
      </ol>

      <div className="px-6 md:px-8 py-4 border-t border-border">
        <button
          type="button"
          onClick={add}
          className="h-9 px-3 rounded-[8px] border border-dashed border-border text-text-muted font-mono text-[12px] hover:text-text hover:border-text-muted transition-colors"
        >
          + Add sub-task
        </button>
      </div>

      <footer className="px-6 md:px-8 py-5 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            Total cost
          </div>
          <div className="font-mono text-[16px] text-text font-medium">
            {formatUsdc(totalCost.toString())}
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
  allIds: number[];
  knownExecutors: KnownExecutor[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onUpdate: (patch: { [K in keyof WireSubTask]?: WireSubTask[K] | undefined }) => void;
}

function SubTaskEditorRow({
  sub,
  allIds,
  knownExecutors,
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

  const matchedExecutor = knownExecutors.find(
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
        <div className="flex lg:flex-col gap-1">
          <IconButton onClick={onMoveUp} disabled={!canMoveUp} label="Move up">
            ↑
          </IconButton>
          <IconButton onClick={onMoveDown} disabled={!canMoveDown} label="Move down">
            ↓
          </IconButton>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Type">
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
          </Field>

          <Field label="Executor">
            <select
              value={executorMode === 'preset' ? matchedExecutor!.address : executorMode}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'custom') {
                  onUpdate({ executor_address: '0x' as `0x${string}` });
                } else if (v === 'unset') {
                  onUpdate({ executor_address: undefined });
                } else {
                  onUpdate({ executor_address: v as `0x${string}` });
                }
              }}
              className="w-full h-9 px-3 rounded-[8px] border border-border bg-[#0A0A0F] font-mono text-[12px] text-text focus:outline-none focus:border-cyan"
            >
              <option value="unset">— unassigned —</option>
              {knownExecutors.map((k) => (
                <option key={k.address} value={k.address}>
                  {k.label} ({shortAddr(k.address)})
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
          </Field>
        </div>
      </div>

      <div className="flex lg:flex-col gap-2 lg:items-end">
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove sub-task"
          className="h-9 w-9 rounded-[8px] border border-border text-text-subtle hover:text-pink hover:border-pink transition-colors font-mono"
          title="Remove"
        >
          ✕
        </button>
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
