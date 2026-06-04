# Chain expansion recon — Sage v2.x+

**Дата снимка:** 2026-05-13
**Scope:** оценка кандидатов для расширения Sage на новые chain'ы по двум осям — ease of integration и strategic usefulness.
**Status:** snapshot. Половина фактов протухнет за месяц (mainnet drops, USDC native rollouts, agent-market запуски идут плотно).
**Related:** `competitive-landscape-2026-05.md` (рядом, общий market overview).

---

## 1. Что определяет ease для Sage

Sage завязан жёстко на четыре архитектурных инварианта, и это диктует ease-ранжирование:

1. **EVM bytecode equivalence** — контракты `AgentRegistry` + `TaskEscrow` написаны под Solidity, тесты на Foundry, SDK на viem. Любой не-EVM = форк адаптер-пакета + новые контракты с нуля + новый transport-слой.
2. **CreateX + CREATE3 same-address стратегия (ADR-0001)** — нужен задеплоенный CreateX на целевой chain'е. Стандартизированный адрес `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` присутствует на 180+ chain'ах, но не везде. ADR-0001 явно исключает zkSync/Polygon zkEVM из same-address.
3. **USDC native + EIP-2612 permit** (ADR-0004) — settlement currency. Bridged USDC = можно жить, но теряем permit и UX страдает.
4. **viem/wagmi chain config** — низкая планка, но нужен published RPC и chainId.

## 2. Что определяет usefulness для Sage

- AI-agent narrative fit + ecosystem alignment
- Existing agent dev infra (AgentKit, MCP, agent registries)
- Real on-chain agent activity (verified, не маркетинг)
- ERC-8004 adoption
- Distribution potential
- Strategic partnerships / competitive positioning
- x402 compat (Sage transport)

---

## 3. Ranking A — ease of integration (easy → hard)

### Tier S — drop-in EVM с native USDC (≈неделя адаптера + deploy)

| # | Chain | Mainnet | Native USDC | Замечания |
|---|---|---|---|---|
| 1 | **BNB Chain** | live | ✅ | Уже в v2.0 roadmap. CreateX задеплоен. Базовый recipe Base'а. |
| 2 | **Avalanche C-Chain** | live | ✅ | CreateX задеплоен. Зрелые tools. |
| 3 | **Monad** | live с 2025-11-24 | ✅ + CCTP V2 | EVM bytecode-equivalent. Circle Wallets/Contracts integrated. |
| 4 | **Sei (v2 EVM)** | live, EVM-only к mid-2026 | ✅ (с марта 2026) + CCTP V2 | Cambrian Agent Kit интегрирован. |
| 5 | **Hyperliquid (HyperEVM)** | live | ✅ + CCTP V2 | ⚠️ Деплой в big-blocks (1/мин, 30M gas) — нюанс CI/deploy скриптов, не блокер. USDC адрес `0xb88339CB7199b77E23DB6E890353E22632Ba630f`. |

### Tier A — EVM, частично готовы

| # | Chain | Caveat |
|---|---|---|
| 6 | **Tempo (Stripe/Paradigm)** | Mainnet live с 18 марта 2026, permissionless deploy day 1. Reth-based EVM. **Native stablecoin = USD1 (World Liberty Financial)**, не USDC. USDC статус не подтверждён — нужно проверить bridged-вариант. Может потребоваться settlement currency пересмотр под ADR-0004. |
| 7 | **0G (Aristotle Mainnet)** | Live с сентября 2025, EVM-совместимый L1. **USDC NOT confirmed в моём поиске** — может быть bridged-only. Точечная проверка нужна. |
| 8 | **MegaETH** | Mainnet live с 9 фев 2026, EVM-compatible L2. **Native stablecoin USDM (Ethena), USDC bridged**. EIP-2612 на bridged-USDC обычно работает, но не гарантирован. |
| 9 | **Linea** | EVM-equivalent zkEVM. **CreateX deploy на Linea я не смог явно подтвердить** (CreateX утверждает 180+ chains, но search не вернул explicit entry). ADR-0001 не исключает Linea, но same-address на zkEVM-семантике — известная боксовая дисциплина. Нужен запрос к `pcaversaccio/createx/deployments`. |

### Tier B — EVM, ещё не готовы / тонкие

| # | Chain | Caveat |
|---|---|---|
| 10 | **Arc (Circle)** | **Testnet only**. Mainnet «expected 2026», даты нет даже после $222M presale 11 мая. $3B FDV. Если строим сейчас — testnet-build с прицелом на mainnet drop. ERC-8004 туториал на testnet'е + Anthropic Claude Agent SDK интегрирован. **Strategic timing valuable, но prod deploy невозможен.** |
| 11 | **LitVM** | **Testnet only (LiteForge с 15 апреля)**. Mainnet H2 2026, дата TBA на Litecoin Summit в июне. Polygon CDK-based. Прод deploy недоступен. |
| 12 | **IOTA EVM** | Mainnet live, но **USDC только bridged через Stargate** — нет native CCTP. EIP-2612 на bridged USDC unreliable. |

### Tier C — non-EVM, требует отдельный адаптер-пакет (1–3 мес)

| # | Chain | Тип |
|---|---|---|
| 13 | **NEAR** | Rust contracts, sharded async. Aurora L2 как EVM-backdoor существует, но native ≠ EVM. **NEAR AI Agent Market запущен 9 мая 2026** — strategic urgency возросла. |
| 14 | **Solana** | Anchor/Rust. Native USDC. Адаптер с нуля. |
| 15 | **Aptos** | Move. EVM-знакомые dev-tools, но другая execution model. |
| 16 | **Sui** | Move. Object-centric model. |

### Tier D — глубокая переделка (3+ мес)

| # | Chain | Почему очень сложно |
|---|---|---|
| 17 | **Cardano** | Plutus/Haskell + UTXO. Двойной cognitive lift. Masumi даёт обвязку, но контракты — отдельный мир. |
| 18 | **TON** | FunC/Tact, async actor model, jetton-wallet-per-holder вместо balance mapping. Agentic Wallets **не аудированы** (apr 28, 2026, dev preview status). |

### Tier E — другой shape

| # | Chain | Тип |
|---|---|---|
| 19 | **Fetch.ai / ASI** | Cosmos SDK + CosmWasm на chain-уровне, плюс off-chain uAgents framework. Можно интегрировать на разных слоях. |
| 20 | **Kite (Avalanche L1)** | Live с 28 апреля 2026 как **отдельный L1**, не Avalanche C-Chain. Деплой Sage туда = адаптер под их chain spec. Competitor/complement в agent-payment-space. |

---

## 4. Ranking B — strategic usefulness

### Tier S — высокий payoff, верифицированный момент

| # | Chain | Почему |
|---|---|---|
| 1 | **BNB Chain** | Verified: 128k BAP-578 + 150k+ ERC-8004 deployments — реальный №1 по агент-трафику. Не маркетинг. Distribution + dev mindshare уже там. |
| 2 | **Arc** | Narrative-perfect (USDC=gas, ERC-8004, programmable economy). $3B FDV после $222M presale 11 мая. Claude Agent SDK интеграция = прямой канал к разработчикам, которые используют Claude. Mainnet вопрос времени. |
| 3 | **Base** | Уже primary. Расширение Sage **внутри** Base ecosystem (x402-связки, AgentKit-интеграции) — отдельный track пользы. |
| 4 | **NEAR** | Verified: NEAR AI Agent Market запущен 9 мая 2026 с on-chain settlement в NEAR token. Совместим с Claude/Codex frameworks. Strategic timing — войти сейчас, до того как marketplace заматерел. ⚠️ Non-EVM, expensive deploy. |
| 5 | **Kite на Avalanche** | Verified: live с 28 апр 2026, PayPal + Shopify пилоты, 1.9B testnet interactions. Прямой эталон-конкурент Sage'а в agent-payments на Avalanche. Партнёрский angle сильный: Sage как multi-chain layer **поверх** Kite-style chain-specific решений. |

### Tier A — сильный fit

| # | Chain | Почему |
|---|---|---|
| 6 | **Avalanche C-Chain** | Кроме Kite-партнёрки, сам C-Chain — большая DeFi/AI экосистема, native USDC. Phase 1 EVM-cluster кандидат. |
| 7 | **Solana** | Самый большой по объёму AI-agent ecosystem. Solana Agent Kit + Eliza. ⚠️ Non-EVM, expensive deploy. |
| 8 | **Sui** | Sui AI Stack идейно совпадает с Sage (verifiable AI + agent payments + agent-native wallets). Если non-EVM — лучший кандидат после Solana. |
| 9 | **0G** | «The Blockchain for AI Agents» — самое прямое позиционирование. Aristotle Mainnet, AIverse marketplace для verifiable AI agents под ERC-7857 standard. ⚠️ USDC статус неясен. |
| 10 | **Tempo (Stripe)** | Verified live + permissionless. **Прямой конкурент** Sage'а по позиционированию (Stripe MPP = Machine Payments Protocol). Партнёрство = большой signal; competition = exposure. Watch closely. |

### Tier B — нишевый / специализированный

| # | Chain | Почему |
|---|---|---|
| 11 | **TON** | 800M Telegram audience. Agentic Wallets живые, но dev preview без аудита. Council verdict: bot-wrapper над Sage-on-Base, не native deploy. |
| 12 | **Hyperliquid** | Trading-агентов уже много (Senpi, HeyElsa). Узкая re-positioning Sage в trading-escrow если деплоим. |
| 13 | **Aptos** | Aptos MCP Server даёт прямой developer-experience integration в Claude Code/Cursor — это полезно для Sage builder onboarding. |
| 14 | **Sei** | Cambrian Agent Kit реальный SDK. Native USDC. Sei экосистема меньше тиер-1. |
| 15 | **Monad** | Monad AI Blueprint + AINad framework — narrative-fit. Ecosystem ещё растёт. |

### Tier C — marginal

| # | Chain | Почему |
|---|---|---|
| 16 | **Fetch.ai / ASI** | Скорее complementary protocol чем deploy target. Partnership angle: uAgents использует Sage для escrow. |
| 17 | **Linea** | AI category есть, но AI-mindshare слабее Base/BNB/Avalanche. |
| 18 | **Cardano (Masumi)** | Niche. Audience лояльный, узкий. |
| 19 | **MegaETH** | Pre-launch AI integrations. Слишком рано для serious commitment. |
| 20 | **IOTA** | Маленький ecosystem. Tooling есть, но distribution слабое. |
| 21 | **LitVM** | Sentimental v1-история. Testnet only. |

---

## 5. Cross-product — sweet spot

| Chain | Ease | Usefulness | Net |
|---|---|---|---|
| **BNB Chain** | S (1) | S (1) | 🟢🟢 **Top-1.** Verified №1 ERC-8004 hub. Уже в roadmap. |
| **Avalanche** | S (2) | A (6) + Kite-партнёрский angle | 🟢 |
| **Monad** | S (3) | B (15) | 🟢 ease лучше usefulness, но cheap shot |
| **Sei** | S (4) | B (14) | 🟢 |
| **Hyperliquid** | S (5) | B (12) | 🟡 trading-niche |
| **Tempo** | A (6) | A (10) competitor angle | 🟡 partnership/competitive intel чем deploy |
| **Arc** | B testnet (10) | S (2) | 🟢 strategic — build now на testnet, ship в mainnet drop |
| **0G** | A (7) | A (9) | 🟡 USDC статус критичен для prod |
| **MegaETH** | A (8) | C (19) | 🔴 wait |
| **NEAR** | C (13) | S (4) | 🟠 high-payoff/high-cost, strategic timing после 9 мая |
| **Solana** | C (14) | A (7) | 🟠 |
| **Sui** | C (16) | A (8) | 🟠 |
| **TON** | D (18) | B (11) | 🔴 council verdict: bot-wrapper, не native |
| **Aptos** | C (15) | B (13) | 🟠 |
| **Linea** | A pending CreateX (9) | C (17) | 🔴 |
| **Kite** | E (20) | S (5) **as partnership** | 🟢 не deploy — co-marketing / integration story |
| **Cardano / IOTA / LitVM** | D/B/B | C | 🔴 skip |
| **Fetch.ai** | E (19) | C (16) | ➖ partnership-overlay |

---

## 6. Recommended phasing

### Phase 1 — EVM cluster (1.5–2.5 мес)

Расширить v2.0 EVM coverage до **5 chain'ов с same-address контрактами**:

- **BNB Chain**
- **Avalanche C-Chain**
- **Monad**
- **Sei**
- (плюс существующие Base + Arbitrum + OP уже в roadmap)

Критерии единые: EVM equivalent, native USDC + CCTP V2, CreateX задеплоен (для BNB/Avalanche — точно; для Monad/Sei проверить `deployments.json`), production-ready.

**Hyperliquid** — отдельным решением: если Sage готов узко позиционироваться на trading-mandates как доп use case.

### Phase 1b (параллельно, low-cost) — Arc testnet readiness

Развернуть Sage на Arc testnet **сейчас**, до mainnet. Это:
- использует Claude Agent SDK integration (наша audience),
- даёт narrative-fit «Sage was on Arc from day one»,
- готовит ready-to-deploy code к mainnet drop.

Effort: маленький (одна chain в `@sage/adapter-evm`), payoff: высокий по distribution + co-marketing с Circle.

### Phase 2 — партнёрский трек, не deploy

- **Kite на Avalanche** — competitive intel + partnership outreach. Sage позиционируется как multi-chain layer над Kite-style решениями.
- **Tempo (Stripe)** — competitive intel + watch. MPP overlap с Sage прямой. Партнёрство через Stripe-канал = огромное distribution.
- **Fetch.ai / ASI** — partnership: uAgents использует Sage для escrow в multi-step tasks.

### Phase 3 — non-EVM (v3+, после Phase 1)

- **NEAR** — стратегически срочнее после Agent Market launch 9 мая, но эффорт по-прежнему 3+ месяца.
- **Solana** — biggest payoff non-EVM.
- **Sui** — идейно ближе всех, но Move learning curve.
- **TON** — bot-wrapper над Sage-on-Base (per council). Native — defer до аудита Agentic Wallets.

---

## 7. Открытые вопросы (нужно копать дальше)

1. **CreateX deploy на конкретных chain'ах**: Monad / Sei / Hyperliquid / Tempo / 0G / Linea / Arc / LitVM — search не вернул explicit deployment matrix. Источник истины: `github.com/pcaversaccio/createx/blob/main/deployments`. Без этого same-address стратегия под вопросом per ADR-0001.
2. **Tempo native USDC**: чейн нативно сделан под USD1 (World Liberty Financial). USDC может быть только bridged. Если Sage settlement = USDC strict, Tempo может потребовать ADR-0004 пересмотр.
3. **0G native USDC**: проверка вернула только AI-инфраструктурное описание, не USDC статус. Нужен запрос в их docs или blockexplorer.
4. **MegaETH USDC permit**: USDC bridged, EIP-2612 на нём работает в принципе (зависит от мост-контракта), но не гарантирован.
5. **TON native deployment cost**: оценка 3+ мес по аналогии. Реальный effort может быть выше или ниже.
6. **NEAR AI Agent Market traction**: цифры $25.6k / 3.4k jobs / 1.3k agents — launch-day snapshot (9 мая 2026). Может растёт быстро, может стагнирует. Мониторить.
7. **Linea CREATE3**: zkEVM-семантика CREATE2 может ломать same-address — нужен прямой тест.

---

## 8. Связь с другими документами

- `competitive-landscape-2026-05.md` — общий market overview (соседний файл в `docs/market/`).
- `docs/adr/0001-deterministic-contract-addresses.md` — same-address стратегия через CreateX + CREATE3.
- `docs/adr/0004-settlement-currency.md` — USDC + EIP-2612 (определяет, какие chain'ы settlement-compatible).
- `BACKLOG.md` — TON defer + Telegram-bot probe (council verdict ниже).
- Council анализ TON был проведён 2026-05-13 в этой же сессии — verdict: defer native deployment, probe Telegram-bot wrapper над Sage-on-Base как 2-week experiment.

---

## 9. Sources

- [Arc | The Economic OS](https://www.arc.network/)
- [Introducing Arc: An L1 Blockchain for Stablecoin Finance | Circle](https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance)
- [Circle Arc Token 2026 Mainnet Launch | KuCoin](https://www.kucoin.com/news/articles/circle-ceo-confirms-arc-token-exploration-mainnet-launch-set-for-2026)
- [Stripe and Paradigm Unveil Permissionless Layer 1 Blockchain, Tempo | The Defiant](https://thedefiant.io/news/tradfi-and-fintech/stripe-and-paradigm-unveil-permissionless-layer-1-blockchain-tempo)
- [What Is Tempo? Stripe's Upcoming Payments Stablechain | CoinGecko](https://www.coingecko.com/learn/what-is-tempo-stablechain)
- [USDC and Stablecoins on Monad | Backpack](https://learn.backpack.exchange/articles/usdc-and-stablecoins-on-monad)
- [Network Information - Mainnet - Monad Documentation](https://docs.monad.xyz/developer-essentials/network-information)
- [0G - The Blockchain for AI Agents](https://0g.ai/)
- [0G Positions as the Blockchain for AI Agents](https://www.globenewswire.com/news-release/2026/03/21/3260008/0/en/0G-Positions-as-the-Blockchain-for-AI-Agents-as-Industry-Moves-Toward-1-Trillion-Agentic-AI-Economy.html)
- [Native USDC & CCTP V2 are coming to Sei | Circle](https://www.circle.com/blog/native-usdc-and-cctp-v2-are-coming-to-sei)
- [Cambrian Agent Kit Ecosystem Tutorial | Sei Docs](https://docs.sei.io/evm/ai-tooling/cambrian-agent-kit)
- [Sei sets mid-2026 deadline to become EVM-only | MEXC News](https://www.mexc.com/news/498121)
- [pcaversaccio/createx | GitHub](https://github.com/pcaversaccio/createx)
- [Crosschain USDC Transfers Launch on Hyperliquid HyperEVM | MEXC News](https://www.mexc.com/news/98555)
- [HyperEVM - Hyperliquid Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm)
- [MegaETH Launches Public Mainnet | Bankless](https://www.bankless.com/read/news/megaeth-launches-public-mainnet)
- [LitVM to Open Testnet in Q1 2026 | Yellow](https://yellow.com/news/litvm-to-open-testnet-in-q1-2026-as-litecoin-transaction-volume-surges)
- [Litecoin's First EVM Rollup LiteForge Hits 96K Transactions | Crypto Times](https://www.cryptotimes.io/2026/04/16/litecoins-first-evm-rollup-liteforge-hits-96k-transactions-in-24-hours/)
- [IOTA's EVM Mainnet Unleashed | IOTA Blog](https://blog.iota.org/iotas-evm-mainnet-launch/)
- [Circle CCTP V2 supported chains | Eco Support](https://eco.com/support/en/articles/11813797-circle-cctp-v2-native-usdc-across-13-chains)
- [Agentic wallet contracts - TON Docs](https://docs.ton.org/ecosystem/ai/wallets)
- [Developers of Telegram's Crypto Wallet Launch Agentic Wallets | The Defiant](https://thedefiant.io/news/nfts-and-web3/ton-tech-launches-agentic-wallets-on-ton-telegram)
- [BNB Chain Overtakes Ethereum, Base by Number of AI Agents | The Defiant](https://thedefiant.io/news/defi/bnb-smart-chain-becomes-home-to-most-erc-8004-ai-agents)
- [8004scan](https://8004scan.io/)
- [BNB Chain Surges Ahead in ERC-8004 Adoption | Crypto Economy](https://crypto-economy.com/bnb-chain-surges-ahead-in-erc-8004-adoption-as-on-chain-ai-agents-multiply/)
- [NEAR AI Agent Market Launch | Phemex](https://phemex.com/blogs/near-ai-agent-marketplace-nvidia-inception)
- [NEAR AI](https://www.near.org/ai)
- [Kite Mainnet Launches on Avalanche | Blockchain.news](https://blockchain.news/news/kite-mainnet-launch-avalanche)
- [Kite - The Payments Layer for the Agent Economy | Whitepaper](https://gokite.ai/kite-whitepaper)
