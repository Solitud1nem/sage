# Monad testnet deployment — verification record (2026-08-10)

Per [ADR-0026](../adr/0026-monad-testnet-deployment.md) /
[deploy-monad-testnet.md](./deploy-monad-testnet.md). Деплой выполнен
оператором (Alex) скриптом `script/deploy-monad-testnet.sh`; смоуки и
верификация — ассистентом (бесключевые). Chain ID **10143**.

## Deployed contracts

| Контракт | Адрес | Deploy tx | Блок | Газ (paid) |
|----------|-------|-----------|------|------------|
| AgentRegistryV2 | `0x8df78599868Ec740C26F0eb0b660519b166cDd9e` | `0x5b64d8c863b60b9a2ed937d52ad35b7bfddd623e9a929ca1765bc561709bba70` | 52 461 940 | 2 048 169 × 104.21 gwei = 0.2134 MON |
| TaskEscrowV2 (WMON) | `0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac` | `0x63bdb6927cb44f389ab81138ccab6d860774d228add46eea21362e92db7c717d` | 52 461 965 | 2 330 944 × 104.21 gwei = 0.2429 MON |

- **Registry-адрес побайтово совпал с Base** (`sage:registry:v2`, guarded salt
  deployer-bound) — инвариант ADR-0001 выполнен на третьем чейне.
- Эскроу — новая соль `sage:escrow-wmon:v1` → свой адрес (осознанно, ADR-0026).
- Deployer/owner/arbiter: `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d` (launch
  posture как на Base; миграция через Ownable2Step + setArbiter — позже).
- **`MONAD_ESCROW_FROM_BLOCK` для reputation-индексера (M14.4.2): `52461965`.**
- Суммарный кост деплоя: ~0.456 MON (fee-модель Monad: списан gas_limit,
  усушка limit→used видна в разнице estimate 0.89 → paid 0.46).

## Post-deploy смоуки (cast, 2026-08-10)

```
escrow.USDC(token): 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541   ← WMON ✓
escrow.owner:       0x6D8aCa48c1E064e71078656f7fB946e52cd8376d   ✓
escrow.arbiter:     0x6D8aCa48c1E064e71078656f7fB946e52cd8376d   ✓
escrow.nextTaskId:  0                                            ✓
registry.owner:     0x6D8aCa48c1E064e71078656f7fB946e52cd8376d   ✓
registry.paused:    false                                        ✓
registry.agentCount:0                                            ✓
```

## Source verification (sourcify → Monadscan)

| Контракт | Match | verifiedAt | Job |
|----------|-------|------------|-----|
| AgentRegistryV2 | `exact_match` | 2026-08-10T07:47:00Z | `44f130e2-60d8-46c2-9670-fe1e3028509c` |
| TaskEscrowV2 | `exact_match` | 2026-08-10T07:47:02Z | `ce6c39cc-751f-4e6d-b26b-43c88ed9072e` |

Verifier: `https://sourcify-api-monad.blockvision.org/` (chain 10143).
Explorer-ссылки: `https://testnet.monadscan.com/address/0x8df78599868Ec740C26F0eb0b660519b166cDd9e#code` ·
`https://testnet.monadscan.com/address/0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac#code`.

## Куда эти значения едут дальше

- `packages/adapter-evm/src/chains/monad.ts` + `apps/web/chains/monad.ts` —
  адреса registry/escrow/WMON (M14.2.1 / M14.5.1).
- Gateway env: `MONAD_RPC_URL=https://testnet-rpc.monad.xyz`,
  `MONAD_ESCROW_ADDRESS=0xcc01…dAac`, `MONAD_ESCROW_FROM_BLOCK=52461965`
  (M14.4.2; помнить: `eth_getLogs` чанк ≤100 блоков).
- Регистрация identities — M14.3.2 (кошельки операторские).
