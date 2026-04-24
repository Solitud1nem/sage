'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { parseEventLogs } from 'viem';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';

import { BASE_MAINNET } from '@/chains/base';
import { TaskStatus, taskEscrowAbi } from '@/lib/abi/task-escrow';
import { signUsdcPermit } from '@/lib/permit';
import type {
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
 * Runs the full Orchestrator → Summarizer → Translator lifecycle but with
 * the connected user wallet as the task client — user signs each permit and
 * writes createTask + approvePayment themselves. Worker agents (summarizer,
 * translator) still operate externally as before.
 *
 * 4 signatures per full run (worst case):
 *   1. signTypedData permit for summarize (0.001 USDC)
 *   2. writeContract createTask(summarize)
 *   3. signTypedData permit for translate
 *   4. writeContract createTask(translate)
 *   + implicit 2 approvePayment writes after each TaskCompleted.
 *
 * Advanced wallets (EIP-5792 wallet_sendCalls) could batch the permit+create
 * pair, but we keep it sequential here for clarity.
 */

const SUMMARIZER_ADDRESS = process.env.NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS as
  | Address
  | undefined;
const TRANSLATOR_ADDRESS = process.env.NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS as
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
  currentStage: null,
  steps: INITIAL_STEPS,
  txByStep: {},
  txHashes: [],
  events: [],
  result: null,
  error: null,
  demoRunId: null,
};

export function useWalletDemo() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: BASE_MAINNET.chainId });
  const { data: walletClient } = useWalletClient({ chainId: BASE_MAINNET.chainId });
  const eventIdRef = useRef(0);
  const cancelledRef = useRef(false);

  const start = useCallback(
    async (text: string) => {
      if (!address || !publicClient || !walletClient) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Connect a wallet to continue.',
        }));
        return;
      }
      if (!SUMMARIZER_ADDRESS || !TRANSLATOR_ADDRESS) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error:
            'Registered demo agents not configured. Set NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS and NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS.',
        }));
        return;
      }

      cancelledRef.current = false;
      eventIdRef.current = 0;
      setState({ ...INITIAL_STATE, status: 'running' });
      logEvent('run_started', { mode: 'wallet', client: address });

      try {
        // Stage 1 — summarize
        setStage('summarize');
        const summaryResult = await runStage({
          stage: 'summarize',
          client: address,
          executor: SUMMARIZER_ADDRESS,
          brief: text,
        });

        // Stage 2 — translate (uses summary as input)
        setStage('translate');
        const translateResult = await runStage({
          stage: 'translate',
          client: address,
          executor: TRANSLATOR_ADDRESS,
          brief: summaryResult.output,
        });

        const result: DemoResult = {
          summary: summaryResult.output,
          translation: translateResult.output,
          txHashes: [...summaryResult.txHashes, ...translateResult.txHashes],
          durationMs: Date.now() - (state.events[0]?.receivedAt ?? Date.now()),
          totalUsdcSettled: (AMOUNT_PER_TASK * 2n).toString(),
        };

        setState((prev) => ({ ...prev, status: 'done', result }));
      } catch (err) {
        if (cancelledRef.current) return;
        const message = extractErrorMessage(err);
        logEvent('error', { message });
        setState((prev) => ({ ...prev, status: 'error', error: message }));
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

        const permit = await signUsdcPermit(publicClient!, walletClient!, {
          usdcAddress: BASE_MAINNET.contracts.usdc,
          owner: params.client,
          spender: BASE_MAINNET.contracts.taskEscrow,
          value: AMOUNT_PER_TASK,
          deadlineSeconds: 900, // 15 min permit window
        });

        const createTaskHash = await walletClient!.writeContract({
          address: BASE_MAINNET.contracts.taskEscrow,
          abi: taskEscrowAbi,
          functionName: 'createTask',
          args: [params.executor, BigInt(deadline), AMOUNT_PER_TASK, params.brief, permit],
          chain: null,
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
        const taskId = taskCreatedLog.args.taskId as bigint;

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
          address: BASE_MAINNET.contracts.taskEscrow,
          abi: taskEscrowAbi,
          functionName: 'approvePayment',
          args: [taskId],
          chain: null,
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
          if (cancelledRef.current) throw new Error('cancelled');
          const task = (await publicClient!.readContract({
            address: BASE_MAINNET.contracts.taskEscrow,
            abi: taskEscrowAbi,
            functionName: 'getTask',
            args: [taskId],
          })) as { status: number };
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
          if (cancelledRef.current) throw new Error('cancelled');
          const task = (await publicClient!.readContract({
            address: BASE_MAINNET.contracts.taskEscrow,
            abi: taskEscrowAbi,
            functionName: 'getTask',
            args: [taskId],
          })) as { status: number; resultUri: string };
          if (task.status >= TaskStatus.Completed) {
            return { txHash: undefined, resultUri: task.resultUri };
          }
          await sleep(3000);
        }
        throw new Error(`timeout waiting for task ${taskId} completion`);
      }

      function setStage(stage: Stage) {
        setState((prev) => ({
          ...prev,
          currentStage: stage,
          steps: { ...INITIAL_STEPS },
          txByStep: {},
        }));
      }

      function activateStep(step: StepName) {
        setState((prev) => ({ ...prev, steps: { ...prev.steps, [step]: 'active' } }));
      }

      function completeStep(step: StepName, tx?: `0x${string}`) {
        setState((prev) => ({
          ...prev,
          steps: { ...prev.steps, [step]: 'complete' },
          txByStep: tx ? { ...prev.txByStep, [step]: tx } : prev.txByStep,
          txHashes: tx ? [...prev.txHashes, tx] : prev.txHashes,
        }));
      }

      function logEvent(event: string, data: Record<string, unknown>) {
        eventIdRef.current += 1;
        const ev: DemoEvent = { id: eventIdRef.current, event, data, receivedAt: Date.now() };
        setState((prev) => ({ ...prev, events: [...prev.events, ev] }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, publicClient, walletClient],
  );

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setState(INITIAL_STATE);
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
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
