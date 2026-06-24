/**
 * Orchestrator — HTTP server coordinating demo task-lifecycle flow.
 *
 * Endpoints:
 *   GET  /health                              Liveness check (Fly.io + CI).
 *   POST /api/demo/start                      Sponsored demo run, return { demoRunId, streamUrl }.
 *   GET  /api/demo/stream/:demoRunId          SSE stream for a 3-mode demo run.
 *   POST /api/demo/composite/classify         Classify a brief → ClassificationResult.
 *   POST /api/demo/composite/execute          Spawn an approved Plan → { runId, streamUrl }.
 *   GET  /api/demo/composite/stream/:runId    SSE stream for a composite plan run.
 *   POST /process                             (legacy) Blocking demo — back-compat curl.
 *
 * Per ADR-0006: SSE over HTTP/2, CORS restricted to known origins, sponsor
 * balance check before new runs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { demoRegistry } from '../shared/sse.js';
import { loadOrchestratorEnv } from '../shared/env.js';
import { checkSponsorStatus, formatUsdc } from './guards.js';
import { checkEvaluatorCoverage, checkQuarantine } from './plan-guards.js';
import { startDemoRun, type DemoMode } from './demo-run.js';
import { classifyBrief, executePlan, resolveUserDecision } from '../parent/index.js';
import { makeDisputeFlow } from '../parent/dispute-flow.js';
import { resolveExecutorFromRegistry } from '../parent/registry-resolver.js';
import { fetchReputationScores, fetchProvenAgents } from './reputation-client.js';
import { buildWebsiteClassification } from '../parent/website-plan.js';
import { buildResearchClassification } from '../parent/research-plan.js';
import { listActiveAgentsV2 } from '@sage/adapter-evm';
import type { AgentRecordV2, Plan, SubTask } from '@sage/core';

const env = loadOrchestratorEnv();
const config = loadConfig(env.port);
const sageBundle = createSageFromConfig(config);

// Discover which chain this orchestrator is talking to. Resolved once at boot
// and echoed back on /health + /api/demo/start so the frontend can label the
// demo run truthfully regardless of the user's wallet chain.
let chainInfo: { chainId: number; displayName: string; explorerUrl: string } = {
  chainId: 0,
  displayName: 'unknown',
  explorerUrl: '',
};

const EXPLORERS: Record<number, { displayName: string; url: string }> = {
  8453: { displayName: 'Base', url: 'https://basescan.org' },
  84532: { displayName: 'Base Sepolia', url: 'https://sepolia.basescan.org' },
  5042002: { displayName: 'Arc Testnet', url: 'https://testnet.arcscan.app' },
};

async function resolveChainInfo(): Promise<void> {
  try {
    const id = await sageBundle.publicClient.getChainId();
    const known = EXPLORERS[id];
    chainInfo = {
      chainId: id,
      displayName: known?.displayName ?? `chain ${id}`,
      explorerUrl: known?.url ?? '',
    };
    console.error(`[Orchestrator] chain: ${chainInfo.displayName} (${id})`);
  } catch (err) {
    console.error('[Orchestrator] failed to resolve chainId at boot:', err);
  }
}

// ── CORS ──────────────────────────────────────────────────────────────
function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && env.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────
/** Hard cap on request body size — the app is publicly reachable, so an
 * unbounded POST is a trivial memory-DoS. 1 MB is far above any real demo
 * payload (a plan + brief). */
const MAX_BODY_BYTES = 1_000_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * JSON.stringify variant that serializes `bigint` as decimal strings.
 * Used by composite endpoints whose payloads carry USDC base-unit amounts
 * (`estimated_cost_units`, `estimated_total_cost_units`) — JSON has no
 * native bigint, so the wire format is a decimal string the frontend parses
 * back with `BigInt()`.
 */
function jsonWithBigints(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

/**
 * Parse and validate a Plan from a JSON request body. The wire format is
 * the `Plan` shape from `@sage/core` with `estimated_*cost_units` carried
 * as decimal strings. Throws an `Error` whose message is the validation
 * failure — the caller wraps it in a 400.
 */
function parsePlanFromBody(raw: unknown): Plan {
  if (!raw || typeof raw !== 'object') throw new Error('body must be a JSON object');
  const r = raw as Record<string, unknown>;
  if (typeof r['brief'] !== 'string' || r['brief'].length === 0) {
    throw new Error('brief must be a non-empty string');
  }
  if (r['decomposability'] !== 'one-shot' && r['decomposability'] !== 'composite') {
    throw new Error('decomposability must be "one-shot" or "composite"');
  }
  if (r['stakes'] !== 'low' && r['stakes'] !== 'high') {
    throw new Error('stakes must be "low" or "high"');
  }
  if (!Array.isArray(r['subtasks']) || r['subtasks'].length === 0) {
    throw new Error('subtasks must be a non-empty array');
  }
  if (typeof r['estimated_total_cost_units'] !== 'string') {
    throw new Error('estimated_total_cost_units must be a decimal string');
  }
  if (typeof r['estimated_duration_ms'] !== 'number') {
    throw new Error('estimated_duration_ms must be a number');
  }

  const subtasks: SubTask[] = r['subtasks'].map((s, i) => parseSubTask(s, i));

  return {
    brief: r['brief'],
    decomposability: r['decomposability'],
    stakes: r['stakes'],
    subtasks,
    estimated_total_cost_units: BigInt(r['estimated_total_cost_units']),
    estimated_duration_ms: r['estimated_duration_ms'],
  };
}

/**
 * Server-side economic ceilings for client-supplied plans (code review
 * 2026-06-09, finding H1). The plan body is fully client-controlled and the
 * sponsor wallet pays for every sub-task, so amounts and count must be
 * bounded here regardless of what the classifier proposed — otherwise a
 * single crafted POST can escrow the whole sponsor balance to an arbitrary
 * executor address. Returns an error string for a 400, or null when within
 * caps.
 */
function checkPlanCaps(plan: Plan): string | null {
  if (plan.subtasks.length > env.maxPlanSubtasks) {
    return `plan has ${plan.subtasks.length} subtasks — the sponsored demo allows at most ${env.maxPlanSubtasks}`;
  }
  let total = 0n;
  for (const s of plan.subtasks) {
    if (s.estimated_cost_units <= 0n) {
      return `subtask #${s.id} estimated_cost_units must be > 0`;
    }
    if (s.estimated_cost_units > env.maxSubtaskUnits) {
      return `subtask #${s.id} estimated_cost_units exceeds the sponsored per-subtask cap (${env.maxSubtaskUnits} base units)`;
    }
    total += s.estimated_cost_units;
  }
  if (total > env.maxPlanTotalUnits) {
    return `plan total ${total} base units exceeds the sponsored per-plan cap (${env.maxPlanTotalUnits} base units)`;
  }
  return null;
}

function parseSubTask(raw: unknown, idx: number): SubTask {
  if (!raw || typeof raw !== 'object') throw new Error(`subtasks[${idx}] must be an object`);
  const s = raw as Record<string, unknown>;
  if (typeof s['id'] !== 'number' || !Number.isInteger(s['id']) || s['id'] < 1) {
    throw new Error(`subtasks[${idx}].id must be a positive integer`);
  }
  if (typeof s['type'] !== 'string' || s['type'].length === 0) {
    throw new Error(`subtasks[${idx}].type must be a non-empty string`);
  }
  if (typeof s['estimated_cost_units'] !== 'string' || !/^\d+$/.test(s['estimated_cost_units'])) {
    throw new Error(`subtasks[${idx}].estimated_cost_units must be a non-negative decimal string`);
  }
  if (typeof s['deadline_offset_s'] !== 'number' || s['deadline_offset_s'] < 0) {
    throw new Error(`subtasks[${idx}].deadline_offset_s must be a non-negative number`);
  }
  if (typeof s['spec'] !== 'string') {
    throw new Error(`subtasks[${idx}].spec must be a string`);
  }

  const out: SubTask = {
    id: s['id'],
    type: s['type'],
    estimated_cost_units: BigInt(s['estimated_cost_units']),
    deadline_offset_s: s['deadline_offset_s'],
    spec: s['spec'],
    ...(typeof s['executor_address'] === 'string' &&
    /^0x[a-fA-F0-9]{40}$/.test(s['executor_address'])
      ? { executor_address: s['executor_address'] as `0x${string}` }
      : {}),
    ...(Array.isArray(s['depends_on']) &&
    s['depends_on'].every((d) => typeof d === 'number' && Number.isInteger(d))
      ? { depends_on: (s['depends_on'] as number[]).slice() }
      : {}),
    // Evaluator marker (M12.0.3) — id of the sibling sub-task this step
    // judges. Validated structurally here; referential checks (target exists,
    // no evaluator-of-evaluator) live in the plan-runner's validatePlan.
    ...(typeof s['evaluates'] === 'number' && Number.isInteger(s['evaluates']) && s['evaluates'] >= 1
      ? { evaluates: s['evaluates'] }
      : {}),
  };
  return out;
}

// ── Routes ────────────────────────────────────────────────────────────
// createServer expects a void listener; the async handler is routed through
// an explicitly ignored promise — every route handles its own errors.
const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (applyCors(req, res)) return;

  const { method, url = '/' } = req;

  // Gateway shared-secret guard (code review 2026-06-09, finding A1). The Fly
  // app is publicly reachable, so when DEMO_GATEWAY_KEY is set every
  // state-changing demo endpoint must arrive through the Worker gateway —
  // which injects `x-sage-gateway` and enforces the per-IP rate limit that a
  // direct-to-Fly caller would otherwise bypass. GET endpoints (health, SSE
  // streams) stay open. No-op when the secret is unset, so local dev and the
  // Fly/Worker secret rollout don't have to be simultaneous.
  if (
    env.gatewayKey &&
    method === 'POST' &&
    (url === '/api/demo/start' || url === '/process' || url.startsWith('/api/demo/composite/')) &&
    req.headers['x-sage-gateway'] !== env.gatewayKey
  ) {
    json(res, 401, {
      error: 'gateway_required',
      message: 'This endpoint must be called through the Sage gateway.',
    });
    return;
  }

  // --- /health ---------------------------------------------------------
  if (url === '/health' && method === 'GET') {
    // Surface sponsor status best-effort — don't block /health on RPC failure.
    let sponsor: Awaited<ReturnType<typeof checkSponsorStatus>> | null = null;
    try {
      sponsor = await checkSponsorStatus(
        sageBundle.publicClient,
        sageBundle.account.address,
        env.sponsorMinBalanceUsdc,
      );
    } catch (err) {
      console.error('[Orchestrator] sponsor status check failed:', err);
    }
    json(res, 200, {
      status: sponsor?.level === 'critical' ? 'degraded' : 'ok',
      agent: 'Orchestrator',
      activeDemoRuns: demoRegistry.size,
      chainId: chainInfo.chainId,
      chainName: chainInfo.displayName,
      explorerUrl: chainInfo.explorerUrl,
      sponsor: sponsor
        ? {
            address: sageBundle.account.address,
            balanceUsdc: formatUsdc(sponsor.balance),
            minBalanceUsdc: formatUsdc(sponsor.minBalance),
            level: sponsor.level,
            accepting: sponsor.ok,
          }
        : { error: 'balance check failed' },
    });
    return;
  }

  // --- POST /api/demo/start -------------------------------------------
  if (url === '/api/demo/start' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw
        ? (JSON.parse(raw) as { mode?: string; text?: string; imageUrl?: string })
        : {};
      const mode: DemoMode = (body.mode as DemoMode | undefined) ?? 'pipeline';

      // Validate mode
      if (mode !== 'pipeline' && mode !== 'sentiment' && mode !== 'vision') {
        json(res, 400, {
          error: `Invalid mode "${String(body.mode)}" — must be one of: pipeline, sentiment, vision`,
        });
        return;
      }

      // Validate input shape per mode
      if (mode === 'pipeline' || mode === 'sentiment') {
        if (!body.text || typeof body.text !== 'string') {
          json(res, 400, { error: `${mode} mode requires "text" field (string)` });
          return;
        }
      }
      if (mode === 'vision') {
        if (!body.imageUrl || typeof body.imageUrl !== 'string') {
          json(res, 400, { error: 'vision mode requires "imageUrl" field (string)' });
          return;
        }
        // Permit only http(s) — we don't fetch the URL ourselves (OpenAI does),
        // but reject obviously-broken URLs early so we don't burn USDC on a
        // task the agent will trivially fail.
        if (!/^https?:\/\//i.test(body.imageUrl)) {
          json(res, 400, { error: 'imageUrl must start with http:// or https://' });
          return;
        }
      }

      // Validate per-mode addresses are configured
      const addressErrors: string[] = [];
      if (mode === 'pipeline') {
        if (!env.summarizerAddress) addressErrors.push('SUMMARIZER_ADDRESS');
        if (!env.translatorAddress) addressErrors.push('TRANSLATOR_ADDRESS');
      } else if (mode === 'sentiment') {
        if (!env.sentimentAddress) addressErrors.push('SENTIMENT_ADDRESS');
      } else if (mode === 'vision') {
        if (!env.visionAddress) addressErrors.push('VISION_ADDRESS');
      }
      if (addressErrors.length > 0) {
        json(res, 500, {
          error: `Server misconfigured for ${mode} mode: missing env ${addressErrors.join(', ')}`,
        });
        return;
      }

      // Sponsor balance guard (ADR-0006 / M-INT.7).
      // Skip only when SPONSOR_MIN_BALANCE_USDC=0 explicitly (local dev).
      if (env.sponsorMinBalanceUsdc > 0n) {
        try {
          const sponsor = await checkSponsorStatus(
            sageBundle.publicClient,
            sageBundle.account.address,
            env.sponsorMinBalanceUsdc,
          );
          if (!sponsor.ok) {
            json(res, 503, {
              error: 'sponsor_exhausted',
              message: `Sponsor wallet is below the ${formatUsdc(
                env.sponsorMinBalanceUsdc,
              )} USDC floor. Watch-live mode is temporarily paused — try with your wallet instead.`,
              balanceUsdc: formatUsdc(sponsor.balance),
              minBalanceUsdc: formatUsdc(sponsor.minBalance),
            });
            return;
          }
        } catch (err) {
          console.error('[Orchestrator] sponsor guard failed, allowing through:', err);
          // Soft-fail: if the balance check errors (RPC flake), allow the demo.
          // The task itself will revert if sponsor actually has no USDC, so no
          // real fund risk — just worse UX.
        }
      }

      const { demoRunId, streamUrl } = startDemoRun(sageBundle, {
        mode,
        text: body.text,
        imageUrl: body.imageUrl,
        summarizerAddress: env.summarizerAddress,
        translatorAddress: env.translatorAddress,
        visionAddress: env.visionAddress,
        sentimentAddress: env.sentimentAddress,
        taskAmount: env.taskAmount,
      });

      json(res, 202, {
        demoRunId,
        streamUrl,
        mode,
        chainId: chainInfo.chainId,
        chainName: chainInfo.displayName,
        explorerUrl: chainInfo.explorerUrl,
      });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/start error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- GET /api/demo/stream/:id ---------------------------------------
  if (method === 'GET' && url.startsWith('/api/demo/stream/')) {
    // Trim any ?query (EventSource polyfills append cache-busters) before the lookup.
    const demoRunId = url.slice('/api/demo/stream/'.length).split('?')[0]!;
    const channel = demoRegistry.get(demoRunId);
    if (!channel) {
      json(res, 404, { error: 'demo run not found or already expired' });
      return;
    }
    // Channel manages its own response lifecycle (keep-alive + flush).
    channel.attach(res);
    return;
  }

  // --- POST /api/demo/composite/classify ------------------------------
  if (url === '/api/demo/composite/classify' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as { brief?: unknown }) : {};
      if (typeof body.brief !== 'string' || body.brief.length === 0) {
        json(res, 400, { error: 'brief must be a non-empty string' });
        return;
      }

      // M11.3: fetch active agents from V2 registry once per classify call.
      // foreign-agent registrations become visible to the next classify
      // without redeploy. Failure is non-fatal — falls back to frontend
      // env-var resolver if registry lookup errors out.
      let registryAgents: AgentRecordV2[] = [];
      const registryV2Addr = sageBundle.chainConfig.contracts.agentRegistryV2;
      if (registryV2Addr) {
        try {
          registryAgents = await listActiveAgentsV2(sageBundle.publicClient, registryV2Addr);
        } catch (regErr) {
          console.error('[Orchestrator] registry V2 lookup failed, falling back:', regErr);
        }
      }

      // M13.1.2: rank executor candidates by reputation (best-first) instead of
      // cheapest. Best-effort + cached; an empty map → cheapest-first fallback.
      const reputation = await fetchReputationScores(env.reputationUrl);

      const classification = await classifyBrief(body.brief, {
        ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
        ...(registryAgents.length > 0
          ? { resolveExecutor: (taskType: string) => resolveExecutorFromRegistry(taskType, registryAgents, reputation) }
          : {}),
      });
      jsonWithBigints(res, 200, { classification });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/classify error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- POST /api/demo/composite/website-plan (M12.1.3) ----------------
  // Deterministic website-pipeline plan — no LLM classification; executors
  // and prices resolved from AgentRegistryV2 by exact capability name. The
  // registry is REQUIRED here (unlike classify's best-effort resolve): a
  // website plan whose steps nobody executes must not reach the plan card.
  if (url === '/api/demo/composite/website-plan' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as { brief?: unknown; variant?: unknown }) : {};
      if (typeof body.brief !== 'string' || body.brief.length === 0) {
        json(res, 400, { error: 'brief must be a non-empty string' });
        return;
      }
      // M12.1.6: 'site-author' = frontier builder authors copy+design in one
      // pass (no copywriter step). Default stays the 4-step pipeline.
      const variant = body.variant === 'site-author' ? 'site-author' : 'pipeline';

      const registryV2Addr = sageBundle.chainConfig.contracts.agentRegistryV2;
      if (!registryV2Addr) {
        json(res, 503, { error: 'agent registry V2 is not configured on this chain' });
        return;
      }
      let registryAgents: AgentRecordV2[];
      try {
        registryAgents = await listActiveAgentsV2(sageBundle.publicClient, registryV2Addr);
      } catch (regErr) {
        console.error('[Orchestrator] registry V2 lookup failed:', regErr);
        json(res, 503, { error: 'agent registry lookup failed — try again' });
        return;
      }

      const classification = buildWebsiteClassification(registryAgents, variant);
      jsonWithBigints(res, 200, { classification });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/website-plan error:', err);
      const message = err instanceof Error ? err.message : String(err);
      // Missing capability = service state, not server bug.
      json(res, message.includes('no active agent') ? 503 : 500, { error: message });
    }
    return;
  }

  // --- POST /api/demo/composite/research-plan (M12.2.1) ---------------
  // Deterministic research-pipeline plan — same registry-required template
  // discipline as website-plan above. Accepts `question` (canonical) or
  // `brief` (the execute path's generic name for the root material).
  if (url === '/api/demo/composite/research-plan' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw
        ? (JSON.parse(raw) as { question?: unknown; brief?: unknown; variant?: unknown })
        : {};
      const question = typeof body.question === 'string' ? body.question : body.brief;
      if (typeof question !== 'string' || question.length === 0) {
        json(res, 400, { error: 'question must be a non-empty string' });
        return;
      }
      // M12.2.3: 'failure-demo' stages a controlled failed run — the
      // synthesizer ships real URLs with fabricated quotes, the fact-checker
      // catches them live → dispute → refund. Default is the honest pipeline.
      const variant = body.variant === 'failure-demo' ? 'failure-demo' : 'pipeline';

      const registryV2Addr = sageBundle.chainConfig.contracts.agentRegistryV2;
      if (!registryV2Addr) {
        json(res, 503, { error: 'agent registry V2 is not configured on this chain' });
        return;
      }
      let registryAgents: AgentRecordV2[];
      try {
        registryAgents = await listActiveAgentsV2(sageBundle.publicClient, registryV2Addr);
      } catch (regErr) {
        console.error('[Orchestrator] registry V2 lookup failed:', regErr);
        json(res, 503, { error: 'agent registry lookup failed — try again' });
        return;
      }

      const classification = buildResearchClassification(registryAgents, variant);
      jsonWithBigints(res, 200, { classification });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/research-plan error:', err);
      const message = err instanceof Error ? err.message : String(err);
      // Missing capability = service state, not server bug.
      json(res, message.includes('no active agent') ? 503 : 500, { error: message });
    }
    return;
  }

  // --- GET /api/demo/composite/agents (M13.1.1) ----------------------
  // Active V2-registry agents (address + capabilities + price) so the
  // plan-editor can offer real executor candidates per capability — the
  // env-var executor list only ever knew the legacy four, so editing the
  // website/research pipelines had no usable executors. Best-effort: an
  // unconfigured registry (e.g. Arc) or a lookup failure returns an empty
  // list so the editor degrades to a custom-address field rather than
  // erroring. Read-only GET, so no gateway-key guard applies.
  if (url === '/api/demo/composite/agents' && method === 'GET') {
    const registryV2Addr = sageBundle.chainConfig.contracts.agentRegistryV2;
    if (!registryV2Addr) {
      json(res, 200, { agents: [] });
      return;
    }
    try {
      const registryAgents = await listActiveAgentsV2(sageBundle.publicClient, registryV2Addr);
      jsonWithBigints(res, 200, {
        agents: registryAgents.map((a) => ({
          address: a.id,
          capabilities: a.capabilities.map((c) => ({ name: c.name, price: c.price })),
        })),
      });
    } catch (regErr) {
      console.error('[Orchestrator] /api/demo/composite/agents registry lookup failed:', regErr);
      json(res, 200, { agents: [] });
    }
    return;
  }

  // --- POST /api/demo/composite/execute -------------------------------
  if (url === '/api/demo/composite/execute' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as unknown) : null;

      let plan: Plan;
      try {
        plan = parsePlanFromBody(body);
      } catch (validationErr) {
        json(res, 400, {
          error: validationErr instanceof Error ? validationErr.message : String(validationErr),
        });
        return;
      }

      const capError = checkPlanCaps(plan);
      if (capError) {
        json(res, 400, { error: capError });
        return;
      }

      // Evaluator-coverage rule (M13.2.2): foreign-executor work must be gated
      // by a first-party evaluator. No-op until FIRST_PARTY_AGENTS is set.
      const coverageError = checkEvaluatorCoverage(plan, env.firstPartyAgents);
      if (coverageError) {
        json(res, 400, { error: coverageError });
        return;
      }

      // Quarantine rule (M13.2.4): an unproven foreign agent may only run a
      // low-value sub-task. Proven = enough settled tasks in the reputation
      // index. Best-effort fetch; no-op until FIRST_PARTY_AGENTS is set.
      if (env.firstPartyAgents.size > 0) {
        const proven = await fetchProvenAgents(env.reputationUrl, env.quarantineProvenMin);
        const quarantineError = checkQuarantine(plan, env.firstPartyAgents, proven, env.quarantineMaxUnits);
        if (quarantineError) {
          json(res, 400, { error: quarantineError });
          return;
        }
      }

      // Reuse the sponsor guard from the 3-mode flow — composite runs draw
      // from the same sponsor wallet, so the same balance floor applies.
      if (env.sponsorMinBalanceUsdc > 0n) {
        try {
          const sponsor = await checkSponsorStatus(
            sageBundle.publicClient,
            sageBundle.account.address,
            env.sponsorMinBalanceUsdc,
          );
          if (!sponsor.ok) {
            json(res, 503, {
              error: 'sponsor_exhausted',
              message: `Sponsor wallet is below the ${formatUsdc(
                env.sponsorMinBalanceUsdc,
              )} USDC floor. Composite execution is temporarily paused.`,
              balanceUsdc: formatUsdc(sponsor.balance),
              minBalanceUsdc: formatUsdc(sponsor.minBalance),
            });
            return;
          }
        } catch (guardErr) {
          console.error('[Orchestrator] composite sponsor guard failed, allowing through:', guardErr);
        }
      }

      // Opt-in review gate (ADR-0019). When on, each Completed sub-task pauses
      // for an approve/dispute decision; a dispute drives the council +
      // arbiter resolution via `makeDisputeFlow`.
      const reviewMode =
        !!body && typeof body === 'object' && (body as { reviewMode?: unknown }).reviewMode === true;
      // Consent-gated server-side analytics (ADR-0006): the frontend forwards
      // the cookie-consent state; server capture happens only when granted.
      const analyticsConsent =
        !!body && typeof body === 'object' && (body as { analyticsConsent?: unknown }).analyticsConsent === true;
      const executeOpts = {
        chain: sageBundle.chainConfig.name,
        analyticsConsent,
        // ADR-0007 run-level guards (M12.0.3) — actual-spend ledger caps,
        // enforced in the plan-runner before every createTask.
        caps: {
          maxRunSpendUnits: env.maxRunSpendUnits,
          maxRunTasks: env.maxRunTasks,
          maxDepth: env.maxPlanDepth,
        },
        // Dispute resolution (council + arbiter) is wired UNCONDITIONALLY:
        // both the opt-in review gate and evaluator fail-verdicts route
        // through it. Wiring it only under reviewMode (the M12.0.3 seam)
        // made an evaluator fail-verdict silently PAY the failed step —
        // observed live on run 908e6718 (M12.1.3 e2e, 2026-06-11).
        disputeFlow: makeDisputeFlow(sageBundle, {
          ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
          // M12.1.6 judge-class rule: Sonnet arbiter when the key is present.
          ...(process.env['ANTHROPIC_API_KEY']
            ? { anthropicApiKey: process.env['ANTHROPIC_API_KEY'] }
            : {}),
        }),
        ...(reviewMode ? { reviewMode: true } : {}),
      };

      const { runId, streamUrl } = executePlan(plan, sageBundle, executeOpts);
      jsonWithBigints(res, 202, {
        runId,
        streamUrl,
        reviewMode,
        chainId: chainInfo.chainId,
        chainName: chainInfo.displayName,
        explorerUrl: chainInfo.explorerUrl,
      });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/execute error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- POST /api/demo/composite/retry-subtask -------------------------
  // M10.5.A: resolves a paused plan-runner waiting on a `subtask_disputed`
  // pause. Body: { runId, subId, newExecutorAddress?, action? }
  //   - `action: 'retry'` (default) → plan-runner re-spawns the sub-task with
  //     the existing executor, or with `newExecutorAddress` if supplied.
  //   - `action: 'cancel'`         → plan-runner emits `plan_failed` and closes.
  if (url === '/api/demo/composite/retry-subtask' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw
        ? (JSON.parse(raw) as {
            runId?: unknown;
            subId?: unknown;
            newExecutorAddress?: unknown;
            action?: unknown;
          })
        : {};

      if (typeof body.runId !== 'string' || body.runId.length === 0) {
        json(res, 400, { error: 'runId must be a non-empty string' });
        return;
      }
      if (typeof body.subId !== 'number' || !Number.isInteger(body.subId) || body.subId < 1) {
        json(res, 400, { error: 'subId must be a positive integer' });
        return;
      }
      const action = body.action ?? 'retry';
      if (action !== 'retry' && action !== 'cancel') {
        json(res, 400, { error: 'action must be "retry" or "cancel"' });
        return;
      }
      let newExecutor: `0x${string}` | undefined;
      if (action === 'retry' && body.newExecutorAddress !== undefined) {
        if (
          typeof body.newExecutorAddress !== 'string' ||
          !/^0x[a-fA-F0-9]{40}$/.test(body.newExecutorAddress)
        ) {
          json(res, 400, { error: 'newExecutorAddress must be a 0x-prefixed 40-hex string' });
          return;
        }
        newExecutor = body.newExecutorAddress as `0x${string}`;
      }

      // Sponsor guard: retry re-spawns a TaskEscrow (= new sponsor-side
      // createTask + later approvePayment). Reuse the same floor as
      // /execute so a near-empty sponsor can't get retried into.
      if (action === 'retry' && env.sponsorMinBalanceUsdc > 0n) {
        try {
          const sponsor = await checkSponsorStatus(
            sageBundle.publicClient,
            sageBundle.account.address,
            env.sponsorMinBalanceUsdc,
          );
          if (!sponsor.ok) {
            json(res, 503, {
              error: 'sponsor_exhausted',
              message: `Sponsor wallet is below the ${formatUsdc(
                env.sponsorMinBalanceUsdc,
              )} USDC floor. Retry is temporarily paused.`,
              balanceUsdc: formatUsdc(sponsor.balance),
              minBalanceUsdc: formatUsdc(sponsor.minBalance),
            });
            return;
          }
        } catch (guardErr) {
          console.error('[Orchestrator] retry sponsor guard failed, allowing through:', guardErr);
        }
      }

      const status = resolveUserDecision(
        body.runId,
        body.subId,
        action === 'cancel'
          ? { kind: 'cancel' }
          : newExecutor
            ? { kind: 'retry', newExecutor }
            : { kind: 'retry' },
      );
      if (status === 'not-found') {
        json(res, 404, {
          error: 'no_paused_run',
          message: `No paused decision for runId ${body.runId}. The run may have already resumed, timed out, or never paused.`,
        });
        return;
      }
      if (status === 'sub-mismatch') {
        json(res, 409, {
          error: 'sub_mismatch',
          message: `The paused sub-task does not match subId ${body.subId}.`,
        });
        return;
      }
      if (status === 'wrong-gate') {
        json(res, 409, {
          error: 'wrong_gate',
          message: `Run ${body.runId} is paused at a review gate — use /api/demo/composite/review-decision (approve | dispute).`,
        });
        return;
      }
      json(res, 202, { ok: true, action });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/retry-subtask error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- POST /api/demo/composite/review-decision -----------------------
  // M11.4 (ADR-0019): resolves a plan-runner paused at the review gate.
  // Body: { runId, subId, action: 'approve' | 'dispute', reason? }
  //   - 'approve' → runner pays the executor (approvePayment).
  //   - 'dispute' → runner raises disputeTask → council → resolveDispute.
  if (url === '/api/demo/composite/review-decision' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw
        ? (JSON.parse(raw) as { runId?: unknown; subId?: unknown; action?: unknown; reason?: unknown })
        : {};

      if (typeof body.runId !== 'string' || body.runId.length === 0) {
        json(res, 400, { error: 'runId must be a non-empty string' });
        return;
      }
      if (typeof body.subId !== 'number' || !Number.isInteger(body.subId) || body.subId < 1) {
        json(res, 400, { error: 'subId must be a positive integer' });
        return;
      }
      if (body.action !== 'approve' && body.action !== 'dispute') {
        json(res, 400, { error: 'action must be "approve" or "dispute"' });
        return;
      }
      const decision =
        body.action === 'approve'
          ? ({ kind: 'approve' } as const)
          : ({ kind: 'dispute', reason: typeof body.reason === 'string' && body.reason.length > 0 ? body.reason : 'No reason provided.' } as const);

      const status = resolveUserDecision(body.runId, body.subId, decision);
      if (status === 'not-found') {
        json(res, 404, {
          error: 'no_paused_run',
          message: `No review gate open for runId ${body.runId}. The run may have already resumed, timed out, or never paused.`,
        });
        return;
      }
      if (status === 'sub-mismatch') {
        json(res, 409, {
          error: 'sub_mismatch',
          message: `The paused sub-task does not match subId ${body.subId}.`,
        });
        return;
      }
      if (status === 'wrong-gate') {
        json(res, 409, {
          error: 'wrong_gate',
          message: `Run ${body.runId} is paused at a dispute-retry gate — use /api/demo/composite/retry-subtask (retry | cancel).`,
        });
        return;
      }
      json(res, 202, { ok: true, action: body.action });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/review-decision error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- GET /api/demo/composite/stream/:runId --------------------------
  if (method === 'GET' && url.startsWith('/api/demo/composite/stream/')) {
    const runId = url.slice('/api/demo/composite/stream/'.length).split('?')[0]!;
    const channel = demoRegistry.get(runId);
    if (!channel) {
      json(res, 404, { error: 'composite run not found or already expired' });
      return;
    }
    channel.attach(res);
    return;
  }

  // --- /process (legacy blocking) -------------------------------------
  if (url === '/process' && method === 'POST') {
    // Legacy shape: wait synchronously and return final result. Useful for curl demos.
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { text?: string };
      if (!body.text) {
        json(res, 400, { error: 'Missing "text" field' });
        return;
      }
      if (!env.summarizerAddress || !env.translatorAddress) {
        json(res, 500, { error: 'SUMMARIZER_ADDRESS / TRANSLATOR_ADDRESS not set' });
        return;
      }

      const { demoRunId, streamUrl } = startDemoRun(sageBundle, {
        mode: 'pipeline',
        text: body.text,
        summarizerAddress: env.summarizerAddress,
        translatorAddress: env.translatorAddress,
        taskAmount: env.taskAmount,
      });

      // Subscribe internally and resolve when `done` arrives.
      const channel = demoRegistry.get(demoRunId);
      if (!channel) throw new Error('channel disappeared immediately');
      const result = await new Promise<unknown>((resolve, reject) => {
        const pollDone = setInterval(() => {
          if (channel.isClosed) {
            clearInterval(pollDone);
            // Pull final payload from the last emitted event — not ideal, but matches
            // legacy shape. New integrations should use /api/demo/start + SSE.
            resolve({ demoRunId, streamUrl, note: 'see SSE stream for payload' });
          }
        }, 500);
        // Hard timeout — legacy clients expect <3min.
        setTimeout(() => {
          clearInterval(pollDone);
          reject(new Error('Legacy /process timed out — use /api/demo/start for streaming'));
        }, 180_000);
      });

      json(res, 200, result);
    } catch (err) {
      console.error('[Orchestrator] /process error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
};

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(env.port, () => {
  console.error(`[Orchestrator] listening on :${env.port}`);
  console.error(`[Orchestrator] allowed origins: ${env.allowedOrigins.join(', ')}`);
  // Resolve the chain asynchronously — server starts accepting traffic immediately;
  // /health will just report chainId=0 until this completes (~100ms typical).
  void resolveChainInfo();
});

// ── Graceful shutdown ─────────────────────────────────────────────────
function shutdown(signal: string): void {
  console.error(`[Orchestrator] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
