'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, PublicClient } from 'viem';
import { parseEventLogs } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';

import { SAGE_CHAINS } from '@/chains/base';
import { useSageChain } from '@/hooks/use-sage-chain';
import { TaskStatus, taskEscrowAbi } from '@/lib/abi/task-escrow';
import { signUsdcPermit } from '@/lib/permit';
import { wagmiConfig } from '@/lib/wagmi';
import type {
  AgentMode,
  DemoEvent,
  DemoResult,
  DemoState,
  DemoStatus,
  Stage,
  StepName,
  StepStatus,
} from '@/hooks/use-demo-stream';

/**
 * Wallet-mode demo orchestration.
 *
 * Runs the same task lifecycle as Watch-live, but with the connected user
 * wallet as the task client — user signs each permit and writes createTask +
 * approvePayment themselves. Worker agents (summarizer, translator, vision,
 * sentiment) still operate externally.
 *
 * Per-mode signatures:
 *   pipeline  → 2 permits + 2 approvePayment writes (4 signatures)
 *   sentiment → 1 permit + 1 approvePayment (2 signatures)
 *   vision    → 1 permit + 1 approvePayment (2 signatures)
 */

const SUMMARIZER_ADDRESS = process.env.NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS as
  | Address
  | undefined;
const TRANSLATOR_ADDRESS = process.env.NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS as
  | Address
  | undefined;
const VISION_ADDRESS = process.env.NEXT_PUBLIC_DEMO_VISION_ADDRESS as Address | undefined;
const SENTIMENT_ADDRESS = process.env.NEXT_PUBLIC_DEMO_SENTIMENT_ADDRESS as
  | Address
  | undefined;

const INITIAL_STEPS: Record<StepName, StepStatus> = {
  createTask: 'waiting',
  acceptTask: 'waiting',
  completeTask: 'waiting',
  approvePayment: 'waiting',
};

const INITIAL_STATE: DemoState = {
  status: 'idle',
  mode: null,
  currentStage: null,
  steps: INITIAL_STEPS,
  txByStep: {},
  txHashes: [],
  events: [],
  result: null,
  error: null,
  demoRunId: null,
  chainId: null,
  explorerUrl: null,
  chainName: null,
};

export function useWalletDemo() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const { address } = useAccount();
  const chain = useSageChain();
  const publicClient = usePublicClient({ chainId: chain.chainId });
  const { data: walletClient } = useWalletClient({ chainId: chain.chainId });
  const eventIdRef = useRef(0);
  // Run generation counter (CR.14): every start()/reset() bumps it; a run's
  // async continuations (polling loops, post-await state writes) act only
  // while their captured token is current. A shared boolean cancel-flag is
  // not enough — a new start() would "un-cancel" the previous in-flight run.
  const runTokenRef = useRef(0);

  const start = useCallback(
    async (input: string, agentMode: AgentMode = 'pipeline') => {
      const token = ++runTokenRef.current;
      const isStale = () => runTokenRef.current !== token;

      if (!address || !publicClient || !walletClient) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Connect a wallet to continue.',
        }));
        return;
      }
      if (!chain.isSupported) {
        const supported = Object.values(SAGE_CHAINS)
          .map((c) => c.displayName)
          .join(' / ');
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: `Chain ${chain.chainId} isn't a Sage deployment. Switch to ${supported}.`,
        }));
        return;
      }

      // viem chain object for writeContract — lets viem enforce that the
      // wallet is actually on the expected chain instead of silently sending
      // the tx wherever the wallet happens to point (CR.14, was chain: null).
      const viemChain = wagmiConfig.chains.find((c) => c.id === chain.chainId);
      if (!viemChain) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: `Chain ${chain.chainId} is missing from the wagmi config — see lib/wagmi.ts.`,
        }));
        return;
      }

      // Per-mode address validation.
      const missingEnv: string[] = [];
      if (agentMode === 'pipeline') {
        if (!SUMMARIZER_ADDRESS) missingEnv.push('NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS');
        if (!TRANSLATOR_ADDRESS) missingEnv.push('NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS');
      } else if (agentMode === 'sentiment') {
        if (!SENTIMENT_ADDRESS) missingEnv.push('NEXT_PUBLIC_DEMO_SENTIMENT_ADDRESS');
      } else if (agentMode === 'vision') {
        if (!VISION_ADDRESS) missingEnv.push('NEXT_PUBLIC_DEMO_VISION_ADDRESS');
      }
      if (missingEnv.length > 0) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: `Missing env for ${agentMode} mode: ${missingEnv.join(', ')}`,
        }));
        return;
      }

      eventIdRef.current = 0;
      const startedAt = Date.now();
      setState({
        ...INITIAL_STATE,
        status: 'running',
        mode: agentMode,
        chainId: chain.chainId,
        chainName: chain.displayName,
        explorerUrl: chain.explorer,
      });
      logEvent('run_started', { mode: agentMode, client: address });

      try {
        let result: DemoResult;

        if (agentMode === 'pipeline') {
          // Stage 1 — summarize
          setStage('summarize');
          const summaryResult = await runStage({
            stage: 'summarize',
            client: address,
            executor: SUMMARIZER_ADDRESS!,
            brief: input,
          });

          // Stage 2 — translate (uses summary as input)
          setStage('translate');
          const translateResult = await runStage({
            stage: 'translate',
            client: address,
            executor: TRANSLATOR_ADDRESS!,
            brief: summaryResult.output,
          });

          result = {
            mode: 'pipeline',
            summary: summaryResult.output,
            translation: translateResult.output,
            txHashes: [...summaryResult.txHashes, ...translateResult.txHashes],
            durationMs: Date.now() - startedAt,
            totalUsdcSettled: (AMOUNT_PER_TASK * 2n).toString(),
          };
        } else if (agentMode === 'sentiment') {
          setStage('sentiment');
          const r = await runStage({
            stage: 'sentiment',
            client: address,
            executor: SENTIMENT_ADDRESS!,
            brief: input,
          });
          result = {
            mode: 'sentiment',
            sentiment: r.output,
            txHashes: r.txHashes,
            durationMs: Date.now() - startedAt,
            totalUsdcSettled: AMOUNT_PER_TASK.toString(),
          };
        } else {
          // vision
          setStage('vision');
          const r = await runStage({
            stage: 'vision',
            client: address,
            executor: VISION_ADDRESS!,
            brief: input,
          });
          result = {
            mode: 'vision',
            description: r.output,
            txHashes: r.txHashes,
            durationMs: Date.now() - startedAt,
            totalUsdcSettled: AMOUNT_PER_TASK.toString(),
          };
        }

        safeSetState((prev) => ({ ...prev, status: 'done', result }));
      } catch (err) {
        if (isStale()) return;
        const message = extractErrorMessage(err);
        logEvent('error', { message });
        safeSetState((prev) => ({ ...prev, status: 'error', error: message }));
      }

      /** State writes from async continuations no-op once the run is stale. */
      function safeSetState(action: React.SetStateAction<DemoState>) {
        if (!isStale()) setState(action);
      }

      async function runStage(params: {
        stage: Stage;
        client: Address;
        executor: Address;
        brief: string;
      }): Promise<{ output: string; txHashes: string[] }> {
        const txHashes: string[] = [];
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        // --- Step 1 — permit + createTask ------------------------------
        logEvent('stage_started', { stage: params.stage });
        activateStep('createTask');

        // wagmi's publicClient is a structurally-compatible PublicClient with
        // narrower generics than permit.ts expects; bridge through `unknown`
        // rather than `any` (AGENTS.md) — no behavioral effect.
        const permit = await signUsdcPermit(publicClient as unknown as PublicClient, walletClient!, {
          usdcAddress: chain.contracts.usdc,
          owner: params.client,
          spender: chain.contracts.taskEscrow,
          value: AMOUNT_PER_TASK,
          deadlineSeconds: 900, // 15 min permit window
        });

        const createTaskHash = await walletClient!.writeContract({
          address: chain.contracts.taskEscrow,
          abi: taskEscrowAbi,
          functionName: 'createTask',
          args: [params.executor, BigInt(deadline), AMOUNT_PER_TASK, params.brief, permit],
          chain: viemChain,
          account: params.client,
        });
        txHashes.push(createTaskHash);

        const createReceipt = await publicClient!.waitForTransactionReceipt({
          hash: createTaskHash,
        });

        // Extract taskId from TaskCreated event.
        const [taskCreatedLog] = parseEventLogs({
          abi: taskEscrowAbi,
          eventName: 'TaskCreated',
          logs: createReceipt.logs,
        });
        if (!taskCreatedLog) throw new Error('TaskCreated event not found in receipt');
        const taskId = taskCreatedLog.args.taskId;

        completeStep('createTask', createTaskHash);
        logEvent('task_created', {
          stage: params.stage,
          taskId: taskId.toString(),
          txHash: createTaskHash,
        });

        // --- Step 2 — wait for TaskAccepted ---------------------------
        activateStep('acceptTask');
        const acceptHash = await waitForStatus(taskId, TaskStatus.Accepted);
        completeStep('acceptTask', acceptHash);
        logEvent('task_accepted', { stage: params.stage, taskId: taskId.toString() });

        // --- Step 3 — wait for TaskCompleted --------------------------
        activateStep('completeTask');
        const { txHash: completeHash, resultUri } = await waitForCompletion(taskId);
        completeStep('completeTask', completeHash);
        logEvent('task_completed', {
          stage: params.stage,
          taskId: taskId.toString(),
          resultUri,
        });

        // --- Step 4 — approvePayment ----------------------------------
        activateStep('approvePayment');
        const approveHash = await walletClient!.writeContract({
          address: chain.contracts.taskEscrow,
          abi: taskEscrowAbi,
          functionName: 'approvePayment',
          args: [taskId],
          chain: viemChain,
          account: params.client,
        });
        txHashes.push(approveHash);
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
        completeStep('approvePayment', approveHash);
        logEvent('task_paid', {
          stage: params.stage,
          taskId: taskId.toString(),
          txHash: approveHash,
        });

        return {
          output: decodeResult(resultUri),
          txHashes,
        };
      }

      /** Poll task status transitions; returns tx hash of the transition if we can see it. */
      async function waitForStatus(taskId: bigint, target: TaskStatus): Promise<`0x${string}` | undefined> {
        const timeout = Date.now() + 180_000;
        while (Date.now() < timeout) {
          if (isStale()) throw new Error('cancelled');
          const task = (await publicClient!.readContract({
            address: chain.contracts.taskEscrow,
            abi: taskEscrowAbi,
            functionName: 'getTask',
            args: [taskId],
          })) as { status: TaskStatus };
          if (task.status >= target) return undefined;
          await sleep(3000);
        }
        throw new Error(`timeout waiting for task ${taskId} to reach status ${target}`);
      }

      async function waitForCompletion(taskId: bigint): Promise<{
        txHash: `0x${string}` | undefined;
        resultUri: string;
      }> {
        const timeout = Date.now() + 180_000;
        while (Date.now() < timeout) {
          if (isStale()) throw new Error('cancelled');
          const task = (await publicClient!.readContract({
            address: chain.contracts.taskEscrow,
            abi: taskEscrowAbi,
            functionName: 'getTask',
            args: [taskId],
          })) as { status: TaskStatus; resultUri: string };
          // Only Completed/Paid carry a usable result. The other terminals
          // (Disputed/Refunded/Expired/Split, all > Paid) have no deliverable to
          // approve — returning them as "complete" would drive approvePayment
          // into a revert. Fail loudly instead. (Code review 2026-06-09, web-M5.)
          if (task.status === TaskStatus.Completed || task.status === TaskStatus.Paid) {
            return { txHash: undefined, resultUri: task.resultUri };
          }
          if (task.status > TaskStatus.Paid) {
            throw new Error(
              `task ${taskId} ended in a non-completable state (status ${task.status})`,
            );
          }
          await sleep(3000);
        }
        throw new Error(`timeout waiting for task ${taskId} completion`);
      }

      function setStage(stage: Stage) {
        safeSetState((prev) => ({
          ...prev,
          currentStage: stage,
          steps: { ...INITIAL_STEPS },
          txByStep: {},
        }));
      }

      function activateStep(step: StepName) {
        safeSetState((prev) => ({ ...prev, steps: { ...prev.steps, [step]: 'active' } }));
      }

      function completeStep(step: StepName, tx?: `0x${string}`) {
        safeSetState((prev) => ({
          ...prev,
          steps: { ...prev.steps, [step]: 'complete' },
          txByStep: tx ? { ...prev.txByStep, [step]: tx } : prev.txByStep,
          txHashes: tx ? [...prev.txHashes, tx] : prev.txHashes,
        }));
      }

      function logEvent(event: string, data: Record<string, unknown>) {
        eventIdRef.current += 1;
        const ev: DemoEvent = { id: eventIdRef.current, event, data, receivedAt: Date.now() };
        safeSetState((prev) => ({ ...prev, events: [...prev.events, ev] }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, publicClient, walletClient, chain.chainId],
  );

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  useEffect(
    () => () => {
      runTokenRef.current += 1;
    },
    [],
  );

  return { ...state, start, reset };
}

// ── Constants + helpers ─────────────────────────────────────────────
const AMOUNT_PER_TASK = 1_000n; // 0.001 USDC (6 decimals)

function decodeResult(resultUri: string): string {
  if (resultUri.startsWith('data:text/plain,')) {
    return decodeURIComponent(resultUri.replace('data:text/plain,', ''));
  }
  // TODO: IPFS/HTTPS fetch once we have public agents emitting those.
  return resultUri;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // viem errors often have a `.shortMessage` that's more user-friendly.
    const short = (err as Error & { shortMessage?: string }).shortMessage;
    return short ?? err.message;
  }
  return String(err);
}

export type { DemoStatus };
