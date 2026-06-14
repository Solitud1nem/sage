'use client';

import { useMemo } from 'react';
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import type {
  SubTaskRuntime,
  SubTaskRunStatus,
  WireSubTask,
} from '@/hooks/use-composite-demo';

/**
 * DAG renderer for an in-flight composite plan. Nodes are positioned by
 * topological depth (sources at top, sinks at bottom); per-row x-offsets
 * are spread evenly. Layout is computed once per `subtasks` shape — runtime
 * status changes mutate node colors but not positions, so transitions are
 * smooth.
 *
 * Click any node to open the per-sub-task drawer (handled by parent page).
 *
 * Color map (per PARENT-PLAN.md M10.3.5):
 *   waiting    → muted slate
 *   created    → soft purple
 *   accepted   → cyan
 *   completed  → pink
 *   paid       → mint
 *   errored    → red
 *   disputed   → red
 */

const NODE_WIDTH = 220;
const NODE_HEIGHT = 96;
const COL_GAP = 40;
const ROW_GAP = 32;

interface PlanGraphProps {
  subtasks: readonly WireSubTask[];
  runtimes: Record<number, SubTaskRuntime>;
  onSubtaskClick?: (subId: number) => void;
}

interface PlanNodeData extends Record<string, unknown> {
  subId: number;
  type: string;
  status: SubTaskRunStatus;
}

type PlanNode = Node<PlanNodeData, 'plan'>;

const nodeTypes = { plan: PlanNode } as const;

export function PlanGraph({ subtasks, runtimes, onSubtaskClick }: PlanGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const levels = computeLevels(subtasks);
    const byLevel = new Map<number, number[]>();
    for (const s of subtasks) {
      const lvl = levels.get(s.id) ?? 0;
      const arr = byLevel.get(lvl) ?? [];
      arr.push(s.id);
      byLevel.set(lvl, arr);
    }

    const positions = new Map<number, { x: number; y: number }>();
    for (const [lvl, ids] of byLevel) {
      const total = ids.length;
      const rowWidth = total * NODE_WIDTH + (total - 1) * COL_GAP;
      const offsetX = -rowWidth / 2;
      ids.sort((a, b) => a - b);
      ids.forEach((id, idx) => {
        positions.set(id, {
          x: offsetX + idx * (NODE_WIDTH + COL_GAP),
          y: lvl * (NODE_HEIGHT + ROW_GAP),
        });
      });
    }

    const nodes: PlanNode[] = subtasks.map((s) => {
      const status = runtimes[s.id]?.status ?? 'waiting';
      return {
        id: String(s.id),
        type: 'plan' as const,
        position: positions.get(s.id) ?? { x: 0, y: 0 },
        data: {
          subId: s.id,
          type: s.type,
          status,
        },
        draggable: false,
      };
    });

    const edges: Edge[] = subtasks.flatMap((s) =>
      (s.depends_on ?? []).map((dep) => {
        const flowing =
          runtimes[s.id]?.status === 'created' || runtimes[s.id]?.status === 'accepted';
        return {
          id: `e-${dep}-${s.id}`,
          source: String(dep),
          target: String(s.id),
          animated: flowing,
          // Active flow takes the cyan→purple sweep (def injected below); idle
          // edges stay a flat slate so the live path reads at a glance.
          style: {
            stroke: flowing ? 'url(#plan-edge-flow)' : '#3a3a4a',
            strokeWidth: flowing ? 2 : 1,
          },
        };
      }),
    );

    return { nodes, edges };
  }, [subtasks, runtimes]);

  // Click handling lives at the ReactFlow level rather than inside the custom
  // node — xyflow's pan/select layer intercepts inner `onClick` on `<button>`
  // children, so the canonical pattern is `onNodeClick`.
  const handleNodeClick = onSubtaskClick
    ? (_: unknown, node: PlanNode) => onSubtaskClick(node.data.subId)
    : undefined;

  return (
    <div
      className="rounded-[14px] border border-border bg-surface overflow-hidden"
      style={{ height: 460 }}
    >
      {/* Gradient referenced by active edges' stroke. Zero-size svg — defs
          resolve document-wide by id, including inside xyflow's own svg. */}
      <svg aria-hidden width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="plan-edge-flow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5EE3F5" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        {...(handleNodeClick ? { onNodeClick: handleNodeClick } : {})}
      >
        <Background color="#1d1d27" gap={20} />
      </ReactFlow>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────

function PlanNode({ data }: NodeProps<PlanNode>) {
  const { color, label } = STATUS_DESCRIPTORS[data.status];
  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: '#0A0A0F',
        borderColor: color,
        boxShadow: data.status === 'created' || data.status === 'accepted'
          ? `0 0 16px ${color}33`
          : undefined,
      }}
      className={`rounded-[10px] border-2 px-4 py-3 transition-colors hover:bg-[#13131b] cursor-pointer ${
        data.status === 'paid' ? 'node-paid-pulse' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: 0 }} />
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
        #{data.subId}
      </div>
      <div className="font-mono text-[13px] text-text mt-1 truncate">{data.type}</div>
      <div
        className="font-mono text-[10px] uppercase tracking-[0.08em] mt-1.5"
        style={{ color }}
      >
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: 0 }} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────

const STATUS_DESCRIPTORS: Record<SubTaskRunStatus, { color: string; label: string }> = {
  waiting: { color: '#3a3a4a', label: 'waiting' },
  created: { color: '#A78BFA', label: 'created · accepting' },
  accepted: { color: '#5EE3F5', label: 'accepted · working' },
  completed: { color: '#F472B6', label: 'completed · awaiting approval' },
  'awaiting-review': { color: '#A78BFA', label: 'awaiting review' },
  paid: { color: '#6EE7B7', label: 'paid · settled' },
  errored: { color: '#F87171', label: 'errored' },
  disputed: { color: '#A78BFA', label: 'disputed · council' },
  refunded: { color: '#F59E0B', label: 'refunded' },
};

// ───────────────────────────────────────────────────────────────────────

const LEGEND_ORDER: SubTaskRunStatus[] = [
  'waiting',
  'created',
  'accepted',
  'completed',
  'awaiting-review',
  'paid',
  'disputed',
  'refunded',
  'errored',
];

/**
 * Status key for the node colors. Statuses present in the current run are
 * lit (full color + glow dot); the rest are dimmed so the legend doubles as
 * a live progress read-out, not just a static key.
 */
export function PlanLegend({ runtimes }: { runtimes: Record<number, SubTaskRuntime> }) {
  const active = new Set(Object.values(runtimes).map((r) => r.status));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
      {LEGEND_ORDER.map((status) => {
        const { color } = STATUS_DESCRIPTORS[status];
        const on = active.has(status);
        return (
          <span
            key={status}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-opacity"
            style={{ opacity: on ? 1 : 0.4 }}
          >
            <span
              className="w-[8px] h-[8px] rounded-full"
              style={{ background: color, boxShadow: on ? `0 0 8px ${color}66` : 'none' }}
              aria-hidden
            />
            <span style={{ color: on ? color : undefined }} className={on ? '' : 'text-text-subtle'}>
              {status}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Topological depth for each sub-task: 0 for sources (no deps), `max(dep) + 1`
 * for downstream. Cycles return their best-effort depth (caller should have
 * already validated; the backend's `validatePlan` rejects cycles before exec).
 */
function computeLevels(subtasks: readonly WireSubTask[]): Map<number, number> {
  const byId = new Map<number, WireSubTask>();
  for (const s of subtasks) byId.set(s.id, s);
  const memo = new Map<number, number>();

  function depth(id: number, stack: Set<number>): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) return 0; // cycle guard — shouldn't happen with validated plans
    const node = byId.get(id);
    if (!node) return 0;
    const deps = node.depends_on ?? [];
    if (deps.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    stack.add(id);
    const d = 1 + Math.max(...deps.map((dep) => depth(dep, stack)));
    stack.delete(id);
    memo.set(id, d);
    return d;
  }

  for (const s of subtasks) depth(s.id, new Set());
  return memo;
}
