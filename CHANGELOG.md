# CHANGELOG.md

Хронология значимых решений, ребрендов, релизов Sage.

Формат: обратная хронология (свежее сверху). Для каждой записи — дата, категория, короткое описание.

Категории: `rebrand` | `decision` | `release` | `adr` | `chain` | `scope` | `incident` | `research`.

---

## 2026-06-08 (later) — AgentRegistryV2 (platform substrate) LIVE on Base mainnet + Sepolia — `v3.1.0`

M11.2 substrate per the ADR-0008 amendment §M11.2: the registry gains capability + per-task price + rich-profile fields. The v1 `AgentRegistry` at `0x5e95F92F…29c661` stays canonical for legacy agents; v2 is parallel at **the same deterministic address on Base mainnet + Sepolia** — `0x8df78599868Ec740C26F0eb0b660519b166cDd9e`. All 4 demo workers registered themselves on mainnet with their capability + flat 0.001-USDC-per-task price.

**Live ops:**
- **AgentRegistryV2** at `0x8df78599868Ec740C26F0eb0b660519b166cDd9e` on Base mainnet ([Basescan](https://basescan.org/address/0x8df78599868Ec740C26F0eb0b660519b166cDd9e), verified) + Base Sepolia ([Sepolia Basescan](https://sepolia.basescan.org/address/0x8df78599868ec740c26f0eb0b660519b166cDd9e), verified).
- Owner = sponsor `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d` on launch (collapse posture, same EOA as TaskEscrowV2 owner).
- Mainnet deploy: [tx `0x9e559f…0aba`](https://basescan.org/tx/0x9e559f66583c73f15b6f7e9d90bcf7e4f196f53b393f65110b16076444160aba), block 47059208. Sepolia deploy: [tx `0xb93bfb…ca42`](https://sepolia.basescan.org/tx/0xb93bfb22773196ff62a2e4c81e03c5ca1125d10b6bd5b529e4f10fabef42ca42).
- Mainnet registrations (4 demo workers, capabilityName + price 1000 USDC base units = 0.001 USDC):
  - Summarizer `0x0DA5…2593` → `summarize` ([tx `0x801ea8…2617`](https://basescan.org/tx/0x801ea80ba43fd359f021fdf013e7b9bfcc6c3b85e6e2d094bf5d48038f262617))
  - Translator `0xa61b…1c8c` → `translate` ([tx `0x6f76af…f0f4`](https://basescan.org/tx/0x6f76afe0668665401c2b68702895268b95329005983393c8d7707dea9b13f0f4))
  - Sentiment `0x5218…18B5` → `sentiment-classify` ([tx `0xbc53bf…c647`](https://basescan.org/tx/0xbc53bf3b0c72e117b2c3a30324bf452b48c4be58f3d65d49bfc079386ba2c647))
  - Vision `0xB889…63Fb` → `vision-describe` ([tx `0x702d3c…5c65`](https://basescan.org/tx/0x702d3c1725d19ea3bf11673a22856119a40cf34d87eddf0b3ac202e3f6f75c65))
- Cloudflare Pages (`sage-protocol.pages.dev`) redeployed with the updated SDK (deployment `8757ee0c`). Fly orchestrator unchanged — no orchestrator code path reads the registry yet (consumer comes in M11.3+).

### Contracts + Foundry

- `feat` **`packages/contracts/src/AgentRegistryV2.sol` (new, 193 lines).** Inherits `Ownable + Pausable`. New `Capability { name: string, price: uint256 }` struct. Agent record now has `capabilities` array + `profileUri` field. Granular update API: `updateEndpoint` / `updateProfileUri` / `updateCapabilities` (each emits its own event). `pauseAgent` self-pauses even when contract is paused (owners can always stop their own agent); `resumeAgent` blocked when contract paused. Validation: empty capability name → `EmptyCapabilityName`; price == 0 → `ZeroCapabilityPrice`; duplicate names → `DuplicateCapability(name)`. O(n²) duplicate check fine for the realistic 1-5 capabilities-per-agent shape.
- `feat` **`packages/contracts/src/interfaces/IAgentRegistryV2.sol` (new).** `Capability` + extended `Agent` struct. New events: `AgentRegistered`, `AgentEndpointUpdated`, `AgentProfileUriUpdated`, `AgentCapabilitiesUpdated`, `AgentPaused`, `AgentResumed`. New errors.
- `feat` **`packages/contracts/test/AgentRegistryV2.t.sol` (new, 465 lines).** 37 Foundry tests + 256-run fuzz on `manyCapabilities`. Full coverage: constructor + Ownable + setArbiter — wait, no: this is registry, so coverage = constructor, registerAgent happy + reverts (already registered / empty endpoint / empty capability name / zero price / duplicate / when paused), updateEndpoint / updateProfileUri / updateCapabilities incl. zero/duplicate validation, pauseAgent / resumeAgent incl. contract-pause interplay, listAgents pagination, agentCount, Ownable emergency pause + access control. **149/149** across full Foundry suite (112 from M11.1 + 37 new). Slither **fully clean** — zero detector findings on V2 registry (unlike TaskEscrowV2 which had pre-existing v1 baseline issues).
- `feat` **`packages/contracts/script/DeployRegistryV2.s.sol` (new).** CreateX + CREATE3 with `:v2` salt. Constructor takes only owner — no chain-specific immutables → identical bytecode + identical address on Base mainnet + Sepolia. Post-deploy sanity reads.
- `feat` **`packages/contracts/script/RegisterDemoAgents.s.sol` (new).** Idempotent: registers all 4 demo workers in one Foundry run, each signing its own `registerAgent` tx. Capability + flat 1000-unit price per worker. Re-run skips already-registered agents.

### SDK + types

- `feat` **`@sage/core`** — `RegistryCapability { name: Capability, price: bigint }` type. `AgentRecordV2 extends AgentRecord` with `profileUri` + `capabilities`. `AgentClientV2` interface with granular update methods + `getAgent` returning `AgentRecordV2`.
- `feat` **`@sage/adapter-evm`** — `agentRegistryV2Abi` (554 lines). `createAgentRegistryV2Client` factory returning `AgentClientV2`. Capability encode/decode helpers between viem tuple and SDK shape.
- `feat` **`@sage/adapter-evm`** `chains/base.ts` — new optional `agentRegistryV2` field added to both `base` (mainnet) and `baseSepolia`. v1 `agentRegistry` unchanged (parallel registries).
- `test` 30/30 in adapter-evm (7 new V2 registry surface tests).

### Web frontend

- `feat` **`apps/web/chains/base.ts`** — `agentRegistryV2` field added to both `BASE_MAINNET` and `BASE_SEPOLIA`. Cloudflare Pages deploy `8757ee0c` carries the new config.

### Deploy + ops

- `release` Sepolia deploy: same workflow as M11.1 — `forge script DeployRegistryV2.s.sol --broadcast --verify`. ~1.53M gas (~0.000009 ETH at 0.006 gwei). Auto-verify worked on Sepolia.
- `release` Mainnet deploy: same shape. Address identical to Sepolia ✅. Auto-verify failed (CREATE3 quirk on Basescan mainnet); manual `forge verify-contract` with explicit `--constructor-args` succeeded on second attempt — same fallback documented for TaskEscrowV2.
- `release` Demo-agent registration (M11.2.11): 4 txs in 2 blocks, total 882,936 gas = 0.0000053 ETH.
- `release` Cloudflare Pages redeploy with updated SDK chain config. Fly orchestrator NOT redeployed — no current consumer reads the registry.
- `docs` **`docs/runbooks/deploy-agent-registry-v2.md` (new).** Pre-flight, dry-run, broadcast, manual verify fallback, registration step + worker addresses + gas estimates.

### What's NOT in this release (deferred to M11.3+)

- **Plan-editor / classifier reading the registry** for capability-based executor discovery. Currently classifier uses hardcoded stem-matching (`use-composite-demo.ts resolveExecutorByType`). M11.3 wires it.
- **Foreign-agent onboarding flow** — registering a non-Sage-hosted worker via the V2 registry. M11.3.
- **Worker self-registration on boot.** Demo workers were registered by an out-of-band script; production foreign agents would self-register.
- **V2 registry deploy to Arc testnet.** Arc continues on its own deploy per ADR-0015.
- **Reputation surface** computed from `TaskPaid` / `TaskDisputed` / `TaskResolved` events. Awaits the indexer (axis A7, M11.6).

`v3.1.0` tagged on commit (this entry).

---

## 2026-06-08 — TaskEscrowV2 (arbitration layer) LIVE on Base mainnet + Sepolia — `v3.0.0`

`TaskEscrowV2` is operational at the same address on Base mainnet and Base Sepolia (`0x61c585630B32eee0b8c00306047c301B56419a81`). v2.0 contracts (`0x12aeF3…3E1e`) remain deployed but new tasks created via the SDK now route to v3.0. The arbitration layer from ADR-0017 (resolveDispute, configurable arbiter, reachable Refunded, Split outcomes) is the opt-in substrate that future foreign-agent assembly (M11.2+) will need. Same-address invariant from ADR-0001 held under the `:v2` salt despite chain-specific USDC immutables.

This release lands the contract substrate only — AgentRegistry V2 (capability + endpoint + price), off-chain council, appeal mechanism, indexer come in later milestones (see `docs/research/arbitration-and-platform-brainstorm.md` §Roadmap).

**Live ops:**
- **TaskEscrowV2** at `0x61c585630B32eee0b8c00306047c301B56419a81` on Base mainnet ([Basescan](https://basescan.org/address/0x61c585630b32eee0b8c00306047c301b56419a81)) + Base Sepolia ([Sepolia Basescan](https://sepolia.basescan.org/address/0x61c585630b32eee0b8c00306047c301b56419a81)). Verified source on both.
- Owner = arbiter = sponsor `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d` on launch (collapse posture, documented in `docs/runbooks/deploy-task-escrow-v2.md`). Future migration: `transferOwnership` to Safe + dedicated arbiter EOA.
- Mainnet deploy tx: [`0x9d5131…ed6d`](https://basescan.org/tx/0x9d5131f501b0240bb03e93c2b2d8cd08af10a1122eead6586db1d2023d52ed6d). Sepolia deploy tx: [`0xdfa206…624b`](https://sepolia.basescan.org/tx/0xdfa206952852ad7a6602f0adc3489ff653cd5131af5573a06ee4edbd6cae624b).
- Fly orchestrator + workers (`sage-demo-agents.fly.dev`) redeployed pointing at v3.0 address (rolling, image version 15).
- Cloudflare Pages frontend (`sage-protocol.pages.dev`) redeployed — `apps/web/chains/base.ts` carries v3.0 address.
- Arc testnet stack untouched. Arc still uses its bridge-deploy contracts per ADR-0015. V3.0 to Arc is a separate future task.

### Contracts + Foundry

- `feat` **`packages/contracts/src/TaskEscrowV2.sol` (new, 330 lines).** Inherits `ReentrancyGuard`, `Ownable2Step`. Adds `arbiter` storage + `setArbiter(onlyOwner)` + `resolveDispute(taskId, outcome, executorShare)` with three outcomes (Paid / Refunded / Split). New `TaskStatus.Split` enum value (uint8 7). `Task.executorShare` field stored only on Split. All v1 lifecycle paths byte-equivalent to v2.0.
- `feat` **`packages/contracts/src/interfaces/ITaskEscrowV2.sol` (new).** Extended Task struct with `executorShare`. `TaskResolved` + `ArbiterChanged` events. New errors: `ZeroArbiter`, `InvalidOutcome`, `InvalidExecutorShare`.
- `feat` **`packages/contracts/test/TaskEscrowV2.t.sol` (new, 499 lines).** 35 tests: constructor edges (zero arbiter / owner revert), `setArbiter` access control + zero check + arbiter rotation, `Ownable2Step` two-step transfer, all 3 resolveDispute outcomes including amount-conservation, access control, state preconditions, share validations, invalid outcome rejection, reachability matrix. Fuzz test on amount conservation with 256 runs. Slim v1 regression coverage. **112/112** across full Foundry suite (77 v1 + 35 V2). Slither baseline equivalent to v1 (no new detector categories).
- `feat` **`packages/contracts/script/DeployV2.s.sol` (new).** CreateX + CREATE3 deploy with `:v2` salt. Constructor: `(USDC, initialOwner, initialArbiter)`. Post-deploy sanity reads (`USDC()`, `owner()`, `arbiter()`) catch wiring errors before script return. Mirrors `Deploy.s.sol` patterns; v1 deploy script untouched.

### SDK + types

- `feat` **`@sage/core`** — `TaskStatus.Split` added to enum. `DisputeOutcome` type alias = `TaskStatus.Paid | TaskStatus.Refunded | TaskStatus.Split`. `TaskRecord.executorShare: bigint` field added (always 0n when reading via v1 adapter — adapter defaults explicitly). `TaskClientV2` interface extends `TaskClient` with `resolveDispute` / `setArbiter` / `getArbiter`.
- `feat` **`@sage/adapter-evm`** — `taskEscrowV2Abi` (716 lines, generated from forge artifact, exported). `createTaskEscrowV2Client(publicClient, walletClient, escrowAddress, usdcAddress): TaskClientV2`. Mirrors v1 client surface; adds the three arbitration methods. `STATUS_MAP_V2` includes uint8 7 → Split. `OUTCOME_TO_UINT8` maps SDK enum to on-chain selector (3/5/7). Existing v1 `createTaskEscrowClient` unchanged.
- `feat` **`@sage/adapter-evm`** `chains/base.ts` — `taskEscrow` swapped to v3.0 address on both `base` (mainnet) and `baseSepolia`. Inline comment records both v3 and v2 addresses for archaeology.
- `test` 23/23 in adapter-evm (10 new V2 surface tests: ABI shape, function signatures, Ownable2Step inheritance, event presence, v1 surface preservation).

### Web frontend

- `feat` **`apps/web/chains/base.ts`** — `taskEscrow` swapped to v3.0 on both `BASE_MAINNET` and `BASE_SEPOLIA`. Cloudflare Pages deploy `8b7d0e60` carries the new config.

### Deploy + ops

- `release` Sepolia deploy ([tx `0xdfa206…624b`](https://sepolia.basescan.org/tx/0xdfa206952852ad7a6602f0adc3489ff653cd5131af5573a06ee4edbd6cae624b), block 42567609, 1.72M gas @ 0.006 gwei = 0.000010 ETH). Live `cast call` smoke clean (owner, arbiter, USDC, GRACE_PERIOD, nextTaskId, pendingOwner).
- `release` Mainnet deploy ([tx `0x9d5131…ed6d`](https://basescan.org/tx/0x9d5131f501b0240bb03e93c2b2d8cd08af10a1122eead6586db1d2023d52ed6d), block 47057463, same 1.72M gas @ 0.006 gwei). Live `cast call` smoke clean. Address matched Sepolia byte-for-byte (ADR-0001 invariant under chain-specific immutables).
- `release` `fly deploy . --config apps/demo-agents/fly.toml` — rolling strategy, image v15. Pre-cutover `/health.activeDemoRuns = 0` (no drain window needed).
- `release` Cloudflare Pages `wrangler pages deploy out --project-name sage-protocol --branch main`. Deployment id `8b7d0e60`. Production URL `sage-protocol.pages.dev` aliased.
- `docs` **`docs/runbooks/deploy-task-escrow-v2.md` (new).** Pre-flight, dry-run, broadcast, post-deploy verify, troubleshooting. Documents launch posture (three roles → one EOA, migration path) explicitly.
- `docs` **`docs/research/arbitration-and-platform-brainstorm.md`** — accumulated decisions log updated with each milestone.

### ADR + position framing

- `adr` **ADR-0008 amendment** — "Platform extension with arbitration layer" (2026-06-04). Settlement reframed as "recorded fact" with two modes (guarantee/receipt). Sage hosts the court, not the agents. Trust profile named honestly (eBay/PayPal/Upwork category, not Compound/Uniswap). The "without arbitration" path remains canonical for trustless cases. Status: Accepted; extended.
- `adr` **ADR-0017 — Task escrow arbitration** (2026-06-04). Contract-level decisions: storage-based arbiter under `Ownable2Step.onlyOwner`, `resolveDispute(onlyArbiter)` with Paid/Refunded/Split, `Refunded` reachable only via arbiter ruling (refundExpired still writes Expired), versioned salt `:v2`, v2.0 contract stays on legacy salt. Status: Accepted.
- `research` **`docs/research/arbitration-and-platform-2026-06-04.md`** — concept snapshot of the 2026-06-04 working session that produced both the ADR amendment and ADR-0017.

### What's NOT in this release

- AgentRegistry V2 (capability + endpoint + price for foreign-agent discoverability) — M11.2.
- Off-chain council of judges + aggregation mechanism — M11.4.
- Appeal path + precedent memory — M11.5.
- Indexer for reputation surface — M11.6 (per axis A7).
- V3 deploy to Arc testnet — separate task; Arc continues to use its own contracts via the ADR-0015 bridge.

`v3.0.0` tagged on commit (this entry).

---

## 2026-05-22 — Arc composite demo END-TO-END LIVE (5 root causes fixed + 3-layer high-stakes guard)

`/demo/composite?chain=arc` is operational. Composite plans classify, approve, execute, and settle on Arc testnet through the full Pages → Worker → Fly → Arc TaskEscrow stack — the same shape Base mainnet runs on, with a chain selector at the top of the demo UI. ADR-0008's multi-chain framing is operationally true on **two parallel chains** now (Base mainnet for production; Arc testnet for the ADR-0015 bridge), not one + one scaffold.

The session bracketed two evenings (2026-05-21 wiring → 2026-05-22 e2e). Wiring landed clean on local tests; production smoke surfaced 5 distinct root causes — each documented below alongside its fix — because the previous CHANGELOG entries treated "tests green + typecheck clean" as a strong signal it would work. It wasn't. None of the bugs were visible without booting the stack on Arc with real RPC + real workers.

**Live ops:**
- Arc Fly app: `sage-demo-agents-arc.fly.dev` (1 orchestrator + 4 workers, no standby; `--ha=false`).
- Worker gateway routing: `?chain=arc` → Arc Fly; default / `?chain=base` → existing Base Fly.
- Sponsor on Arc: `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d`, ~19.8 USDC remaining after smoke.
- First settled sub-tasks on Arc: taskId 3 ([tx `0xeef83dc7…`](https://testnet.arcscan.app/tx/0xeef83dc7db1479989a601df1f722bec79825dac91d7701c582ff2d8be6ae21d5)) + taskId 4 ([tx `0x9ebc9c7c…`](https://testnet.arcscan.app/tx/0x9ebc9c7cada22cb394a62274dfd7f5722ea5a2d788d6bd148b7902bee01a11d7)).

### Wiring (pre-deploy)

- `feat` **`apps/demo-agents/fly.arc.toml` (new).** Sibling Fly config: `app = "sage-demo-agents-arc"`, `[env].CHAIN_ID = "5042002"`, `[env].CHAIN = "arc-testnet"`, `[env].RPC_URL = "https://rpc.testnet.arc.network"` (direct, no Cloudflare proxy — Arc RPC has no API key). Same image, same 5 processes as Base; production isolation per session-2026-05-21 decision.
- `feat` **`apps/demo-agents/src/shared/config.ts`** — additive Arc chain support. `AgentConfig.chain` union widened; `resolveChain` recognises `CHAIN=arc`/`arc-testnet`, `CHAIN_ID=5042002`, RPC URL sniff. `CHAIN_MAP['arc-testnet']` uses `viem.defineChain` (viem ships no native Arc) + `arcTestnet` from `@sage/adapter-evm`. Also exports `chainConfig` on the `createSageFromConfig` return so callers don't re-derive contract addresses via ternaries (see root cause #3).
- `feat` **`orchestrator/guards.ts`** `USDC_BY_CHAIN[5042002] = 0x3600…`. `orchestrator/server.ts` `EXPLORERS[5042002] = 'Arc Testnet' / testnet.arcscan.app`.
- `feat` **`apps/worker-gateway/`** chain-aware routing: `?chain=arc` (with `ORCHESTRATOR_URL_ARC` set) → Arc Fly; param stripped on forward (orchestrator knows its own chain via env). Rate limit shared across chains (a prototype-stage chain switch shouldn't double the budget).
- `feat` **`apps/web/components/demo/chain-picker.tsx` (new) + `app/demo/composite/page.tsx` + `hooks/use-composite-demo.ts`** chain-aware URLs. URL-state sync (`?chain=arc`) wrapped in Suspense for Next 15 + static export. `useCompositeDemo(chainId)` carries the selected chain; `urlFor()` decorates all four endpoints + the SSE stream URL. `runChainRef` freezes the chain at classify time as a backstop against mid-run picker changes.
- `docs` **`docs/runbooks/deploy-arc-fly-app.md` (new)** — faucet 4 worker EOAs, `fly apps create`, secrets, `fly deploy . --config apps/demo-agents/fly.arc.toml`, `/health` smoke, gateway redeploy, frontend deploy, rollback. Includes common failure modes.

### Root causes found during e2e smoke

1. `incident` **Fly machine limit reached at 20 machines org-wide.** Initial deploy succeeded (10 machines: orchestrator x2 + 4 workers + 4 standby). Subsequent `fly deploy` failed with "Your organization has reached its machine limit." even with `--strategy immediate` — `immediate` doesn't spawn temp duplicates but the baseline 10+10 across Arc + Base apps already breached. **Fix:** destroyed 4 worker standby machines on Arc (`fly machine destroy --force` for each `state=stopped` worker machine); added `--ha=false` to subsequent deploys so Fly stops auto-recreating them. Arc steady-state now 6 machines (1 orch + 4 workers + 1 autostopped orch standby), org-wide 16. Base prod stack untouched.

2. `fix` **Workers hardcoded `escrowAddress` via a `chain === 'mainnet' ? base : baseSepolia` ternary, silently misrouted to Base Sepolia contract on Arc.** All 4 worker bundles had `const escrowAddress = config.chain === 'mainnet' ? base.contracts.taskEscrow : baseSepolia.contracts.taskEscrow;`. With Arc chain, the `false` branch fired → workers polled events for `0x12aeF3…` (Base Sepolia escrow) on Arc RPC — an address with no contract → empty event stream. Confirmed via on-chain probe: `cast call nextTaskId() → 2` (tasks created), `getTask(0/1).status → 0 Created` (never accepted). **Fix:** replaced the ternary with `chainConfig.contracts.taskEscrow` from the SDK chain config that already knew about Arc via the `CHAIN_MAP['arc-testnet']` extension. Removed the now-unused `base`/`baseSepolia` imports.

3. `fix` **`viem.publicClient.watchContractEvent` does not deliver events on Arc testnet RPC** — neither in filter mode (default) nor with `poll: true`. Raw `eth_getLogs` works (verified via curl: returns both TaskCreated events for taskIds 0 and 1 with the right topic0). `eth_newFilter` succeeds and returns a filter ID; subsequent `eth_getFilterChanges` returns empty consistently. Diagnosis: Arc RPC's filter implementation is broken or doesn't index our address, and viem's `poll: true` mode under the hood still emits getLogs calls in a shape Arc rejects (likely topic-filter + narrow-range issue). **Fix:** `apps/demo-agents/src/shared/task-poller.ts` (new) — sidesteps event-log infrastructure entirely. Polls `TaskEscrow.nextTaskId()` every 15s, iterates new IDs, reads `getTask(id)` to check `executor`, dispatches to handler if `executor == myAddress`. Same callback shape as the old `watchContractEvent` setup; swapped into all 4 workers (summarizer / translator / sentiment / vision). Trade-off: ~3 RPC reads per task creation vs. one event delivery; well within the 23k/day baseline budget per GOTCHAS 2026-05-13.

4. `fix` **`createTask` reverted with `DeadlinePast()` on Arc** because the LLM classifier emitted short `deadline_offset_s` (60-90s) and Arc's inter-block timestamp variance plus tx mining latency landed `block.timestamp >= deadline` before mining. ADR-0015 verification flagged exactly this ("Multiple blocks may share a timestamp (affects deadline assertions; mitigated by deadline_offset_s minimums)") but the minimum wasn't enforced anywhere. **Fix:** `plan-runner.ts` floors `deadline_offset_s` at 600s (10 min). Math.max preserves longer LLM-emitted offsets; absorbs Arc mining + accept-window. Same floor works fine on Base (~2s blocks, no variance issue).

5. `fix` **High-stakes guard had two holes** that let auto-routing slip through and execute `send 0.1 USDC to 0xKnownWorker`-style briefs without manual assignment. First hole: `autoAssignExecutor` checked `isKnownWorker(llmAddr)` BEFORE `isHighStakesType(sub.type)` — if the LLM echoed a recipient address from the brief that happened to match a known worker EOA (e.g. `send to 0x0DA5…2593` matches Summarizer), the trust check passed silently. **Fix order #1:** swapped check order — high-stakes check now runs first, never trusts LLM-emitted executor for pay/send/book/etc. Second hole: high-stakes check only inspected per-subtask `type` string-stem matching (`'send' | 'transfer' | 'book' | 'purchase' | 'sign' | 'pay'`), but the LLM emits unpredictable types (`crypto-transaction`, `usdc-transaction`, `wallet-action` — none stem-match). Meanwhile `classify` correctly flagged `stakes: high` at the plan level. **Fix #2:** `planFromClassification` passes `plan.stakes` into `autoAssignExecutor`; guard now triggers on `planStakes === 'high' || isHighStakesType(type)`. Plan-level stakes is authoritative; type-stem is a secondary belt for low-stakes plans with one pay-shaped sub-task.

### Polish on the back of those root causes

- `feat` **`apps/web/components/demo/plan-card.tsx` — Approve button disabled when any sub-task is unassigned.** Layer-2 gate on top of `planFromClassification`'s strip (layer 1) and `plan-runner`'s spawn-time rejection (layer 3). Pink hint banner under footer with `Click Edit to assign before approving`. Polish — security already worked via layer 3, but failing earlier avoids the wasted execute round-trip + a confusing error.

### Final defense-in-depth on high-stakes (verified end-to-end 2026-05-22)

| Layer | Where | Action |
|------|------|------|
| 1 | `useCompositeDemo.autoAssignExecutor` | Strip executor on `plan.stakes='high'` OR `isHighStakesType(type)` |
| 2 | `PlanCard` | Disable Approve button when any sub-task unassigned + hint banner |
| 3 | `plan-runner.runSubtask` | Refuse to spawn TaskEscrow if executor_address missing |

Test brief `Send 0.1 USDC to 0x0DA5892C26222fF2992BEe22613d1f9C06a92593` exercises all three; through-flow only proceeds after user opens plan-editor and picks a worker deliberately.

### Tests + build (post-fixes)

- `release` **167 TS tests green** end-of-session unchanged: `@sage/core 11`, `@sage/contracts 77 + 4 invariants` (Solidity, unchanged), `@sage/adapter-evm 13`, `@sage/adapter-arc 17`, `@sage/demo-agents 126`. tsc strict clean on demo-agents, web, worker-gateway. Web build static export: `/demo/composite` 70 kB / 241 kB First Load. Suspense boundary holds.

### Decisions (rationale recorded for future readers)

- `decision` **Separate Fly app over CHAIN switch in shared app.** Production isolation (Arc bug can't affect Base prod), simpler code (no per-chain dual-paths), per-chain state segregation. Cost +$X/mo small machines. Bridge is production-equivalent per ADR-0015 maintenance commitment.
- `decision` **Inline chain picker + URL state sync over hidden query param.** Multi-chain framing visible in canonical demo, deep links shareable, refresh preserves choice.
- `decision` **`task-poller.ts` over reattempting viem event watching.** Arc RPC event delivery is broken in multiple ways; further viem-side debug had unclear cost. nextTaskId polling is dead-simple, depends only on reads that already work, and the same code path runs on Base unchanged. If Arc RPC ever fixes event indexing, we can swap back — meanwhile this is dependable.
- `decision` **`MIN_DEADLINE_OFFSET_S = 600` in plan-runner over per-chain minimums.** ADR-0015 hinted at "minimums" without specifying. 600s is comfortable for Arc inter-block variance + accept window; on Base it's invisible (LLM-emitted offsets are usually ≥600 anyway). Per-chain table can come later if any chain needs different behavior.

---

## 2026-05-21 — Arc testnet bridge LIVE (ADR-0015 deploy + adapter-evm + web wiring)

Sage's multi-chain framing from ADR-0008 is operational on two chains as of today: Base mainnet (deployed 2026-04-22) and Arc testnet (deployed 2026-05-21). The Arc deployment is the ADR-0015 *interim bridge* — our own `AgentRegistry` + `TaskEscrow` on Arc testnet via Arachnid CREATE2, retaining the ADR-0014 native-wrap direction as target for when Arc publishes ERC-8183/8004 reference contracts.

- `chain` **Arc testnet contracts deployed via `forge script DeployArc.s.sol --broadcast`.** Sponsor `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d`. Total gas ~0.043 USDC at native 18-decimal scale (~2.17M gas at 20 gwei base fee). Block 43314118 + 43314119.
  - **AgentRegistry**: `0xD100d7CE4f610dDb59C276AF293aA79F9Fcff936` — [tx `0x6fa2eff0…6fffa`](https://testnet.arcscan.app/tx/0x6fa2eff00879df8cb268cfc2c37ca1f59f8c90ccd728196257f7353a6906fffa).
  - **TaskEscrow**: `0xA9e6Dc31F21149868C0fd43C83038C74cC8Ffcdb` — [tx `0xb6ce44ab…2a37f29`](https://testnet.arcscan.app/tx/0xb6ce44abcdd1cbf7e8862ae8a13755b59ad0c43701ecfec57128cc1112a37f29).
  - **USDC** (Circle canonical, verified per ADR-0015 verification runbook): `0x3600000000000000000000000000000000000000`.
  - Salts: `keccak256("sage:arc:registry:v1")` = `0x5a687719…6ff88716`, `keccak256("sage:arc:escrow:v1")` = `0x735bb30d…ac37f5dd`. Arc-specific salts (NOT the same as Base salts — addresses differ from Base by design per ADR-0015 because CreateX is not deployed on Arc).
  - Post-deploy verification via `cast`: `TaskEscrow.USDC()` = `0x3600…`, `TaskEscrow.GRACE_PERIOD()` = 300, `AgentRegistry.owner()` = sponsor, `paused()` = false, code lengths 5320 bytes (escrow) + 3948 bytes (registry).
- `feat` **`packages/adapter-evm/src/chains/arc.ts`** populated with real addresses. `arcTestnet` exported from package index. `ChainConfig` interface: `eas` / `easSchemaRegistry` / `createX` / `x402FacilitatorDefault` made optional (Arc has none of them per `docs.arc.io`). Existing Base configs unchanged.
- `feat` **`apps/web/chains/arc.ts`** flipped from `PlannedChainConfig` to live `SageChainConfig`. Exports `ARC_TESTNET` + `ARC_TESTNET_NOTE` (UI hover text). Old `PlannedChainConfig` / `SAGE_PLANNED_CHAINS` types removed.
- `feat` **`apps/web/chains/base.ts` `SAGE_CHAINS` widened** to include `5042002 → ARC_TESTNET`. `SageChainConfig.chainId` union: `8453 | 84532 | 5042002`. `useSageChain` hook picks up Arc automatically via existing `keyof typeof SAGE_CHAINS` pattern.
- `feat` **`/docs/architecture` chain table**: Arc row flipped from `Planned · ADR-0014` to `Live (bridge) · 2026-05-21 · ADR-0015` with hover-tooltip pointing at ADR-0015. Section intro paragraph rewritten to mention Arc as live exception (Arachnid CREATE2, different addresses from Base) with both ADR-0014 (future direction) + ADR-0015 (current bridge) links.
- `docs` **`packages/adapter-arc/README.md`** rewritten: explicit "this package does NOT drive Arc traffic today, bridge does" header; table of where Arc actually flows; ADR-0014 + ADR-0015 cross-references; scaffold-to-live checklist updated (chainId / explorer / RPC items now done, ERC-8183/8004 items remain blocked on substrate).
- `docs` **`packages/adapter-arc/src/chain.ts`** chainId placeholder `'0'` → confirmed `'5042002'`; explorer URL confirmed per `docs.arc.io`. Test updated to assert the real values.
- `release` **167 TS tests green** end-of-session: @sage/adapter-evm 13 (+1 Arc shape test), @sage/demo-agents 126, @sage/core 11, @sage/adapter-arc 17. Web tsc strict clean (typecheck).
- `decision` **Arc bridge ≠ Base same-address.** ADR-0001's same-address invariant explicitly does NOT hold for Arc — `AgentRegistry`/`TaskEscrow` addresses on Arc are different from Base because CreateX is absent on Arc and the deploy used Arachnid CREATE2 with Arc-specific salts. ADR-0015 documents this divergence and the reversal path when ERC-8183/8004 native primitives arrive (the bridge retires entirely; native-wrap takes over via `@sage/adapter-arc`).

Not yet shipped (next iteration):
- Fly orchestrator + workers running against Arc — would need `sage-demo-agents-arc` app (or a CHAIN switch in existing `sage-demo-agents`).
- `/demo/composite` UI chain selector — current demo is hard-bound to whichever orchestrator URL the worker-gateway routes to.
- Worker EOAs faucet'd on Arc (sponsor is faucet'd; workers still need drips for acceptTask gas).
- End-to-end smoke on Arc through `/demo/composite`.

---

## 2026-05-21 — M10.5.B worker dual-mode rollout (translator / sentiment / vision composite-aware)

All four demo workers (`summarizer` / `translator` / `vision` / `sentiment`) are now composite-aware via a shared decoder. Composite sub-tasks routed to translator / sentiment / vision no longer produce echo-style results ("the task is to translate…"). Where the spec lacks the input the worker needs (vision URL, source text), the worker returns a structured "spec did not include X" message so the operator can fix the plan rather than receive fabricated output.

- `feat` **`apps/demo-agents/src/shared/composite-codec.ts` (new).** `decodeCompositeSpec(specUri)` + `COMPOSITE_PREFIX` constant. Permissive: any non-envelope URI or malformed envelope returns `null` (the dual-mode fall-through signal). Lives in `src/shared/` so all 4 worker bundles share one copy without pulling in `src/parent/` (worker bundles stay independent of the parent module per `apps/demo-agents/CLAUDE.md`).
- `refactor` **`summarizer/agent.ts`** — replaced inlined `decodeCompositeSpec` with import from shared codec. Behavior unchanged. 18 lines removed.
- `feat` **`translator/agent.ts` dual-mode.** Envelope detect → `COMPOSITE_SYSTEM_PROMPT` ("produce ONLY the translated text — no preamble, no commentary"). Honest-failure line "Translation requires source text in the spec" when instruction lacks source text.
- `feat` **`sentiment/agent.ts` dual-mode.** Envelope detect → composite prompt preserves 3-line structure (LABEL+score / blank / rationale) under execution semantics. Honest-failure path classifies the instruction wording itself and flags it on rationale line.
- `feat` **`vision/agent.ts` dual-mode + URL-extract.** Envelope detect → regex-extract `https?://...\.(png|jpe?g|gif|webp|bmp|svg|avif)` from the spec → describe. When no URL is embedded: returns "Vision sub-task requires an image URL in the spec; …update the plan to embed an http(s) image URL". Conservative extension whitelist avoids false positives on documentation links.
- `release` **14 new tests** in `test/shared/composite-codec.test.ts` (happy decode + unicode + 8 fall-through cases + cross-module compatibility check against parent-id-codec encoder). demo-agents 112 → 126 tests. tsc strict clean. Build clean: 4 worker bundles ~8KB each (translator +1.4KB, vision +1.4KB, sentiment +1.6KB for the dual-mode prompts; summarizer unchanged after refactor).
- `decision` **Honest-failure over fabrication.** When composite spec gives a worker insufficient input (no URL for vision, no source text for translator/sentiment), the worker emits a structured "spec did not include X" message rather than inventing output. The operator sees the gap in the per-node drawer and uses M10.5.A Retry / Change-executor to fix the plan. This pairs naturally with the dispute path: workers that can't execute say so on the result; operator triggers replan-prompt-style adjustment without involving on-chain dispute.
- `decision` **Shared codec in `src/shared/`, not inlined per worker.** Earlier summarizer comment said "inlined to keep worker self-contained". The constraint is about not depending on `src/parent/`; `src/shared/` is already shared across workers (config, env, sse, base-agent) and adding one more shared utility there preserves the bundle-independence property while removing 4× duplication.
- `docs` Parent README "Worker dual-mode contract" section rewritten: capability-by-capability table of 3-mode vs composite behavior, plus pattern for adding new dual-mode workers. Debugging entries refreshed (M10.4 deferred-rollout references removed).

---

## 2026-05-21 — Phase B / ADR-0014: `@sage/adapter-arc` scaffold + Arc as planned sibling chain

ADR-0008's multi-chain framing gets its first sibling adapter. `@sage/adapter-arc` ships as a production-shape scaffold (full ChainAdapter conformance, NotImplementedError everywhere, ADR documenting the design). The structural commitment is in code; runtime operations wait for Arc testnet stabilisation and ERC-8183/8004 reference-contract confirmation.

- `adr` **ADR-0014 Accepted** — Arc as sibling chain via `@sage/adapter-arc` over native ERC-8183 (Jobs) + ERC-8004 (Agent Identity). Sage does NOT deploy `TaskEscrow` / `AgentRegistry` on Arc — on chains with native task-escrow primitives the adapter wraps them; on chains without (Base today), Sage deploys its own. 4 alternatives considered and rejected (deploy our contracts on Arc / fork ERC-8183 / defer until mainnet / build with speculative testnet endpoints). Promoted Proposed → Accepted 2026-05-21.
- `feat` **`packages/adapter-arc/` (new package).** Production-shape: name `@sage/adapter-arc`, deps `@sage/core: workspace:*`, peer `viem: >=2.0.0`. Mirrors `@sage/adapter-evm` layout (tsup, tsconfig, vitest). Files:
  - `src/index.ts` — `createSageArcClient()` returns a typed ChainAdapter where every method throws `NotImplementedError` with a message pointing at ADR-0014 + the operation name (dotted path).
  - `src/chain.ts` — `ARC_TESTNET_CHAIN_INFO` with `chainId: '0'` (TBD when Arc publishes), `name: 'Arc'`, `explorerUrl: 'https://explorer.arc.network'` (placeholder, verify when testnet block explorer is live).
  - `src/abi/README.md` — explicit gate: ERC-8183 + ERC-8004 ABIs go here once reference contracts on Arc testnet are confirmed. Do NOT copy from draft EIPs.
  - `test/index.test.ts` — 17 conformance tests (3 structural + 14 NotImplementedError-per-op).
  - `README.md` — public-facing status + 8-item checklist for scaffold → live.
- `feat` **`apps/web/chains/arc.ts` (new).** `PlannedChainConfig` shape distinct from `SageChainConfig` (no `contracts` field — Arc doesn't get our contract deploys). `ARC` constant + `SAGE_PLANNED_CHAINS` map for any future UI that iterates planned chains.
- `feat` **`/docs/architecture` chain table.** New Arc row between Base Sepolia and Arbitrum: `Arc · Planned · ADR-0014`, hover tooltip carries `ARC.note` ("Coming when Arc testnet stabilises…"). Chains section intro paragraph mentions Arc as the exception to same-address pattern + links ADR-0014. ChainRow extended with optional `title` prop.
- `decision` **Skip silent stubs, mock RPC, fake tx hashes, hard-coded unknown chainId, ABIs copied from draft EIP.** Acceptance criteria from session 2026-05-21 (per user spec): scaffold must be production-shape package, NotImplementedError everywhere instead of silent stubs, explicit TBD comments where information is missing. Honest stake: visible structural declaration of multi-chain readiness + formal document explaining why exactly this approach on Arc. Stronger than a half-working adapter.
- `release` **17 new tests** in `@sage/adapter-arc`. demo-agents 112, @sage/core 11, @sage/adapter-evm 12, @sage/adapter-arc 17 (new) = 152 tests in TS layer. Production build clean: `@sage/adapter-arc` 2.09KB ESM + 3.21KB CJS + 4.51KB d.ts. tsc strict clean on adapter-arc + web (chain row addition + new chains/arc.ts).

---

## 2026-05-21 — M10.5.A dispute-path completion (pause-on-dispute, retry endpoint, replan-prompt buttons live)

Closes the "present-but-disabled Retry / Change-executor" wart on `/demo/composite`. The canonical demo's dispute path is now end-to-end functional; ADR-0008's "one-click verifiability" claim no longer ships with visible TODO buttons. Backend pauses on dispute via an in-memory registry instead of failing the plan; frontend's existing `replan-prompt.tsx` gains a worker picker for Change-executor.

- `feat` **`apps/demo-agents/src/parent/run-registry.ts` (new).** `awaitUserDecision(runId, subId, timeoutMs)` returns `Promise<RetryAction>` where `RetryAction = retry { newExecutor? } | cancel | timeout`. `resolveUserDecision(runId, subId, action)` returns `'ok' | 'not-found' | 'sub-mismatch'`. Default pause timeout 2 min (aggressive choice — abandoned runs don't accumulate, ergonomic for a human reading a dispute and clicking once). Test coverage: 10 unit tests.
- `feat` **`plan-runner.ts` pause-on-dispute.** `pollUntilCompleted` throws a new `DisputedError` (subclass distinct from `PlanError`) instead of a generic plan-failure. `runPlan`'s `for (const sub of order)` body now wraps `runSubtask` in a `while(true)` retry loop. On `DisputedError` → `await awaitUserDecision` → if `retry` splice executor + emit `subtask_retrying` + continue; if `cancel` or `timeout` emit `plan_failed` with `reason: 'user_cancelled_after_dispute' | 'pause_timeout'` + close. Non-dispute throws fall through to the existing failure path unchanged. Integration test: 6 scenarios (retry happy / cancel / timeout / change-executor / multi-sub-task dispute on #2 / retry then second dispute then cancel).
- `feat` **`POST /api/demo/composite/retry-subtask`** in `orchestrator/server.ts`. Body: `{ runId, subId, action?: 'retry'|'cancel', newExecutorAddress?: 0x... }`. Returns 202 on success, 404 `no_paused_run` if no pause exists, 409 `sub_mismatch` if paused-subId differs, 503 `sponsor_exhausted` if retry would re-spawn against a sponsor below the USDC floor. Validation: subId is positive integer, executor address is 40-hex.
- `feat` **`use-composite-demo.ts` `retry()` callback** + `subtask_retrying` SSE handler. `retry({ subId, newExecutorAddress? })` POSTs to the new endpoint; errors surface inline (`state.error`) without tearing down the run. `subtask_retrying` resets the runtime row to `status: 'waiting'` (keeps `txHashes` for record) and clears `disputedSubId`. Three new PostHog events: `composite_subtask_retry_requested`, `composite_subtask_retrying`.
- `feat` **`replan-prompt.tsx` enable Retry + Change-executor.** Buttons no longer `disabled`. Change-executor expands an inline picker showing the 4 worker labels + short addresses (read from `NEXT_PUBLIC_DEMO_*_ADDRESS`); clicking a worker triggers retry with that executor. Current executor is shown disabled in the picker so the user can't pick the same one. `busy` state prevents double-fire while retry is in flight.
- `decision` **2-min pause timeout** (vs. 10 or 30). Session call 2026-05-21. Public-demo flow where abandoned runs accumulate sponsor-side state — short timeout matches "user clicks within minutes of seeing the dispute" without holding memory for the inattentive case.
- `decision` **Skipped mainnet smoke for dispute path** this session. Disputes are hard to trigger naturally (depositor would have to call `disputeTask` mid-flight between `Completed` and orchestrator's `approvePayment`, a narrow window). Manual test procedure documented in `apps/demo-agents/src/parent/README.md`; unit + integration tests cover the logic without burning USDC. A dev-only `/debug/dispute-subtask` endpoint is the right next ask if disputes need regular smoking.
- `release` **194 → 210 tests green.** Demo-agents 96 → 112 (+16 across 2 new files). @sage/core 11, @sage/adapter-evm 12 unchanged. Production build clean: `/demo/composite` 68.6KB / 240KB First Load (+26KB vs M10 baseline, from picker UI + retry plumbing). tsc strict on both packages clean.

---

## 2026-05-20 — M10 complete (all 4 weeks, 38/38 tasks, live on prod)

Milestone 10 closed end-to-end. The observable-decomposition pattern is now in code, on Base mainnet, with operational telemetry, dispute-path skeleton, and a documented smoke matrix. ADR-0008 (Sage angle / position) is Accepted; the angle exists in code, not only in docs.

- `milestone` **All 38 Milestone 10 sub-tasks closed.** W1 (types + classifier skeleton, 7), W2 (real LLM + parent runtime + orchestrator endpoints, 9), W3 (frontend composite UI + prod deploy, 9), W4 (narrative close-out, operational polish, dispute path skeleton, 13). Live URL: `https://sage-protocol.pages.dev/demo/composite` → `sage-demo-agents.fly.dev/api/demo/composite/*` → Base mainnet.
- `release` **8 commits this session** since `e247e01`: `662e651` (W1+W2+W3 mega) → `079cdb4` (site-config CI fix) → `43f3f50` (.npmrc wrangler-action workspace toggle) → `f9c373c` (W3 prod-bring-up hot-fixes: auto-assign executor, drawer click, summarizer dual-mode) → `4c55425` (W4 narrative: ADR-0008 Accepted, blog, README polish, research §11) → `f98fc56` (W4 operational polish: retry hardening, PostHog 10 events, Sentry capture, smoke matrix runbook) → `879d66c` (W4 dispute path skeleton: subtask_disputed event + replan-prompt UI) → fallback-to-summarizer hot-fix landing here as the closer.
- `release` **194 tests green** end of session: @sage/core 11, @sage/contracts 77 + 4 invariants, @sage/adapter-evm 12, @sage/demo-agents 96. Production build clean (composite page 42KB / 234KB First Load, no wagmi pull-in).
- `decision` **Default-fallback to summarizer** in `resolveExecutorByType`. Previously unknown sub-task types ("flights", "itinerary", "budget" — anything outside the 4 stem-buckets) returned `undefined` and blocked the whole plan. Now they default to summarizer (which has dual-mode execution prompt) so the plan attempts execution rather than dying. Trade-off: composite plans with novel types route everything to one worker. Acceptable for v1; M10.5 + Phase B introduce a proper worker manifest and capability resolution. DevTools console warns on each fallback so the operator sees what's drifting.
- `decision` **Two known acceptable v1 limitations carried forward.** (1) Translator / sentiment / vision workers remain single-mode; composite sub-tasks routed to them produce echo-style output. The frontend stem matcher routes most types to summarizer so this rarely surfaces, but it's the next-largest gap. (2) Dispute-path Retry / Change-executor buttons are present-but-disabled in `replan-prompt.tsx`; the underlying server endpoint (`/composite/retry-subtask` + plan-runner replan-graft) ships in M10.5. Cancel works.
- `adr` **ADR-0008 Accepted** mid-session 2026-05-20. Position statement: "multi-chain settlement infrastructure for AI agents, distinguished by observable decomposition". Joins ADR-0007 (the embodiment in code) as the canonical angle pair. Reference set for external readers: ADR-0007 + ADR-0008 + `docs/research/observable-decomposition.md` + `docs/research/classification-trigger-design.md` + `docs/blog/observable-decomposition-shipped.md` (1755 words reflective) + live `/demo/composite`.
- `release` **Smoke matrix passed.** Per `docs/runbooks/m10-smoke-matrix.md` — 5 briefs + 1 classify-only high-stakes row exercised end-to-end on Base mainnet. Sponsor wallet spend ~1.0-1.5 USDC out of ~10.7 USDC reserve. All rows hit pass criteria.

---

## 2026-05-20 — M10 Week 3 shipped + Week 4 narrative close-out

- `milestone` **Milestone 10 Week 3 closed (M10.3.1–M10.3.9).** Frontend для observable-decomposition живёт на `sage-protocol.pages.dev/demo/composite`:
  - `@xyflow/react` ~12 добавлен в `apps/web/package.json` (justification: DAG-визуализация — single-purpose, ~150KB gzipped, нативные node/edge primitives).
  - `apps/web/hooks/use-composite-demo.ts` — state machine `idle → classifying → plan-ready → executing → completed|error`, SSE consumption mirror'ит `use-demo-stream.ts` shape, `planFromClassification` auto-resolves `executor_address` через stem-based mapping (`translat` → translator, `summari/compar/research/analy/write` → summarizer, `sentiment/classif/emotion` → sentiment, `vision/image/describ` → vision).
  - 4 новых компонента в `apps/web/components/demo/`: `plan-card` (read-only review + Approve/Edit/Cancel + decomposability/stakes badges + confidence pills), `plan-editor` (↑↓ reorder без drag-deps, executor dropdown, live cost), `plan-graph` (xyflow DAG с topological layout + цветами по runtime status, click handling на `onNodeClick` уровне), `subtask-drawer` (slide-out detail с executor / Task ID / timing / result / tx hashes).
  - `apps/web/app/demo/composite/page.tsx` — page orchestrator с local UI state (`editing`, `selectedSubId`).
  - Bundle: `/demo/composite` — 66KB page-specific / 234KB First Load (без wagmi pull-in — нет wallet path в composite UI).
- `release` **Live на prod 2026-05-19 ~23:00 UTC** через manual `wrangler pages deploy apps/web/out` (GH Actions workflow `deploy-web.yml` сломан pre-existing — wrangler-action монорепо-incompatible, документирован для future fix).
- `incident` **Build chain regression chain** (M10.3.9 deployment): три отдельных fix'а потребовались чтобы build прошёл end-to-end. Все коммиты:
  - `079cdb4` fix(web): `site-config.ts` `??` → `||` — GitHub Actions `${{ vars.X }}` интерполируется в `''` когда repo-var не выставлен, не в `undefined`. `??` не ловил empty string → `new URL('')` в `app/layout.tsx:16` крашил Next.js static export при `Collecting page data for /changelog`.
  - `43f3f50` fix(infra): repo-level `.npmrc` `ignore-workspace-root-check=true` — `cloudflare/wrangler-action@v3` инвокает `pnpm add wrangler@<v>` в monorepo-root без `-w` flag, pnpm v9 отказывается. Action не модифицируем, поэтому через `.npmrc`.
  - `f9c373c` fix(web,agents): три hot-fix'а после prod-bring-up: (a) `planFromClassification` теперь auto-assign'ит executor через stem-matching (LLM не эмитит executor, mock'и тоже — gap не был покрыт), (b) `plan-graph.tsx` переехал на `ReactFlow.onNodeClick` API вместо inner `<button onClick>` (xyflow's pan layer eats inner clicks — drawer не открывался), (c) `summarizer/agent.ts` стал dual-mode: detect `data:application/json,{parent,spec}` envelope → execution prompt; raw text → existing summarize prompt. Tactical fix чтобы composite results не были echo-style. Translator/sentiment/vision остаются single-mode (deferred).
- `milestone` **Milestone 10 Week 4 narrative close-out частично** (M10.4.7-10 + M10.4.9 + M10.4.12). Operational polish (M10.4.4-6, telemetry/retry/Sentry) и dispute path (M10.4.1-3) перенесены в следующую сессию.
  - `apps/demo-agents/src/parent/README.md` обновлён до production-ready: добавлен frontend section (UI компоненты), dual-mode worker contract subsection, production smoke brief patterns, expanded debugging entries, refreshed Out-of-scope statuses.
  - `docs/research/observable-decomposition.md` §11 аннотирован: 7 оригинальных вопросов получили post-build статусы (resolved / deepened / unchanged), плюс новая sub-section «Surfaced during implementation» с 6 свежими вопросами (type→executor mapping locality, worker prompt protocol, stem-matching limits, result aggregation, cost calibration, sequential-only execution).
  - `docs/blog/observable-decomposition-shipped.md` — 1755-слов reflective blog (close to ~1500 target). Что построили / что surprise'нуло (executor_address gap, single-mode workers, stakes over-conservatism, LLM type wildness) / что не сработало / что осталось открытым. Tone matches research notebook.
- `adr` **ADR-0008 Accepted** — `docs/adr/0008-sage-angle-position.md`. Формальная декларация позиционирования: «multi-chain settlement infrastructure for AI agents, distinguished by observable decomposition». 4 альтернативы рассмотрены и отклонены (general platform / Base-only / research-only / OD-only). Promoted Proposed → Accepted 2026-05-20 после Alex review.
- `decision` Артефакт-набор для external-facing audience сформирован: ADR-0007 (pattern decision) + ADR-0008 (position) + research/observable-decomposition.md (reasoning) + research/classification-trigger-design.md (technical design) + blog/observable-decomposition-shipped.md (reflective build account) + live `/demo/composite`. Это полный «как нас читать» набор.

---

## 2026-05-19 (continued — M10 Week 1 + Week 2 shipped)

- `milestone` **Milestone 10 Week 1 closed (M10.1.1–M10.1.7).** Foundation для observable-decomposition в коде:
  - `packages/core/src/types/plan.ts` — `Plan` / `SubTask` / `ClassificationResult` / `Decomposability` / `Stakes` точно по schema `classification-trigger-design.md` §4. `Plan` shape — approved-snapshot (drops classifier-only fields).
  - `apps/demo-agents/src/parent/heuristic.ts` — pure-function deterministic cross-check (composite verbs / scope quantifiers / irreversibility verbs / $-value regex). Halves `confidence_*` per §5 asymmetric-bias rule.
  - `apps/demo-agents/src/parent/classify.ts` — 5 mock templates (translate / summarize / research+report / plan-trip / send-funds) + clarify-with-user fallback. Heuristic применяется post-mock.
  - 53 unit tests added (heuristic 15 + classify 12 + plan 5 + classify-trace 9 + plan-runner и codec в Week 2).
- `milestone` **Milestone 10 Week 2 closed (M10.2.1–M10.2.9).** Live на `sage-demo-agents.fly.dev` 2026-05-19 ~20:48 UTC. Что появилось:
  - **Real LLM classifier** — `classify.ts` теперь дispatch'ит на OpenAI gpt-4o-mini через function-calling (modern `tools` API + `tool_choice`). Mock сохранён как fallback при отсутствии `OPENAI_API_KEY`. Retry-once на malformed/5xx; degraded result с `confidence_*=0` на second failure (forces composite/high — maximum ceremony per §5).
  - **Structured trace logging** — 5 JSON-line events per classify pass (`started → llm_attempt → raw → heuristic_applied → completed`), плюс `degraded` на double-failure. Stderr, готово к PostHog ingestion в M10.4.5.
  - **`parent-id-codec.ts`** — `data:application/json,{"parent":{"run","sub"},"spec":...}` envelope. encode/decode/decodeSpec. Off-chain indexer восстановит parent → sub-task graph из `TaskCreated` events.
  - **`plan-runner.ts`** — topo-sorted sequential execution (избегает nonce race на sponsor wallet), 10s polling (явно, per GOTCHAS 2026-05-13), full SSE lifecycle events (`plan_started → subtask_created/accepted/completed/paid → plan_completed`).
  - **`agent.ts`** — `executePlan(plan, bundle)` + `classifyAndExecute(brief, bundle, env)`. Регистрирует channel в общем `demoRegistry`.
  - **3 новых endpoints** в `server.ts`: `POST /api/demo/composite/classify`, `POST /api/demo/composite/execute`, `GET /api/demo/composite/stream/:runId`. Existing endpoints (`/health`, `/api/demo/start`, `/api/demo/stream/:id`, `/process`) нетронуты. Sponsor balance guard переиспользован.
  - **README** `apps/demo-agents/src/parent/` — file map, parent_id convention, lifecycle event table, curl-runbook, debugging notes.
  - Production smoke (2026-05-19 21:21 UTC): real LLM brief «plan a Tokyo trip» вернул `composite/high`, `plan_len:4`, `confidence_decomposability:0.8` (heuristic неактивен, только 1 cue), latency ~7s. Brief «research the top 3 stablecoin yield products…» — `composite/high`, heuristic halved 0.8 → 0.4 на «research» + «top N», `plan_len:2` с `depends_on:[1]` на втором sub-task'е.
- `decision` Adapter-EVM typecheck drift зафиксирован: `walletClient: WalletClient` → `WalletClient<Transport, Chain, Account>` в `task-escrow.ts` / `agent-registry.ts` / `pay-direct.ts` / `client.ts`. Удалён `as any` cast в `pay-direct.ts`. Pre-existing viem-typing шум устранён до начала M10.2.4. См. GOTCHAS 2026-05-19.
- `decision` `apps/demo-agents/package.json` получил `vitest@^3` devDep + `test` script (соответствует @sage/core). Покрывает test/parent/ — 94 теста суммарно.
- `research` **Observation (calibration):** LLM-classifier выставляет `stakes:"high"` reversible research-задачам («top 3 stablecoin yield products», «plan a Tokyo trip») за счёт ассоциации с финансовыми/денежными доменами, даже когда heuristic не флагает stakes-cues. Это та самая overconfidence/miscalibration о которой говорится в `classification-trigger-design.md` §5 caveat. Не блокер v1; ожидается, что override-driven empirical calibration (§9) исправит после ~200 user runs.

## 2026-05-19 (continued — implementation planning)

- `milestone` **Milestone 10 — Observable decomposition prototype зафиксирован.** Все три новых файла:
  - `apps/demo-agents/PARENT-PLAN.md` — детальный 4-недельный план (~3000 слов) с разбивкой по файлам, acceptance criteria, dependencies on user
  - `apps/demo-agents/CLAUDE.md` — локальный entry-point для Claude Code, открывающего эту директорию: что не трогать (production-critical), что меняем сейчас (M10), запреты (10s polling minimum, OpenAI key reuse)
  - `TASKS.md` Milestone 10 — 38 атомарных задач разбитых на 4 недели (M10.1.x types/classifier skeleton, M10.2.x LLM + parent runtime + orchestrator endpoints, M10.3.x frontend UI, M10.4.x polish + ADR-0008 + blog)
- `decision` Текущая активная работа в репо — **strictly additive**. Existing `/demo` (3-mode pipeline/sentiment/vision), 4 worker-агента, контракты на Base mainnet, ABI — не трогаются. Phase D-строить идёт через new файлы в `apps/demo-agents/src/parent/` + `apps/web/app/demo/composite/` + new types в `@sage/core`.
- `decision` Try-with-wallet UI режим скрыт в `apps/web/components/demo/task-input.tsx` (комментарий вместо `<ModeToggle>`) — wallet code paths сохранены, можно вернуть одной строкой. Снимает M9.5.3 production-blocker без чинки env vars в deploy-web.yml. `DAILY_LIMIT` в Worker rate-limit: 100 → 10 (prototype-stage default).
- `decision` Корневой `CLAUDE.md` обновлён: «Следующий шаг» теперь явно указывает на M10 + ссылается на PARENT-PLAN.md. М9 operational backlog отложен с пометкой «возвращаемся когда будет что показывать людям».

## 2026-05-19

- `decision` **Ethos refined в `CLAUDE.md`.** Sage позиционируется как мульти-чейн поставщик settlement-инфраструктуры для AI-агентов — пользователь сам выбирает чейн, мы предоставляем единый API + UI поверх. Стадия: explore-with-ambition, не go-to-market и не нейтральный research-only. Метрики adoption / MRR / customers нерелевантны; цель — выгодно отличаться на мизер через свой угол и инженерную аккуратность. Полная формулировка — в начале `CLAUDE.md` секция «Project ethos».
- `adr` **ADR-0007 Accepted** — Observable decomposition: plan-then-execute as the default flow for composite agent tasks. Композитные задачи декомпозируются внешне как граф атомарных settlement-записей, surface'ятся пользователю до исполнения как структурированный план с per-step verification gates. Двумерный trigger (decomposability × stakes) определяет UX intensity. Без контрактных изменений — pattern + tooling поверх существующих primitives (`TaskEscrow` на Base, `ERC-8183` Job на Arc). Полное обоснование в `docs/research/observable-decomposition.md`, технический design триггера в `docs/research/classification-trigger-design.md`.
- `research` Опубликованы два thinking-артефакта:
  - `docs/research/observable-decomposition.md` (~2900 слов) — статья, артикулирующая зачем выводить декомпозицию из LLM-контекста в structured artifact, где это имеет ценность, где избыточно, что остаётся открытым.
  - `docs/research/classification-trigger-design.md` (~2400 слов) — технический design LLM-driven классификатора. Двумерные оси с операционализированными определениями, signal model, structured output schema, asymmetric confidence fallback с heuristic cross-check (поскольку LLM self-reported confidence ненадёжна), open calibration questions (multi-LLM ensemble / logit-based / override-driven empirical).
- `decision` Ввели **ось A11 — composition pattern** в архитектурный реестр (closed by ADR-0007). Обновлён `docs/adr/README.md`: индекс + пересчёт ожидаемых ADR (0008–0014 включая planned `Arc as sibling chain` и `plan artifact storage`).

---

## 2026-05-13

- `incident` **Cloudflare Workers daily quota exhausted by self-polling; misdiagnosed as external leech; cascade to Alchemy auto-disable; full recovery in ~1.5h.**
  - **Trigger:** четыре demo-agent worker'а (summarizer / translator / vision / sentiment), каждый держит `watchContractEvent('TaskCreated')` через `publicClient`. viem default polling = 4s. 4 × 1 poll/4s = ~3.9 rps стабильно × 24h ≈ 86k req/day против Workers Free 100k/day квоты. Window начался ~3:00 MSK = ~00:00 UTC (новые сутки), к утру упёрлись в потолок и Cloudflare выдал `daily requests limit exceeded`.
  - **Misdiagnosis (`2d15de1`):** в логах Worker'а доминировал IP `64.34.84.125`, ASN 396356 (Climax Media Inc., Ashburn), UA `node`. Принял за external scraper-leech. Задеплоил ASN-level early-return 403. Сломал собственный Fly orchestrator: AS396356 оказался transit-карьером Fly.io в iad. Логи Fly: `Status: 403, body "Blocked"` на `eth_chainId` → orchestrator boot фейлил `resolveChainInfo` → `/health` показывал `chainId=0`. См. GOTCHAS «AS396356 в Cloudflare-логах…» про диагностическую ловушку.
  - **Cascade:** Fly down → demo broken. Параллельно Alchemy app auto-disabled Base Mainnet (тот же self-polling сжёг Alchemy free-tier CU). Цепочка восстановления потребовала: (а) пользователь re-enable Base Mainnet в Alchemy dashboard, (б) revert ASN-блока в Worker, (в) restart Fly machines чтобы boot-time `chainInfo` подхватил рабочий RPC.
  - **Real fix:**
    - `2510313` — revert ASN block; добавлена `isAuthorized` gate на `/api/rpc` в Worker: browser path = `Origin` allowlist, backend path = `x-sage-backend` shared key. Anonymous Node-clients → 403. Закрывает RPC-прокси-surface на случай настоящего external scraper'а в будущем.
    - `b5e051b` — bump `pollingInterval` с viem default 4s до 15s в `createPublicClient`/`createWalletClient`. New baseline ≈ 23k req/day от event-watching. Headroom ×4. Trade-off: average task detection latency 2s → 7.5s (negligible UX impact на demo length 11-22s).
    - Secrets staged out-of-band: `wrangler secret put SAGE_BACKEND_KEY`, `fly secrets set SAGE_BACKEND_KEY=…`. Worker version `c8a5f4d7-eba8-43de-a8a8-2cfc7feec2da` после deploy.
  - **Post-recovery verified:** `/health` показывает chainId=8453, sponsor accepting, balance 10.758 USDC. Three-path test pass: anonymous → 403; Origin browser → 200; backend key → 200.
  - **Уроки:** новые GOTCHAS — про ASN-диагностическую ловушку и про viem polling-rate × workers против free-tier квоты. Будущим worker-добавлениям — прикидывать polling volume перед deploy.

---

## 2026-05-12

- `feat` **Docs site rollout complete — 9 sub-pages live под `/docs/*`.** Закончен Bucket 3 из 2026-05-11 site-content audit'а. `/docs` переделан из card-hub'а в полноценный entry-point с sidebar-навигацией. Структура: hub + 9 sub-pages в 4 группах.
  - **Get started:** `/docs/intro` (Why Sage · the problem · 5-min mental model · where x402 fits · who it's for); `/docs/concepts` (Agents · Tasks · Escrow · Lifecycle с ASCII state-machine · Capabilities · Settlement); `/docs/getting-started` (install → connect → first task → first agent → mainnet checklist).
  - **Build:** `/docs/patterns` (full Summarizer source + diff-снипеты Translator/Sentiment/Vision + "Build your own" минимальный template + 5 design callout'ов); `/docs/use-cases` (5 сценариев — RFP / cross-language / image moderation / multi-step / sponsorship — плюс «when to reach for x402 instead» decision callout).
  - **Reference:** `/docs/api` (SDK surface — 8 task-методов + 6 agent-методов + x402/pay + 8 событий + core types + raw ABIs/chains, всё с source-link'ами); `/docs/contracts` (Solidity reference — deployment table обеих сетей + AgentRegistry/TaskEscrow методы/events/errors + TaskStatus enum + CREATE3 deterministic addresses).
  - **Operate:** `/docs/architecture` (layers diagram · money flow · chains table live+planned · security boundaries · v2.0→v3 roadmap); `/docs/security` (audit status — explicit «no external audit yet» · internal review через Slither + checklist · 4 stat-блока (77 tests, 100%, 600k invariants, 12 SDK) · threat model · responsible disclosure via GitHub Security Advisories).
  - **Shared infra:** `DocsLayout` client component с sticky sidebar (lg+) + 4-group nav · `docs-nav.ts` как single source of truth для TOC · `DocsNextLink` для page-to-page connector'ов · CodeBlock helper с optional source-link header'ом.
  - **План:** `apps/web/DOCS-PLAN.md` (в git) — описывает Phase 3.1→3.5 структуру, использовался для continuity между сессиями.
  - **Deploys:** `d1a220db` (3.1) · `21973b1a` (3.2) · `69f26cd7` (3.3) · `9db81584` (3.4) · `87488242` (3.5, final). Все на canonical alias `sage-protocol.pages.dev`.
  - **Commits:** `7744e1c` 3.1 · `6db1802` 3.2 · `43984ff` 3.3 · `f85f64d` 3.4 · `9f8d369` 3.5.
- `fix` **Site content audit Bucket 1 + 2 закрыт перед docs rollout'ом** (commits `0b7d762` + `a121c7e`). Bucket 1: исправлены 6 broken-link'ов (`site-config.FALLBACK_GITHUB` на правильный `Solitud1nem/sage`, четыре literal `https://github.com` в `/docs`, один в `/changelog`, footer `#x402` сломанный anchor на ADR-0003), `v0.1.0` → `v2.0.0` chip, четыре новых /changelog entry до текущей даты, fix `74 → 77` tests. Bucket 2: новая Home `Patterns` секция (4 карточки агентов с in/out примерами и source-link'ами), Demo CTA copy под три mode'а, две новые /docs cards (Architecture overview + Mainnet demo runs).

---

## 2026-05-11

- `feat` **Demo расширен на 3 режима: pipeline / sentiment / vision.** К существующему 2-стадийному pipeline (`Summarizer → Translator`) добавлены два single-stage агента — Sentiment (POSITIVE/NEGATIVE/NEUTRAL + score + rationale, gpt-4o-mini) и Vision (описание изображения по public http(s) URL, gpt-4o-mini-vision, hard cap 500 chars). Orchestrator теперь диспетчер по полю `mode` в `POST /api/demo/start`; per-mode валидация input shape (`text` vs `imageUrl` с http(s) проверкой) + per-mode executor address env vars (`SENTIMENT_ADDRESS`, `VISION_ADDRESS`). Frontend `/demo` получил трёхтабовый переключатель `Pipeline | Sentiment | Vision`; Vision-вкладка показывает URL-input с живым preview-thumbnail-ом; per-mode badges цены/stages/signatures читаются из shared lookup-таблиц в `task-input.tsx`. Оба хука (`useDemoStream` для Watch-live, `useWalletDemo` для Try-with-wallet) принимают `agentMode` вторым аргументом `start()` и эмитят mode-aware `DemoResult` (`summary+translation` / `sentiment` / `description`).
  - **Backend deploy:** Fly app `sage-demo-agents` подняла vision (port 3003) + sentiment (port 3004) ещё 2026-05-07 (version 7); сегодня закрыли code-side. Все 5 worker-машин live в `iad`: orchestrator x2 HA + summarizer + translator + vision + sentiment + standby-копии.
  - **Frontend deploy:** manual `wrangler pages deploy` — Cloudflare Pages deployment `58a297be.sage-protocol.pages.dev` (2026-05-11). По пути починили sitemap, который ссылался на устаревший `sage-web.pages.dev` (правильный canonical — `sage-protocol.pages.dev`, выставлено через `NEXT_PUBLIC_SITE_URL` в build env).
  - **E2E подтверждение на Base mainnet:** sentiment task #48 (`0x467c…2301`, 11.7s), vision task #49 (`0xa614…fc0d`, 13.6s), pipeline tasks #50+#51 (`0x6698…2b9e`, `0x0be2…8191`, 22.2s — pipeline-регрессия в норме, M9.7.2 baseline 22.4s). Sponsor `0x6D8a…376d` потратил ~0.004 USDC за серию.
  - **Demo executor addresses (Base mainnet):** Sentiment `0x5218857Ef2631e0AC35fA8062671785954e918B5`, Vision `0xB889a7aAe3F9a5DC1CAC68459bc5e3118D9863Fb`. В `AgentRegistry` не зарегистрированы (TaskEscrow не требует).
  - **Commits:** `1b412d2` (agents backend + mode-dispatch + Fly/Docker infra), `5ef9ba4` (web — 3 таба + wagmi mainnet для ENS), `b4a7752` (fix TaskStatus enum drift — см. GOTCHAS).
- `fix` **`TaskStatus` enum-мирор в `apps/web/lib/abi/task-escrow.ts` рассинхронизировался с контрактом.** Локальная копия стартовала с `None = 0, Created = 1, …`, on-chain enum в `ITaskEscrow.sol` — без None и `Created = 0`. `+1` дрейф давал silent timeout в Try-with-wallet poll: цикл `task.status >= Completed` крутил минутами, потому что значения никогда не совпадали. Привёл локальный мирор к контрактному порядку, добавил JSDoc с напоминанием о синхронности. Не затронуты `apps/demo-agents` (там enum идёт через `@sage/core` напрямую). См. GOTCHAS.
- `scope` **Worker `DAILY_LIMIT` временно поднят с `3` до `100`** в `apps/worker-gateway/wrangler.toml` для phase 3 ручного тестирования трёх demo-режимов. Откат → `3` после завершения тестового периода (комментарий в самом файле). Не закоммичено сознательно.

---

## 2026-04-29

- `milestone` **M9.8.1 + M9.8.3 done + sponsor-guard fix в проде.** Подготовка к `v2.0.0` тегу — launch-артефакт, hardening Fly, и активация sponsor guard.
  - **M9.8.1** — `docs/demo-runs/v2.0.0-launch.md` теперь покрывает оба mainnet-прогона: Run A (CLI orchestrator, M8.3, mock LLM, Tasks #10-#11, 0.02 USDC, 16.4s) и Run B (public browser smoke, M9.7.2, real OpenAI через Pages → Worker → Fly, Tasks #16-#17, 0.002 USDC, 22.4s) с полными tx-хэшами на createTask/approvePayment + переcказом трёх багов и фиксов.
  - **M9.8.3** — `apps/demo-agents/fly.toml`: `min_machines_running = 1` для процесса `orchestrator` (хотя бы одна горячая машина — иначе первый посетитель ловит 5-10s cold-start), плюс `[[services.http_checks]]` на `GET /health` (30s interval / 5s timeout / 20s grace). Сохранены комментарии, которые `fly launch --copy-config` стрипнул в первой версии. После `fly deploy` проверено в проде: машина живёт >1h без трафика (auto-stop не срабатывает), 2/2 checks passing, http-check вытаскивает реальный `/health` JSON.
  - **Sponsor guard fix** — `fly secret SPONSOR_MIN_BALANCE_USDC=1000000` (раньше было `=1`, что парсится как 1 base unit USDC = 0.000001 USDC и эффективно отключало guard — см. GOTCHAS). Теперь `/health` показывает `minBalanceUsdc:"1.000"`; при балансе < 1 USDC orchestrator вернёт 503 на `POST /api/demo/start` с `sponsor_exhausted` вместо того, чтобы принять demo и упасть на `createTask`.
- `deploy` **M9.3.1 done — Fly.io app `sage-demo-agents` создан** (org `personal`, region `iad`, no-deploy). Hostname `sage-demo-agents.fly.dev` совпал с `ORCHESTRATOR_URL` в `apps/worker-gateway/wrangler.toml` — Worker passthrough `/api/demo/*` менять не пришлось. Admin: `https://fly.io/apps/sage-demo-agents`. `fly.toml` сохранён как был (через `--copy-config`). Дальше — M9.3.2 (secrets) + M9.3.3 (deploy).
- `milestone` **M9.7.2 done — browser smoke на Base mainnet прошёл.** Watch-live из `https://sage-protocol.pages.dev/demo` отработал полный 2-стадийный цикл: Tasks #16 (summarize, `0x49ad…5021`) + #17 (translate, `0x971c…0c06`), 22.4s, 0.002 USDC. По пути починили три бага, обнажившихся только в продовом стеке (см. `GOTCHAS.md`):
  1. **SSE-канал глотал ошибки** (`e0bcce4`): `attach()` для закрытого канала отдавал HTTP 410 без replay буфера, а `runDemo`-ошибки писались только в SSE и не попадали в `fly logs`. Теперь `console.error` в catch + всегда replay буфера.
  2. **SDK грузил Sepolia-USDC на mainnet** (`7030cca` + `fly secret CHAIN=mainnet`): `resolveChain()` определял сеть по подстроке `"mainnet"`/`"sepolia"` в RPC URL, а Cloudflare Worker-URL не содержит ни той, ни другой → fallback в Sepolia. Теперь `CHAIN_ID` env авторитетен, URL-сниф остался как last-resort.
  3. **Nonce-гонка sponsor'а между стейджами** (`2c53372`): после `approvePayment` (stage 1) сразу шёл `createTask` (stage 2) с тем же nonce — первый ещё в mempool, второй летит в ноду как `replacement transaction underpriced`. Решено `await publicClient.waitForTransactionReceipt({ hash })` между стейджами; +2–4s к total runtime ради детерминизма.
- `deploy` **M9.3 done — Fly.io orchestrator live.** `fly deploy` собрал 73 MB образ, поднял 5 machine'ов (`orchestrator` x2 HA + `summarizer` + `translator` + 2 standby), DNS для `sage-demo-agents.fly.dev` встал. `/health` отдаёт `{chainId: 8453, sponsor: {address: 0x6D8a…376d, balanceUsdc: "10.800", accepting: true}}` — и напрямую через Fly, и через Worker passthrough `sage-gateway.a-t-somnia.workers.dev/health`. Понадобился фикс контекста сборки: `Dockerfile` ожидает репо-root (видит `packages/core`, `apps/demo-agents`), а `fly deploy` из `apps/demo-agents/` отправлял только этот каталог. Решение — `.dockerignore` на репо-root + `fly deploy . --config apps/demo-agents/fly.toml --dockerfile apps/demo-agents/Dockerfile` из репо-root. Зафиксирован gotcha (см. `GOTCHAS.md`): `SPONSOR_MIN_BALANCE_USDC` парсится в base units USDC (6 decimals), `=1` означает 0.000001 USDC, не 1 USDC.
- `chore` **M9.3 prep committed** (`049c778`) — `tsup.config.ts` с тремя entrypoint'ами под `[processes]`, role-specific приватники (`SUMMARIZER_PRIVATE_KEY` / `TRANSLATOR_PRIVATE_KEY` оверрайдят `PRIVATE_KEY`), `@types/node` + `tsconfig types: ["node"]`, `ALLOWED_ORIGINS` → `sage-protocol.pages.dev,sage.xyz`. По пути починен typecheck в `shared/config.ts` (CHAIN_MAP сужался до `typeof base` — заменено на общий `Chain`) и `orchestrator/demo-run.ts` (executor оборачивается в `agentId()` brand helper).

## 2026-04-27

- `deploy` **Pages live at `https://sage-protocol.pages.dev`** — фронт реально публично доступен. Прошлая deploy-сессия (Opus 4.6) задеплоила Worker `sage-gateway` корректно, но Pages-проект остался в подвисшем состоянии: `deploy = success` + `queued = active` одновременно, `aliases: null`, DNS `*.pages.dev` отдавал `NXDOMAIN`. Деплоймент-specific URL `<id>.sage-protocol.pages.dev` работал, главный — нет. Лечение: удалить проект через API + создать заново + сразу `wrangler pages deploy` — alias встал корректно. В commit-сообщении 036290e ошибочно фигурировал `sage-web-8nz.pages.dev` / project `sage-web` — галлюцинация, реальный проект всегда был `sage-protocol`. Runbook + workflow default обновлены, gotcha про `queued`-зависание задокументирован в `docs/runbooks/deploy-frontend-cloudflare-pages.md`.
- `fix` **Worker CORS** — `apps/worker-gateway/wrangler.toml` `ALLOWED_ORIGINS` теперь включает `https://sage-protocol.pages.dev` (раньше только `sage-web.pages.dev` — несуществующий). Worker передеплоен.

## 2026-04-24

- `milestone` **M-INT.8 complete (code side)** — web polish + deploy scaffolding. Cookie-consent баннер с lazy-import PostHog через `localStorage` флаг (`sage:cookie-consent:v1`), так что `posthog-js` не попадает в initial bundle. Sentry client/server/edge configs — no-op без DSN, игнорирует user-rejected wallet errors. Centralised `lib/site-config.ts` — единый источник для `siteConfig.url` + `siteConfig.github`, env-override через `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_GITHUB_URL`; nav и footer читают его (больше нет `https://github.com` placeholder'ов). Metadata routes через Next 15: `app/icon.tsx` (32×32 purple favicon), `app/opengraph-image.tsx` (1200×630 бренд-карточка), `app/robots.ts`, `app/sitemap.ts`. Layout получил расширенный metadata (`metadataBase`, `twitter`, `robots`, keywords). New workflow `.github/workflows/deploy-web.yml` — build + `cloudflare/wrangler-action@v3` publish to Pages. Runbook `docs/runbooks/deploy-frontend-cloudflare-pages.md` с полным списком env vars + секретов. Осталось операционное: создать Pages-проект, DNS для `sage.xyz` + `api.sage.xyz`, залить секреты в GitHub Actions.
- `chain` **M8.2 complete — Base mainnet deployment.** Контракты задеплоены на Base mainnet через CreateX + CREATE3. Адреса совпадают с Base Sepolia (ADR-0001 детерминистичный deploy).
  - Deployer: `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d`
  - AgentRegistry: `0x5e95F92FeEb4D46249DC3525C58596856029c661` — deploy tx [`0x192b41bc…99f6`](https://basescan.org/tx/0x192b41bcaf62a85bd007a3dbe6f384576b13eeae6f6570e01b775112183199f6)
  - TaskEscrow: `0x12aeF3529b8404709125b727bA3Db40cD5453E1e` — deploy tx [`0xbf3c1764…a40c`](https://basescan.org/tx/0xbf3c176409826aed34afcb56a4f1bc912b5b73624ea9e9dee4c1de842326a40c)
  - Next: M-INT.8 (web polish + deploy) и M8.3 (e2e mainnet демо с реальным USDC — требует funded sponsor + agent wallets).

## 2026-04-23

- `adr` **ADR-0006 Accepted** — web frontend integration topology. Static export on Cloudflare Pages + Alchemy RPC behind Cloudflare Worker proxy + Fly.io for demo-agents + PostHog analytics + $20 USDC sponsor wallet для Watch-live mode with 3/IP/day rate limit.
- `milestone` **INTEGRATION.md** written at `apps/web/INTEGRATION.md` with milestones M-INT.1 through M-INT.8 (10–12 days solo).
- `extract` Claude Design artifacts pulled into repo: `apps/web/styles/tokens.css` (6.4 kB, locked tokens) + `apps/web/design-reference/{Home,demo,wallet-modal,design-system}.txt` with full component specs.
- `milestone` **M-INT.1 complete** — `apps/web/` scaffolded. Next.js 15 App Router + Tailwind v4 + wagmi v2 + viem v2 + ConnectKit + @tanstack/react-query + PostHog (lazy after consent) + Sentry hooks. Layout shell (nav + footer) with ConnectKit button, Home hero rendering against real Base-mainnet addresses in read-only mode, `/demo` placeholder. Chain config at `chains/base.ts` (mainnet + Sepolia), wagmi config at `lib/wagmi.ts`, tokens.css mapped into Tailwind v4 via `@theme` block in `globals.css`.
- `milestone` **M-INT.2 complete** — read-only on-chain + full Home sections. `useLiveTxStream` hook (viem `getLogs` for 10k-block history + `watchContractEvent` for tail), formatted TxRow with opacity-stepped rows (1 → 0.6), empty/loading/error states. Four Home sections now live with real anchors: `#how-it-works` (4 StepCards with cyan/purple/pink/green accents per lifecycle stage), `#integrate` (3-tab code block: client.ts / agent.ts / contract.sol using real `@sage/adapter-evm` API), `#live` (LiveStream panel subscribing to `TaskCreated/Accepted/Completed/Paid/Disputed/Expired`), Demo CTA. Event ABIs parsed at build via `parseAbi` in `lib/abi/task-escrow-events.ts`.
- `milestone` **M-INT.3 complete** — wallet-connect polish + docs/changelog placeholders. `/docs` page with four real-link cards (Basescan contracts, ADRs, PRD+PLANNING, INTEGRATION.md). `/changelog` page with highlight timeline. wagmi connectors updated: Coinbase Wallet accepts both Smart Wallet and regular (preference 'all'), MetaMask + WalletConnect get dApp metadata for modal headers. Nav `/docs` and footer `/changelog` links no longer 404.
- `milestone` **M-INT.4 complete** — SSE endpoints + Fly.io deploy config for orchestrator. `SseChannel` + `SseRegistry` primitives with ping-every-15s keep-alive, buffer replay for late-connecting clients, 5-min retention after close. Orchestrator server rewritten: `POST /api/demo/start` → returns `{ demoRunId, streamUrl }`, `GET /api/demo/stream/:id` → keep-alive SSE stream of lifecycle events, `/health` shows active-run counter, legacy `/process` kept for curl. `demo-run.ts` decomposes the two-stage (summarize → translate) orchestration into labelled `stage_started/task_created/task_accepted/task_completed/task_paid/done` events. Env validation via hand-rolled zod-style guards. Multistage Dockerfile (pnpm 9 → builder → slim runtime, non-root user), `fly.toml` with three processes (orchestrator public / summarizer+translator internal only) on shared-cpu-1x 512mb. Deploy runbook at `docs/runbooks/deploy-demo-agents-flyio.md`.
- `milestone` **M-INT.5 complete** — `/demo` page drives live task lifecycle via SSE. `useDemoStream` hook: POST /api/demo/start → EventSource → dispatches `run_started/stage_started/task_created/task_accepted/task_completed/task_paid/done/error` into reducer-style DemoState (status, currentStage, per-step status, tx-by-step, accumulated txHashes, event log, final result). Five components: `TaskInput` (Watch live / Try with wallet toggle — wallet mode stubbed for M-INT.6), `StepTracker` (4 nodes, waiting-dashed → active-pulsing-ring → complete-filled-check with Basescan tx link each), `EventLog` (mono scroll with color-coded event names, auto-scroll to newest), `ResultPanel` (reveal animation, summary + translation side-by-side, metrics row for duration/USDC/tx-count, tx-hash chips), `ErrorPanel` (troubleshooting copy + retry). `demo-reveal` keyframe added to globals.css. Stage-aware status chip: idle → "summarizing · 1/2" → "translating · 2/2" → settled.
- `milestone` **M-INT.6 complete** — Try with wallet mode (BYO-wallet flow). EIP-2612 USDC permit signing via `viem.signTypedData` (domain "USD Coin" v2, 15-min permit window), TaskEscrow write ABI for `createTask` + `approvePayment` + `getTask`, `useWalletDemo` hook runs both stages sequentially: connect wallet → sign permit → writeContract createTask → poll TaskAccepted/Completed from chain → writeContract approvePayment → repeat for translate. Hook exports same DemoState shape as SSE hook so StepTracker/EventLog/ResultPanel stay mode-agnostic. `TaskInput` updated: wallet mode shows real USDC balance (`useReadContract`) with insufficient-balance warning, Connect-wallet CTA when disconnected, "Run with my wallet →" CTA when ready. 4 signatures per full run (2 permits + 2 approves) with auto-continue between stages. Demo page swaps hooks on mode switch with state reset.
- `fix` **Chain-selection bug** — hooks no longer hardcode Base mainnet. New `useSageChain()` reads `useChainId()` from wagmi, returns the matching SageChainConfig from `SAGE_CHAINS` (or BASE_MAINNET fallback with `isSupported: false` flag for unknown chains). Updated `useLiveTxStream`, `useWalletDemo`, `LiveStream` component, `TaskInput` WatchMeta/WalletMeta — all follow the connected wallet's chain now. Error paths added: unsupported-chain warning in WalletMeta, `Switch to Base mainnet or Base Sepolia` error in useWalletDemo. Live tx stream resets on chain switch to avoid cross-chain pollution. Hero left untouched (marketing showcase of canonical mainnet deploy).
- `fix` **Watch-live chain honesty** — orchestrator now resolves its own chainId at boot via `publicClient.getChainId()` and echoes `{ chainId, chainName, explorerUrl }` on both `/health` and `/api/demo/start` responses. `DemoState` gained `chainId/chainName/explorerUrl` fields; `useDemoStream` captures them from the start-response, `useWalletDemo` sets them from `useSageChain()`. `StepTracker` and `ResultPanel` now take `explorerUrl` as prop and build tx-links against the actual chain where transactions landed (no more hardcoded Basescan). New `useOrchestratorInfo()` fetches `/health` once and `TaskInput` WatchMeta shows "Runs on Base Sepolia" or "orchestrator offline" honestly; if wallet is on a different chain than orchestrator, shows a clarifying note instead of pretending they match.
- `milestone` **M-INT.7 complete** — sponsor guard + Cloudflare Worker gateway. Orchestrator `guards.ts` reads USDC.balanceOf(sponsor) per chain (Base mainnet / Sepolia), classifies healthy/low/critical; `POST /api/demo/start` returns HTTP 503 with `sponsor_exhausted` below threshold; `/health` surfaces `{ address, balanceUsdc, minBalanceUsdc, level, accepting }`. Set `SPONSOR_MIN_BALANCE_USDC=0` to disable for local dev. New `apps/worker-gateway/` Cloudflare Worker: `/api/rpc` proxies to Alchemy with hidden `ALCHEMY_KEY` secret, `/api/demo/*` passthrough to Fly.io with D1-backed `3/IP/UTC-day` rate limit on `/api/demo/start` only (SSE stream untouched so started runs finish). Returns 429 with `Retry-After` + `X-RateLimit-*` headers. CORS allow-listed via `ALLOWED_ORIGINS` env var. Schema in `schema.sql`, wrangler config + deploy runbook (`docs/runbooks/deploy-cloudflare-worker.md`) + README. Frontend gets free rate-limit surfacing via existing ErrorPanel (the 429 JSON comes out as `rate_limited` error message).

## 2026-04-22 (continued — coding session)

- `release` **v2.0 code complete.** All 8 milestones (M1–M8) implemented in a single coding session:
  - M1: pnpm monorepo scaffolded (core, adapter-evm, contracts, demo-agents)
  - M2: AgentRegistry + TaskEscrow — 100% test coverage, 74 tests (unit + integration + fuzz + invariant)
  - M3: CreateX deploy scripts + Base Sepolia deployment
  - M4: Full SDK `@sage/adapter-evm` — createSageClient, agent/task operations, event subscriptions
  - M5: x402 integration via @x402/fetch + payDirect escape-hatch
  - M6: Demo agents (Orchestrator, Summarizer, Translator) with OpenAI + mock fallback
  - M7: Security review — Slither clean, 600k invariant calls, security checklist
  - M8: Mainnet runbook ready
- `chain` **Base Sepolia deployed.** AgentRegistry: `0x5e95f92feeb4d46249dc3525c58596856029c661`, TaskEscrow: `0x12aef3529b8404709125b727ba3db40cd5453e1e`
- `milestone` **Mainnet deploy pending** — requires funded deployer on Base mainnet. Runbook ready at `docs/runbooks/deploy-base-mainnet.md`.

## 2026-04-22 (planning)

- `adr` **ADR-0004 Accepted** — settlement currency v2.0: USDC-only + EIP-2612 permit. Multi-token whitelist рассмотрен, отклонён для v2.0 из-за disproportionate cost; отложен в v2.1 через отдельный ADR и, вероятно, отдельный `TaskEscrowMultiToken` (новая соль CREATE3).
- `adr` **ADR-0005 Accepted** — repo structure: pnpm monorepo + Foundry + viem. Структура `packages/{core, adapter-evm, contracts, indexer}` + `apps/{demo-agents}`. v1 Hardhat-тесты не портируются (greenfield v2).
- `milestone` **Все blocking-оси закрыты** (A1, A2, A3, A4, A8). JIT-оси остаются (A5, A6, A7, A9, A10) с дефолтами.
- `sdd` **Planning завершён.** Сгенерированы `PRD.md`, `PLANNING.md`, `TASKS.md` (43 атомарных задачи в 8 milestones). AGENTS.md обновлён session-workflow секцией.
- `milestone` **Готовы к коду.** Следующая рабочая сессия = M1.1 из TASKS.md.

## 2026-04-21

- `rebrand` **AgentPay → Sage.** Проект пивотнут с LitVM-only на chain-agnostic multi-chain. Новый workspace: `D:\Sage\`. v1 в `D:\AgentsPay\` — archived reference.
- `scope` **EVM-first, non-EVM extensibility.** v2.0–v2.x — только EVM-сети (Base primary, затем Arbitrum/OP/BNB). Solana/NEAR — v3+.
- `decision` **x402 принят как транспорт pay-per-call.** `InferenceMarket.sol` из v1 — deprecated. Sage фокусируется на task-level escrow.
- `decision` **LitVM Builders Program submission отменён** в исходной форме. LitVM может стать одной из поддерживаемых сетей как opt-in adapter.
- `scaffolding` Создана базовая структура `D:\Sage\`: README, CLAUDE.md, AGENTS.md, IDEAS/GOTCHAS/BACKLOG, docs/{adr,architecture,runbooks}. KB-dossier `project-sage` создан; `project-agentpay` помечен archived.
- `adr` **ADR-0001 Accepted** — deterministic contract addresses через CreateX + CREATE3 + versioned salt. Единый адрес `AgentRegistry` / `TaskEscrow` на Base, Arbitrum, OP, BNB. zkSync / Polygon zkEVM исключены из same-address-набора в v2.
- `adr` **ADR-0002 Accepted** — agent identity: anchor-registry на Base + EAS-аттестации для профиля + single EOA на всех EVM + spoke-chains без registry (только TaskEscrow).
- `adr` **ADR-0003 Accepted** — x402 как единственный транспорт для pay-per-call; `InferenceMarket.sol` из v1 окончательно deprecated и не переносится. Sage-контракты фокусируются только на task-level escrow. Формализация ранее принятого D5.

## 2026-04-20 (v1, archived)

- `release` AgentPay v1 код завершён: 46 contract tests + 21 SDK tests, все 22 TASKS закрыты. Deploy на LiteForge testnet отложен.

## 2026-04-10 (v1, archived)

- `init` AgentPay v1 начат как LitVM-native протокол для Builders Program. См. `D:\knowledge\projects\project-agentpay.md` (archived).
