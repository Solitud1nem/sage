# Runbook: новая identity generic-worker'а (EOA → секреты → handler → регистрация)

Контекст: M12.0.4 / ADR-0020 п.3 (identity = кошелёк + capability + цена). Цены — `docs/research/pipeline-economics.md` §2.

**Порядок жёсткий:** регистрация в AgentRegistryV2 — ПОСЛЕДНИЙ шаг, только когда handler identity уже живёт в продовом sage-workers. Зарегистрированная capability без handler'а = classifier маршрутизирует живые эскроу в задачи, которые никто никогда не примет.

## 1. EOA + секреты (можно заранее)

**Кошельки создаёт оператор (Alex), ключи остаются в его кастоди** — приватники/сиды сохраняются у него до того, как адрес получит хоть копейку. Ключ, существующий только в Fly secrets, недопустим: потеря app'а/secrets не должна терять доступ к кошельку (решение Alex 2026-06-11, после ротации website-четвёрки).

```bash
# Оператор, локально:
cast wallet new            # на каждую identity; ключ/сид — в свой keystore
fly secrets set <ID>_PRIVATE_KEY=0x… -a sage-workers   # имя: id identity, дефисы → подчёркивания
```

AI-ассистенту передаются **только адреса**. Приватные ключи никогда не вставляются в чат/сессию — даже внутри команды «для примера». `scripts/new-identity-wallets.ts` остаётся для локальных тестовых кошельков, для продовых identities не используется.

## 2. Газ

~0.0005 ETH (Base) на адрес — регистрация (~250k gas) + запас на сотни accept/complete. Спонсорский кошелёк не трогаем.

## 3. Handler + identity в коде (M12.1.x)

- handler в `apps/demo-agents/src/worker/handlers/` + строка в `HANDLERS`;
- строка в `IDENTITY_TABLE` (`src/worker/identities.ts`) с той же ценой, что пойдёт в регистрацию;
- identity в `WORKER_IDENTITIES` секрете app'а sage-workers;
- деплой: `fly deploy -c apps/demo-agents/fly.workers.toml --ha=false --remote-only` **из корня репо**;
- смоук: `GET https://sage-workers.fly.dev/health` показывает identity.

## 4. Регистрация (идемпотентна)

Запускает **оператор в своём терминале** (подпись требует приватника, см. §1). В чат/сессию возвращается только вывод: адрес + tx-хэш.

```bash
CHAIN=mainnet COPYWRITER_PRIVATE_KEY=0x… \
pnpm --filter @sage/demo-agents exec tsx scripts/register-identity.ts copywriter copywrite 30000
```

Endpoint по умолчанию `https://sage-workers.fly.dev` — именно http(s)-endpoint включает wake-пинги orchestrator'а (легаси-воркеры с `on-chain://task-events` не пингуются by design).

### 4a. Data-handling манифест (M13.4.5)

Скрипт пишет в `profileUri` манифест декларации данных (ADR-0023 §Layer 2.5 / ADR-0024 §4) из `MANIFEST_*` env. Идемпотентно: для уже зарегистрированной identity, если `profileUri` отличается, шлёт один `updateProfileUri` (так бэкфилл живых агентов = просто перезапуск скрипта). Дефолты консервативны — privacy-флаги `false` («без заявления»), чтобы не переобещать.

```bash
CHAIN=mainnet COPYWRITER_PRIVATE_KEY=0x… \
MANIFEST_OPERATOR=Sage MANIFEST_PROVIDER=anthropic MANIFEST_MODEL=claude-sonnet-4-6 \
MANIFEST_NO_TRAINING=true MANIFEST_ZERO_RETENTION=false \
MANIFEST_RETENTION_DAYS=0 MANIFEST_SECONDARY_USE=false MANIFEST_SUBPROCESSORS=Anthropic \
pnpm --filter @sage/demo-agents exec tsx scripts/register-identity.ts copywriter copywrite 30000
```

`MANIFEST_ZERO_RETENTION` / `MANIFEST_NO_TRAINING` — это посадка **твоего тира у провайдера**, не дефолт любого API: стандартные commercial-условия отличаются от zero-data-retention-соглашения. Ставь `true` только если у тебя реально такое соглашение — сверься с провайдером (Anthropic / OpenAI), не предполагай. `MANIFEST_RETENTION_DAYS` — сколько **ты** держишь контент off-chain после сеттлмента (demo-артефакты R2 = TTL 30d ⇒ ставь `30`, если это твой путь хранения; `0` если не персистишь).

## 5. Проверка

```bash
cast call <REGISTRY_V2> "getAgent(address)((address,string,string,(string,uint256)[],uint64,bool))" <ADDR> --rpc-url https://mainnet.base.org
# capability + цена + active=true; затем классифицировать тестовый бриф и убедиться,
# что executor разрезолвился в новую identity, а wake поднял sage-workers.
```

## Снятие с маршрутизации

Гасить identity — `pauseAgent` от её кошелька (classifier выбирает только active). Это же делает foreign-agent template на shutdown.
