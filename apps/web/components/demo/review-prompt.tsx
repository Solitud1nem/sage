'use client';

import { useState } from 'react';

import type { SubTaskRuntime, WireSubTask } from '@/hooks/use-composite-demo';

/**
 * Review gate prompt (ADR-0019). Shown when a sub-task completes in review
 * mode and pauses before payment. The user inspects the result, then either:
 *
 *   - **Approve & pay** — `submitReview({ subId, action: 'approve' })`; the
 *     orchestrator calls approvePayment.
 *   - **Dispute** — opens a reason box, then
 *     `submitReview({ subId, action: 'dispute', reason })`; the orchestrator
 *     raises the dispute on-chain, the council judges it, and the arbiter
 *     resolves it (Paid / Refunded / Split).
 *
 * If neither is chosen within the review window the backend auto-approves
 * (silence = acceptance, mirroring on-chain auto-release-after-grace).
 */

interface ReviewPromptProps {
  subtask: WireSubTask;
  runtime: SubTaskRuntime | undefined;
  onDecision: (opts: { subId: number; action: 'approve' | 'dispute'; reason?: string }) => Promise<void>;
}

export function ReviewPrompt({ subtask, runtime, onDecision }: ReviewPromptProps) {
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const result = runtime?.result ?? '';

  const approve = async () => {
    setSubmitting(true);
    await onDecision({ subId: subtask.id, action: 'approve' });
  };
  const dispute = async () => {
    setSubmitting(true);
    const trimmed = reason.trim();
    await onDecision({
      subId: subtask.id,
      action: 'dispute',
      ...(trimmed ? { reason: trimmed } : {}),
    });
  };

  return (
    <section className="rounded-[14px] border border-[#A78BFA] bg-surface p-6 md:p-7">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#A78BFA] mb-1">
        Review · sub-task #{subtask.id}
      </div>
      <p className="text-[13px] text-text-muted mb-4">
        The executor submitted a result. Approve to release payment, or dispute to send it to the
        council. No action within the window auto-approves.
      </p>

      <div className="rounded-[10px] border border-border bg-[#0A0A0F] p-4 mb-4 max-h-[260px] overflow-auto">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle mb-2">
          {subtask.type} · result
        </div>
        <pre className="whitespace-pre-wrap break-words text-[13px] text-text leading-[1.55] font-sans">
          {result || '(no result text)'}
        </pre>
      </div>

      {!disputing ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void approve()}
            className="h-10 px-5 rounded-[8px] bg-cyan text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#7AEAF8] transition-colors disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'Approve & pay →'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => setDisputing(true)}
            className="h-10 px-5 rounded-[8px] border border-[#A78BFA] text-[#A78BFA] font-mono text-[12px] hover:bg-[#A78BFA]/10 transition-colors disabled:opacity-40"
          >
            Dispute…
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this result unacceptable? (the council reads this)"
            className="w-full px-4 py-3 rounded-[10px] border border-border bg-[#0A0A0F] text-[13px] text-text leading-[1.55] focus:outline-none focus:border-[#A78BFA]"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void dispute()}
              className="h-10 px-5 rounded-[8px] bg-[#A78BFA] text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#B9A4FB] transition-colors disabled:opacity-40"
            >
              {submitting ? 'Sending to council…' : 'Send to council →'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setDisputing(false)}
              className="h-10 px-5 rounded-[8px] border border-border text-text font-mono text-[12px] hover:border-cyan transition-colors disabled:opacity-40"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
