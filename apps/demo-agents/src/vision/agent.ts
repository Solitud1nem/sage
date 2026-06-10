/**
 * Vision agent — dual-mode capability.
 *
 *   - 3-mode `/demo` path: specUri = raw image URL (`http(s)://...`) →
 *     describe (existing behavior, unchanged for back-compat).
 *
 *   - Composite `/demo/composite` path: specUri = `data:application/json,`
 *     envelope from `parent-id-codec` carrying `{parent, spec}`. The `spec`
 *     is an instruction like "describe the screenshot at
 *     https://example.com/x.png" or "caption these product photos…".
 *     We detect the envelope, extract `spec`, and look for an embedded
 *     `http(s)://` image URL. If found, describe it; if not, return an
 *     honest "vision sub-task requires an image URL" result so the operator
 *     can fix the plan.
 *
 * M10.5.B (2026-05-21) — completes the worker dual-mode rollout. Vision
 * is the corner case: without a URL the worker has nothing to act on, so
 * the fallback is structured failure rather than a faked description.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { decodeCompositeEnvelope, materialFromEnvelope } from '../shared/composite-codec.js';
import { pollNewTasks } from '../shared/task-poller.js';
import { awaitTaskState } from '../shared/await-task-state.js';
import { TaskStatus, taskId } from '@sage/core';
import { taskEscrowAbi } from '@sage/adapter-evm';

if (process.env.VISION_PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.VISION_PRIVATE_KEY;
}

const config = loadConfig(3003);
const { sage, publicClient, account, chainConfig } = createSageFromConfig(config);
const escrowAddress = chainConfig.contracts.taskEscrow;

const MAX_DESCRIPTION_CHARS = 500;

// Matches the first http(s) URL with a plausible image extension OR no
// extension (a content-type check would be more honest, but we don't
// fetch the URL ourselves — OpenAI does). Conservative on the extension
// list to avoid false positives on `https://docs.example.com` links
// embedded as references in the instruction.
const IMAGE_URL_REGEX =
  /https?:\/\/[^\s<>"']+?\.(?:png|jpe?g|gif|webp|bmp|svg|avif)(?:\?[^\s<>"']*)?/i;

function extractImageUrl(spec: string): string | null {
  const m = spec.match(IMAGE_URL_REGEX);
  return m ? m[0] : null;
}

async function describeUrl(imageUrl: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Describe this image in ${MAX_DESCRIPTION_CHARS} characters or less. Be specific about subjects, composition, colors, and mood. No preamble — just the description.`,
            },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 200,
    }),
  });
  const data = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };
  if (data.error) {
    console.error(`[Vision] OpenAI error: ${data.error.message}`);
    return `Vision failed: ${data.error.message}`.slice(0, MAX_DESCRIPTION_CHARS);
  }
  const description = data.choices?.[0]?.message?.content ?? 'Description unavailable';
  return description.slice(0, MAX_DESCRIPTION_CHARS);
}

async function describeOrExecute(specUri: string): Promise<string> {
  const env = decodeCompositeEnvelope(specUri);

  if (config.openaiApiKey) {
    if (env !== null) {
      // The image URL lives in the material (source = original brief, or an
      // upstream result) per ADR-0018; fall back to the spec for legacy
      // envelopes that embedded the URL in the instruction.
      const material = materialFromEnvelope(env);
      const url = (material !== null ? extractImageUrl(material) : null) ?? extractImageUrl(env.spec);
      if (url) return describeUrl(url);
      return 'Vision sub-task requires an image URL; neither the material nor the instruction included an http(s) URL. Update the plan to embed one.';
    }
    // 3-mode raw path: specUri itself IS the URL (per /api/demo/start validation).
    return describeUrl(specUri);
  }

  // Mock fallback
  if (env !== null) {
    const material = materialFromEnvelope(env);
    const url = (material !== null ? extractImageUrl(material) : null) ?? extractImageUrl(env.spec);
    return url
      ? `[MOCK COMPOSITE VISION] Would describe ${url}; no OpenAI key configured.`.slice(0, MAX_DESCRIPTION_CHARS)
      : `[MOCK COMPOSITE VISION] No image URL in material or instruction; instruction was: ${env.spec.slice(0, 80)}…`;
  }
  return `[MOCK VISION] Image at ${specUri} — mock describes a placeholder scene with neutral tone.`.slice(
    0,
    MAX_DESCRIPTION_CHARS,
  );
}

async function handleTaskCreated(
  taskIdBigInt: bigint,
  _client: `0x${string}`,
  executor: `0x${string}`,
) {
  if (executor.toLowerCase() !== account.address.toLowerCase()) return;

  const id = taskId(taskIdBigInt.toString());
  console.error(`[Vision] Task ${id} assigned to us, accepting...`);

  try {
    const acceptHash = await sage.tasks.acceptTask(id);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: acceptHash as `0x${string}`,
    });
    if (receipt.status === 'reverted') {
      console.error(`[Vision] Task ${id} accept reverted (another agent got it first)`);
      return;
    }
    console.error(`[Vision] Task ${id} accepted (tx: ${acceptHash}), working...`);

    // Bounded poll for Accepted state — see await-task-state.ts. Replaces
    // a flat 2s sleep that abandoned tasks whenever the RPC replica lagged.
    const task = await awaitTaskState((tid) => sage.tasks.getTask(tid), id, TaskStatus.Accepted);
    if (!task) {
      console.error(`[Vision] Task ${id} state did not become Accepted within 10s — skipping`);
      return;
    }
    console.error(
      `[Vision] Task ${id} status: ${task.status}, specUri: ${task.specUri.slice(0, 80)}`,
    );

    const result = await describeOrExecute(task.specUri);
    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;

    console.error(`[Vision] Task ${id} submitting completeTask...`);
    await sage.tasks.completeTask(id, resultUri);
    console.error(`[Vision] Task ${id} completed`);
  } catch (err) {
    console.error(`[Vision] Error handling task ${id}:`, err);
  }
}

const agent = new BaseAgent({
  name: 'Vision',
  port: config.port,
  onStart() {
    console.error('[Vision] Watching for TaskCreated events...');

    // Direct polling — viem event watchers fail on Arc (GOTCHAS 2026-05-22).
    pollNewTasks({
      publicClient,
      escrowAddress,
      abi: taskEscrowAbi,
      myAddress: account.address,
      pollIntervalMs: 15_000,
      tag: 'Vision',
      onTaskForMe: (id, clientAddr, executor) => {
        handleTaskCreated(id, clientAddr, executor).catch(console.error);
      },
    });
  },
});

agent.start().catch(console.error);
