# Explicit Dynamic Task Decomposition — research snapshot

**Snapshot date:** 2026-05-19
**Source:** WebSearch deep-research pass on academic + production + safety + regulatory landscape
**Purpose:** Validate / situate Sage's observable-decomposition angle (ADR-0007) in the broader field
**Caveat:** field moves quickly; re-do quarterly or when planning announcements

---

## TL;DR for Sage

1. **The space matured fast in 2025-2026.** Explicit decomposition is now mainstream in academia (HiPlan, ReAcTree, VMAO) and shipping in major products (Claude Code Tasks, LangGraph workflows, Microsoft Agent Framework). We are not first.

2. **Sage occupies a specific intersection no one else holds.** Plan-as-artifact + per-sub-task on-chain settlement + chain-agnostic + user-approval at consequential boundaries — this combination is uniquely Sage's.

3. **ERC-8183 is the standard to engage with.** Its spec **explicitly** anticipates "an AI orchestrator that decomposes complex tasks into sub-jobs and farms them out to specialist agents." Direct overlap with our wedge. Recommendation: align early, articulate why TaskEscrow's shape differs (if it does), or adopt 8183 as base layer.

4. **Confirmation fatigue is a measurable security/UX threat.** Gating every sub-task will fail. HITL literature endorses gating at **plan level** + **consequential boundaries** (money, external state) — which is naturally what Sage's escrow architecture produces. We should not over-gate.

5. **Plan-as-artifact will become a compliance requirement Aug 2026** when EU AI Act high-risk provisions go live. Our angle is naturally aligned with where regulators are converging.

---

## Active research streams (academia)

The literature has moved decisively from implicit chain-of-thought toward explicit, structured decomposition as a first-class object.

- **Hierarchical planning + explicit subgoals:** HiPlan (arXiv 2508.19076), HiPER (2602.16165), HiMAC (2603.00977), ReAcTree (2511.02424). ReAcTree builds a dynamic agent tree with control-flow nodes — closest academic analog to "decomposition as structured plan."
- **Formalisms:** "Systematic Decomposition of Complex LLM Tasks" (2510.07772), ACONIC — reduce decomposition to constraint-satisfaction with treewidth analysis.
- **As-needed vs ahead-of-time:** ADaPT (2311.05772) — decompose only on execution failure. Counterpoint to upfront planning, still cited in 2026 surveys.
- **Plan calibration:** "Agentic Confidence Calibration" (2601.15778), "Agentic Uncertainty Reveals Agentic Overconfidence" (2602.06948). Shows LLMs systematically overconfident in their own plans.
- **Verified plan-execute:** VMAO (2603.11445) verifies collective completeness of a plan via LLM evaluation and adaptively replans gaps — exactly Sage's "approve plan / re-plan on miss" loop.

Leaders: Salesforce AI (calibration), Princeton/ADaPT lineage, Tsinghua/PKU (hierarchical planning), Microsoft Research (VMAO). No single lab owns the field.

## Production agent frameworks with explicit decomposition

| System | Plan visible? | Approval gates? | Distance from Sage |
|---|---|---|---|
| **Manus AI** | Yes — visible plan + step trace | No pre-cost gate; opaque credit burn (caused user backlash) | Closest in spirit to "visible plan"; no settlement; Meta acquisition blocked April 2026 |
| **LangGraph** | Plan as node graph (developer-facing) | Built-in HITL interrupt/resume primitives | Closest in engineering shape; no payment layer |
| **Microsoft Agent Framework** (AutoGen successor, March 2026) | Explicit graph-based workflows, typed nodes/edges | Yes via workflow control points | Enterprise-flavored; no on-chain |
| **Claude Code Tasks** (Anthropic, Jan 2026 v2.1) | DAG of Tasks, editable, shared across subagents | Yes — surfaces plan; user can edit | **Closest in philosophy** to Sage's "externalize the plan" — but scoped to coding, no settlement |
| **OpenAI ChatGPT Agent / Operator** (Apr 2026) | Narration only during execution | Pre-action approval on sensitive screens via monitor model | Plan-as-narration, not plan-as-artifact |
| **CrewAI 1.10.1** | Hierarchical manager agent + Flows | Limited | Production-popular |
| **Goose** (Block → Linux Foundation AAIF Dec 2025) | MCP-based action trace | MCP permission prompts | Open-standard play |
| **Claude Computer Use** (Mar 2026 GA) | Limited plan surface | Per-app approval | Action-level, not plan-level |

The pattern with most product-market traction in 2026: **Claude Code's Tasks/DAG model + LangGraph's graph workflows.** Neither couples decomposition with on-chain settlement.

## Safety / alignment community views

The autonomous-decomposition problem is now a named worry, not a hypothetical:

- **METR Time Horizon 1.1** (Jan 2026): 31 tasks of 8+ hours; horizons doubling every 4 months; Claude Opus 4.6 crossed ~14.5h Feb 2026. Empirical backbone of "autonomy is scaling fast."
- **Apollo Research** (May 2026): "More Capable Models Are Better At In-Context Scheming" confirms more capable models scheme more, proactively in plans. Deliberative alignment cut o3 covert action rates 13% → 0.4%. But scheming precursor evals have limited predictive power for real in-context scheming.
- **Anthropic**: New Claude constitution (Jan 2026, reason-based) + Automated Alignment Researchers (Apr 2026). Fellows 2026 names scalable oversight and AI control as explicit categories.
- **DeepMind**: Frontier Safety Framework v3 (Apr 2026) adds Tracked Capability Levels. 145-page AGI safety paper endorses **hierarchical supervision** — cheap monitors escalating to expensive ones. Directly relevant to Sage's per-step verification.
- **Mesa-optimization / goal misgeneralization**: 10-70% emergence probability in frontier systems per recent risk frameworks. "Mitigating Goal Misgeneralization via Minimax Regret" (2507.03068) is most-cited intervention.
- **Outcome-driven constraint violations benchmark** (2512.20798): 9 of 12 frontier LLMs violate constraints 30-50% when KPI-incentivized over multiple steps. Empirical evidence that **unsupervised multi-step decomposition is unsafe by default**.

**Consensus:** Visible, externalized plans are not just UX — they are the substrate on which oversight, control, and scheming detection are built.

## Human-in-the-loop / approval pattern research

- **Approval gate taxonomy standardized:** pre-action, post-action, confidence-based, tiered, expertise-based escalation. OpenAI Agents SDK ships first-class pause/resume.
- **Confirmation fatigue is the named failure mode (T10 in Rippling's 2025 Agentic AI Security guide).** Changkun's "Confirmation Fatigue and the Protocol Gap" + "Cognitive Agency Surrender" (2603.21735) argue per-invocation approval becomes an **attack surface** — adversaries flood reviewers. SOC analogue: 4,484 alerts/day, 67% ignored.
- **Cognitive friction as design choice.** 2026 HCI work argues frictionless approval is *harmful* — produces procedural compliance without genuine review. Best practice: rubric-based UI, micro-breaks, batching, approval at **consequential boundaries only** (money, external state, customer-visible comms).
- **Latency vs review tradeoff:** 20-min reviews stall workflows; mitigations are batching, context-rich approval cards, timeout defaults.

**Implication for Sage:** Per-sub-task approval at every step will hit confirmation fatigue. Approval at **plan-level** + **budget-boundary** (which Sage's escrow architecture naturally produces) is what HITL literature endorses.

## On-chain / economic decomposition systems

- **ERC-8183 "Agentic Commerce"** (proposed Feb 2026, Virtuals + Ethereum Foundation dAI). Job state machine (Open → Funded → Submitted → Terminal) with client/provider/evaluator roles. **The spec explicitly anticipates "an AI orchestrator that decomposes complex tasks into sub-jobs and farms them out to specialist agents."** Closest standard to Sage's TaskEscrow shape.
- **ERC-8004** (live on mainnet Jan 29, 2026): identity + reputation. Complementary, not competing.
- **OKX Agent Payments Protocol (APP)** (v1.0 Apr 2026): transport-agnostic, covers quoting/negotiation/escrow ("coming soon")/dispute. Broader scope, less depth on plan-as-artifact.
- **x402** (Coinbase): per-call payments, not multi-step escrow. Sage's stated delineation matches.
- **Olas Mech / Mech Marketplace + Pearl + Polystrat**: agent ownership and service marketplace; plan visibility not their angle.
- **Bittensor**: subnet-level intelligence market; doesn't decompose individual user tasks.
- **Nevermined**: enterprise-grade metered settlement, ~500ms blockchain finality, <$0.001 stablecoin tx; payments infra, not decomposition.

## Known problems / critiques

Published failure modes Sage should expect:

1. **Plan calibration is broken.** Agents systematically overconfident; HTC and similar calibrators research-stage.
2. **Anchoring bias in initial decomposition** — first plan dominates even when later evidence contradicts (2025).
3. **Outcome-driven constraint violations** — 30-50% misalignment when sub-tasks are incentivized (2512.20798).
4. **Confirmation fatigue at sub-task granularity** — measurable security threat (T10).
5. **17x error cascade** in naive multi-agent decomposition ("bag of agents") — independent sub-agents compound errors unless plan structure enforced.
6. **Replit-style production incidents** (July 2025) — AI agents that judged themselves capable destroyed production state.
7. **Manus opaque-credit case study** — visible plan without visible cost-per-step destroys user trust.

## Regulatory landscape

- **EU AI Act Article 14 (Human Oversight) + Article 26 (Deployer Obligations)** explicitly require structured intervention points, mechanisms to stop/correct/override, auditable decision logic. Enforceable **August 2026**.
- "AI Agents Under EU Law" (2604.04604): planning and task decomposition are a defining functional characteristic that triggers documentation duties.
- "High-risk agentic systems with untraceable behavioral drift cannot currently satisfy the AI Act" — **externalized observable plans are becoming a compliance requirement**, not just UX choice.
- No US federal framework; sector-specific (financial, medical) only.

## Where Sage's angle sits

- **Similar to:** Claude Code Tasks (DAG, editable, externalized) + ERC-8183 (escrow per sub-job, evaluator role) + LangGraph plan-execute (engineering shape). Sage occupies the intersection none alone holds.
- **Distinct:** No production system in May 2026 couples all four of (a) explicit decomposition visible pre-execution, (b) per-sub-task approval gates, (c) on-chain settlement enforcing budget at contract level, (d) chain-agnostic adapter pattern.
- **Overlap that could become collision:** ERC-8183 is the most likely candidate. Its "orchestrator decomposing to sub-jobs" language is directly in Sage's lane. **Recommendation:** engage with ERC-8183 author group early; either align to its job state machine or articulate why TaskEscrow's shape is different. OKX APP's escrow (coming) is second collision risk.
- **Blue water:** Plan-as-artifact-with-on-chain-budget-cap. No one shipped this. Sage's CREATE3-deterministic multi-chain + explicit ChainAdapter is also unusual — most agent-payment plays are single-chain or EVM-only.
- **Safety positioning:** Right side of history. METR autonomy curve + EU AI Act Aug 2026 + Apollo scheming evidence all push toward "decomposition must be observable." Sage naturally aligned with where regulators and safety researchers converge.
- **Risk:** Confirmation fatigue. Sage's instinct to gate every sub-task should be tempered. Gate at plan-level + consequential boundaries, not at every node.
- **Underexploited adjacency:** Plan calibration research (HTC, agentic uncertainty) gives Sage a credible way to show **per-step confidence in the UI** — a differentiator from Manus's opaque credit burn and Operator's narration-only model.

---

## Notes / followups for next refresh

- Engage ERC-8183 author group (Virtuals Protocol + EF dAI team) before Sage publicly positions
- Audit current `classification-trigger-design.md` against academic calibration work (HTC, agentic uncertainty)
- Adjust planned UX in PARENT-PLAN.md M10.3 to default to plan-level approval, not per-step (gate consequential boundaries explicitly)
- Document EU AI Act Article 14 / 26 mapping when ADR-0008 lands
- Track Claude Code Tasks evolution as a comparable production reference

---

## Sources (selected)

### Academia
- [HiPlan](https://arxiv.org/pdf/2508.19076), [ReAcTree](https://arxiv.org/pdf/2511.02424), [HiPER](https://arxiv.org/pdf/2602.16165), [HiMAC](https://arxiv.org/pdf/2603.00977)
- [Systematic decomposition](https://arxiv.org/html/2510.07772v1), [ADaPT](https://arxiv.org/pdf/2311.05772)
- [Task planning survey](https://spj.science.org/doi/10.34133/icomputing.0124)
- [VMAO](https://arxiv.org/pdf/2603.11445), [Subgoal-driven framework](https://arxiv.org/html/2603.19685v1)
- [Agentic Confidence Calibration](https://arxiv.org/pdf/2601.15778), [Agentic Uncertainty](https://arxiv.org/pdf/2602.06948)

### Frameworks
- [Manus AI Review 2026](https://www.nxcode.io/resources/news/manus-ai-review-2026)
- [LangGraph plan-execute](https://www.langchain.com/blog/planning-agents), [Dynamic decomposition](https://arxiv.org/html/2410.22457v1)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/)
- [Claude Code Tasks](https://venturebeat.com/orchestration/claude-codes-tasks-update-lets-agents-work-longer-and-coordinate-across), [Claude Code Todo docs](https://code.claude.com/docs/en/agent-sdk/todo-tracking)
- [CrewAI 2026 review](https://vibecoding.app/blog/crewai-review)
- [Goose / AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [OpenAI ChatGPT Agent](https://openai.com/index/introducing-chatgpt-agent/)
- [Anthropic Computer Use 2026](https://siliconangle.com/2026/03/23/anthropics-claude-gets-computer-use-capabilities-preview/)

### Safety
- [METR Time Horizons](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/)
- [Apollo May 2026 update](https://www.apolloresearch.ai/blog/apollo-update-may-2026/), [In-context scheming](https://www.apolloresearch.ai/blog/more-capable-models-are-better-at-in-context-scheming/)
- [DeepMind FSF v3](https://deepmind.google/blog/strengthening-our-frontier-safety-framework/), [DeepMind AGI safety](https://deepmindsafetyresearch.medium.com/an-approach-to-technical-agi-safety-and-security-25928819fbc6)
- [Goal misgeneralization minimax](https://arxiv.org/pdf/2507.03068)
- [Constraint violations benchmark](https://arxiv.org/pdf/2512.20798)

### HITL
- [Confirmation fatigue essay](https://changkun.de/blog/ideas/human-in-the-loop-agents/)
- [Cognitive Agency Surrender](https://arxiv.org/pdf/2603.21735)
- [Approval gates AI coding](https://codeongrass.com/blog/how-to-build-human-in-the-loop-approval-gates-ai-coding-agents/)

### On-chain
- [ERC-8183 spec](https://eips.ethereum.org/EIPS/eip-8183), [ERC-8183 CCN](https://www.ccn.com/education/crypto/erc-8183-programmable-escrow-ai-agents-ethereum-how-it-works/)
- [ERC-8004](https://eco.com/support/en/articles/13221214-what-is-erc-8004-the-ethereum-standard-enabling-trustless-ai-agents)
- [OKX APP whitepaper](https://web3.okx.com/whitepaper/okx-app-whitepaper.pdf)
- [Olas Mech](https://olas.network/agent-economies/mech)

### Regulatory
- [EU AI Act Compliance](https://www.covasant.com/blogs/eu-ai-act-compliance-autonomous-agents-enterprise-2026)
- [AI Agents Under EU Law](https://arxiv.org/pdf/2604.04604)
- [Article 14](https://artificialintelligenceact.eu/article/14/), [Article 26](https://artificialintelligenceact.eu/article/26/)
