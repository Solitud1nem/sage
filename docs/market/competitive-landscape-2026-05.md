# Sage — Competitive Landscape

**Snapshot date:** 2026-05-11
**Source:** WebSearch deep-research pass across agent-payments / task-escrow ecosystem
**Caveat:** market moves weekly; re-do this pass quarterly or when planning announcements

---

## Direct competitors

### OKX Agent Payments Protocol (APP) v1.0
- **Launched:** 2026-04-29
- **Positioning overlap:** very high — same chain-agnostic, escrow + dispute lifecycle
  (price quotation → contract negotiation → escrow → settlement → arbitration).
  Cites Base, Ethereum, Solana, Sui, Aptos, Optimism support.
- Ships **OKX Agentic Wallet** (TEE-secured, session keys, 20+ chains) + Payment SDK.
- Most direct conceptual competitor today; OKX has CEX distribution and legal capacity Sage cannot match alone.
- Sources: [OKX APP whitepaper](https://web3.okx.com/whitepaper/okx-app-whitepaper.pdf),
  [The Block coverage](https://www.theblock.co/post/399490/okx-agent-payments-protocol-ai-business-cycles-quotes-disputes-transactions)

### ERC-8183 (Ethereum Foundation dAI team + Virtuals Protocol)
- **Proposed:** 2026-02-25 · **Live:** 2026-03-10
- Native programmable-escrow EIP for "Jobs" on Ethereum L1.
  Roles: Client / Provider / Evaluator. Lifecycle: Funded → Submitted → Completed.
- **Functionally near-identical to Sage's TaskEscrow** at the EIP-standard level.
- If 8183 sticks, custom escrow contracts (including Sage's) become "yet another implementation"
  rather than "the protocol".
- Sources: [EIP-8183](https://eips.ethereum.org/EIPS/eip-8183),
  [CCN walkthrough](https://www.ccn.com/education/crypto/erc-8183-programmable-escrow-ai-agents-ethereum-how-it-works/)

### PayCrow
- Bolt-on escrow layer for x402-style agent payments.
- 5-minute drop-in: locks funds in a smart contract, releases on 2xx + JSON schema verification.
- Claims protecting $600M+ in x402 flow (claim, not verified).
- Directly attacks Sage's "x402 has no escrow → use Sage" narrative.
- Source: [PayCrow announcement](https://earezki.com/ai-news/2026-03-14-add-escrow-protection-to-any-x402-agent-payment-in-5-minutes/)

### Nava
- **$8.3M seed** April 2026.
- Escrow + verification framework gating outbound agent transactions; focused on financial-agent safety.
- Adjacent rather than head-on, but overlaps in "hold funds until verified delivery."
- Source: [Fortune](https://fortune.com/2026/04/14/nava-seed-funding-ai-financial-agents/)

### Moltlaunch (Base)
- Agent marketplace on Base with trustless escrow, reputation, tradeable tokens.
- Same chain as Sage, smaller, less mature, but exact niche fit.
- Source: [moltlaunch.com](https://moltlaunch.com/)

### Olas Network (formerly Autonolas)
- 10M+ agent-to-agent transactions claimed by 2026; old Mech micropayment legacy retired.
- Current focus: co-owned agents + prediction-market agents on Gnosis. ~$1.68M DEX liquidity.
- Different economic model (token-incentivized service economy, not task escrow) — adjacent.
- Source: [Olas tweet](https://x.com/autonolas/status/2019752385959415861)

---

## Complementary protocols (potential partners)

### x402 (Coinbase + x402 Foundation)
- Now governed by the x402 Foundation: Coinbase, Cloudflare, Google, Visa, AWS, Circle, Anthropic, Vercel, Solana.
- **x402 V2** expanded beyond single-call: wallet identity, API discovery, dynamic recipients,
  multi-chain via CAIP, modular SDK. Stripe integrated Feb 2026.
- Claimed volume: $600M cumulative agent-to-agent, ~1M tx/week peak Q4 2025.
- **CoinDesk skeptical (March 2026):** real onchain volume ~$28K/day; most claims include testing/gamed numbers.
- Multi-step escrow still delegated to extensions (PayCrow, Sage). The complement framing remains valid.
- Sources: [x402 V2 launch](https://www.x402.org/writing/x402-v2-launch),
  [CoinDesk demand-skeptical](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet)

### AP2 (Agent Payments Protocol — Google → FIDO Alliance)
- Announced Sept 2025 with Coinbase; **donated to FIDO Alliance** 2026 for neutral stewardship.
- Messaging / mandate layer (signed "Mandates"), not settlement.
- 60+ partners: Mastercard, Amex, PayPal, Adyen, Revolut, Salesforce, Mysten Labs.
- Explicitly contemplates escrow as a configurable mandate term — Sage can implement AP2 mandates atop its escrow.
- Sources: [Google Cloud announcement](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol),
  [FIDO donation](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/)

### Machine Payments Protocol (MPP) — Stripe + Tempo
- **Launched 2026-03-18** with Visa, Paradigm, OpenAI, Shopify alignment.
- Built-in escrow primitive (session deposit + EIP-712 vouchers, ~500ms setup, sub-100ms latency).
- Multi-rail: Tempo stablecoins, Visa/Mastercard via SPTs, Bitcoin Lightning, custom rails.
- Cloudflare Agents docs include MPP.
- Escrow model is **short-lived / streaming** — leaves room for Sage's long-running, multi-party positioning.
- Sources: [Stripe MPP blog](https://stripe.com/blog/machine-payments-protocol),
  [MultiversX writeup](https://multiversx.com/blog/stripes-machine-payments-protocol-on-multiversx)

### Skyfire (KYAPay + Know Your Agent)
- Live in 2026. F5 Bot Defense integration (April 2026). Member of Agentic Commerce Consortium.
- Identity + payments rail on USDC. Sage could plug into KYA for agent KYC / discoverability.
- Sources: [Skyfire](https://skyfire.xyz/),
  [F5 partnership](https://www.f5.com/company/news/press-releases/f5-skyfire-secure-agentic-commerce)

---

## Adjacent / different positioning

### Halliday
- **$20M Series A** (a16z crypto, March 2025).
- "Agentic Workflow Protocol" — immutable guardrails for AI executing onchain ops.
- Partners: DeFi Kingdoms, Core Wallet, ApeChain.
- Workflow rails, not task escrow. Adjacent.
- Source: [Halliday Medium](https://medium.com/@HallidayHQ/halliday-the-first-agentic-workflow-protocol-2f7f56a661c4)

### Bittensor
- 128+ subnets, expanding to 256 in 2026. **$43M Q1 revenue.** dTAO tokenization per subnet.
- Backers: Nvidia ($420M), Polychain ($200M).
- Subnet economics (RL emission for inference/ML services), not task escrow.
- a16z researchers cited Bittensor when arguing blockchains supply AI agent infra.
- Sources: [MEXC summary](https://www.mexc.com/news/1055066),
  [Invezz TAO outlook](https://invezz.com/news/2026/05/08/tao-price-surges-as-bittensors-subnet-expansion-fuels-bullish-outlook/)

### Crossmint Agentic Finance Platform
- Agent wallets + Visa Intelligent Commerce + Mastercard Agent Pay + stablecoin infra on 40+ chains.
- Spending guardrails. Card-rail focused, not escrow.
- Source: [Crossmint solutions](https://www.crossmint.com/solutions/agentic-payments)

### Coinbase Agentic Wallets (CDP)
- Wallet layer with policy controls; complements Sage.
- Source: [Coinbase launch](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets)

---

## Web2 alternatives capturing market

### Stripe Link Wallet for Agents + Issuing for Agents
- **Launched 2026-04-29** at Stripe Sessions (288 products announced).
- Scoped one-time-use virtual cards per task, Shared Payment Tokens (SPTs), real-time auth, spending controls.
- **#1 Web2 threat:** most builders default to Stripe, now Stripe natively serves agent payments.
- Sources: [TechCrunch](https://techcrunch.com/2026/04/30/stripe-link-digital-wallet-ai-agents-shopping/),
  [Stripe blog](https://stripe.com/blog/giving-agents-the-ability-to-pay)

### Amazon Bedrock AgentCore Payments (with Coinbase + Stripe)
- AWS-native agent payments: both x402 (crypto) and Stripe rails.
- Pulls AWS-builder market away from independent stacks.
- Source: [AWS blog](https://aws.amazon.com/blogs/machine-learning/agents-that-transact-introducing-amazon-bedrock-agentcore-payments-built-with-coinbase-and-stripe/)

### Closed-loop AI agent products (Devin, Replit Agent, Decagon, Lindy)
- All on subscription / credit-unit billing. **None pay onchain or agent-to-agent.**
- Devin: $2.25/ACU. Replit Core: $25/mo. Decagon: $250M Series D Jan 2026 @ $4.5B.
- Bill humans, not agents — not direct competitors but represent the "closed billing" status quo.
- Source: [Devin pricing](https://devin.ai/pricing/),
  [Decagon coverage](https://ai2.work/blog/decagon-hits-4-5b-valuation-as-ai-support-agents-scale-2026)

### Lithic + Rye + Arcade
- Visa-rail-based agent checkout. Card payments using merchant catalogs.
- Source: [Rye case study](https://rye.com/blog/case-study-lithic-rye-agentic-checkout)

---

## Regulatory developments

- **EU AI Act** — from **2026-08-02**: high-risk AI agents need additional safety + mandatory human override.
  Likely applies to autonomous payment agents above a threshold.
  [EU AI Act FAQ](https://ai-act-service-desk.ec.europa.eu/en/faq)
- **MiCA full enforcement** — **2026-07-01**: all CASPs in EU must be licensed; stablecoin reserves + bot surveillance mandated.
  Directly affects USDC-settled escrow in EU.
  [Sumsub overview](https://sumsub.com/blog/crypto-regulations-in-the-european-union-markets-in-crypto-assets-mica/)
- **US GENIUS Act** (July 2025): stablecoin framework. Permissive for USDC-on-Base settlement.
- **Singapore IMDA** (Jan 2026): first agentic AI governance framework with Agent Identity Cards + 5-tier autonomy taxonomy.
- **NIST AI Agent Standards Initiative** (Feb 2026): US standards body convening interoperability work.
- **No jurisdiction yet has explicit rules** for autonomous AI agents in digital-asset markets — regulatory gap = first-mover opportunity for compliance posture.

---

## Consortia & coalitions to be aware of

- **x402 Foundation** — Coinbase, Cloudflare, Google, Visa, AWS, Circle, Anthropic, Vercel, Solana
- **FIDO Alliance** — now custodian of AP2
- **Agentic Commerce Consortium** — Basis Theory + Lithic + Crossmint + Skyfire + Rye + Channel3 + Catalog + New Generation + Henry Labs
- **NIST AI Agent Standards Initiative**

**Sage is not a member of any** as of 2026-05-11.

---

## Key takeaways for Sage strategy

1. **The "x402 complement = multi-step escrow" wedge is closing fast.**
   OKX APP, ERC-8183, and PayCrow now occupy that narrative. Sage shipped first on Base mainnet but is no longer alone; differentiation must shift from "we do escrow x402 doesn't" to something more specific (dispute UX, sponsor-paid gas, EIP-2612 ergonomics, demo showcase, KYA-free open mode).

2. **Stripe + Tempo MPP is the existential Web2 threat.**
   Do not try to compete on micropayments. Double down on long-running, dispute-resolvable, multi-party tasks where MPP's session-voucher model is too thin.

3. **ERC-8183 will likely become the L1 standard.**
   Sage should consider implementing 8183-compatible interfaces (or proposing an L2-native variant) to ride the standard rather than fight it.

4. **Monetize identity / discovery before settlement.**
   Settlement is being commoditized by x402, MPP, AP2, and Issuing. AgentRegistry + reputation / KYA layer is more defensible than the escrow primitive — particularly if it interops with Skyfire KYA and AP2 Mandates.

5. **Join a consortium fast.**
   Agentic Commerce Consortium (Lithic, Crossmint, Skyfire, Rye) is the most aligned. Co-signing standards work buys narrative legitimacy a solo Base-only protocol cannot.

6. **EU AI Act + MiCA compliance is a feature, not a tax.**
   Aug 2026 deadlines mean enterprise buyers will demand human-override hooks, audit logs, agent identity. Ship these as a "regulator-ready escrow" SKU and capture the EU market crypto-native competitors are ignoring.

7. **Don't chase Web2 closed-loop billers (Devin, Lindy, Decagon, Replit).**
   They pay humans, not agents. TAM is agent-to-agent commerce, where MPP/AP2/x402/APP define the field. Win there or pivot.

---

## Gaps / followups for next refresh

- Lindy / MultiOn payment-infra details (closed subscription billing assumed; unconfirmed)
- Halliday Payments — workflow focus vs escrow positioning unclear
- x402 volume claims — $600M cumulative vs $28K/day real (treat the high numbers skeptically)
- Track OKX APP adoption metrics quarterly
- Re-survey when ERC-8183 sees first major implementers
