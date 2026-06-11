# Runbook: новая identity generic-worker'а (EOA → секреты → handler → регистрация)

Контекст: M12.0.4 / ADR-0020 п.3 (identity = кошелёк + capability + цена). Цены — `docs/research/pipeline-economics.md` §2.

**Порядок жёсткий:** регистрация в AgentRegistryV2 — ПОСЛЕДНИЙ шаг, только когда handler identity уже живёт в продовом sage-workers. Зарегистрированная capability без handler'а = classifier маршрутизирует живые эскроу в задачи, которые никто никогда не примет.

## 1. EOA + секреты (можно заранее)

```bash
# Из корня репо. Печатает адреса + готовую команду fly secrets set --stage.
pnpm --filter @sage/demo-agents exec tsx scripts/new-identity-wallets.ts copywriter builder packager qa-website
# → выполнить напечатанную команду fly secrets set; почистить scrollback терминала.
```

Ключи живут ТОЛЬКО в Fly secrets (`<ID>_PRIVATE_KEY`, дефисы → подчёркивания). `--stage` применится следующим деплоем/рестартом.

## 2. Газ

~0.0005 ETH (Base) на адрес — регистрация (~250k gas) + запас на сотни accept/complete. Спонсорский кошелёк не трогаем.

## 3. Handler + identity в коде (M12.1.x)

- handler в `apps/demo-agents/src/worker/handlers/` + строка в `HANDLERS`;
- строка в `IDENTITY_TABLE` (`src/worker/identities.ts`) с той же ценой, что пойдёт в регистрацию;
- identity в `WORKER_IDENTITIES` секрете app'а sage-workers;
- деплой: `fly deploy -c apps/demo-agents/fly.workers.toml --ha=false --remote-only` **из корня репо**;
- смоук: `GET https://sage-workers.fly.dev/health` показывает identity.

## 4. Регистрация (идемпотентна)

```bash
CHAIN=mainnet COPYWRITER_PRIVATE_KEY=0x… \
pnpm --filter @sage/demo-agents exec tsx scripts/register-identity.ts copywriter copywrite 30000
```

Endpoint по умолчанию `https://sage-workers.fly.dev` — именно http(s)-endpoint включает wake-пинги orchestrator'а (легаси-воркеры с `on-chain://task-events` не пингуются by design).

## 5. Проверка

```bash
cast call <REGISTRY_V2> "getAgent(address)((address,string,string,(string,uint256)[],uint64,bool))" <ADDR> --rpc-url https://mainnet.base.org
# capability + цена + active=true; затем классифицировать тестовый бриф и убедиться,
# что executor разрезолвился в новую identity, а wake поднял sage-workers.
```

## Снятие с маршрутизации

Гасить identity — `pauseAgent` от её кошелька (classifier выбирает только active). Это же делает foreign-agent template на shutdown.
