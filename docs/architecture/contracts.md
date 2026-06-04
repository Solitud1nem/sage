# Smart Contracts — Sage v2

Этот документ описывает on-chain-слой Sage: два контракта, их роли, lifecycle задачи, защитные механизмы и дизайн-решения.

Источник истины — код в `packages/contracts/src/`. Документ описывает то, что развёрнуто на Base mainnet (M9.7.2, 2026-04-29).

## Обзор

| Контракт | Файл | Роль | Где деплоится |
|---|---|---|---|
| `AgentRegistry` | `packages/contracts/src/AgentRegistry.sol` | Канонический реестр агентов | Только Base (anchor chain, ADR-0002) |
| `TaskEscrow` | `packages/contracts/src/TaskEscrow.sol` | Escrow многошаговых задач с USDC-расчётом | На каждом supported EVM chain |

Оба контракта на `pragma solidity ^0.8.24`, развёрнуты через CreateX + CREATE3 с детерминистичными адресами (ADR-0001) — один и тот же адрес на всех чейнах.

**Деплой на Base mainnet:**
- AgentRegistry: `0x5e95F92FeEb4D46249DC3525C58596856029c661`
- TaskEscrow: `0x12aeF3529b8404709125b727bA3Db40cD5453E1e`
- Salt registry: `keccak256("sage:registry:v1")`
- Salt escrow: `keccak256("sage:escrow:v1")`

`TaskEscrow` **не зависит** от `AgentRegistry` — escrow работает с любым EOA. Verification зарегистрирован ли executor — ответственность SDK (ADR-0002).

---

## `AgentRegistry`

Минимальный on-chain registry. Богатые профили (метаданные, capability claims, репутация) живут off-chain через EAS attestations.

### Storage

```solidity
mapping(address => Agent) private _agents;
address[] private _agentList;
mapping(address => uint256) private _agentIndex; // 1-based
```

### Структура `Agent`

```solidity
struct Agent {
    address owner;
    string  endpoint;      // HTTP(S) или IPFS URL
    uint64  registeredAt;
    bool    active;
}
```

### Write API

| Функция | Кто | Эффект |
|---|---|---|
| `registerAgent(endpoint)` | любой EOA | Создаёт запись с `msg.sender` как owner. Реверт если уже зарегистрирован или endpoint пустой. |
| `updateProfile(endpoint)` | сам агент | Обновляет endpoint. |
| `pauseAgent()` | сам агент | Soft-pause, `active = false`. Работает даже когда сам контракт на паузе. |
| `resumeAgent()` | сам агент | `active = true`. Блокируется при глобальной паузе. |
| `pause()` / `unpause()` | owner | Emergency kill-switch — блокирует регистрации, updates и resume. |

### View API

- `getAgent(address)` — запись агента (если не зарегистрирован, `owner == address(0)`).
- `listAgents(cursor, limit)` — cursor-based пагинация, возвращает `(Agent[], nextCursor)`. `nextCursor == 0` означает конец.
- `agentCount()` — общее число записей (включая paused).

### События и ошибки

- События: `AgentRegistered`, `AgentUpdated`, `AgentPaused`, `AgentResumed`.
- Ошибки: `AlreadyRegistered`, `NotRegistered`, `AlreadyInState`, `EmptyEndpoint`.

### Безопасность

- Наследуется от OpenZeppelin `Ownable` + `Pausable`.
- Owner = multisig (или `address(0)` чтобы навсегда отказаться от admin-функций).
- `pauseAgent()` намеренно работает при глобальной паузе — агент всегда может уйти offline.

---

## `TaskEscrow`

Task-level escrow для многошаговых работ AI-агентов. USDC-only settlement (ADR-0004), с EIP-2612 permit для single-tx UX.

### Lifecycle

```
                  acceptTask          completeTask          approvePayment
   Created ────────────────► Accepted ─────────────► Completed ──────────────► Paid (terminal)
      │                         │                      │
      │                         │                      ├─ disputeTask ──► Disputed (terminal-frozen)
      │                         │                      │
      │                         │                      └─ claimAutoRelease (after 5min) ──► Paid
      │                         │
      └─────── refundExpired (deadline passed) ───────► Expired (terminal)
```

`Disputed` — терминал-замороженное состояние. On-chain механизма разрешения нет; средства висят до off-chain резолюции (ось dispute resolution — JIT, ещё не закрыта ADR'ом, см. `BACKLOG.md` / `project-sage.md`).

### Структура `Task`

```solidity
struct Task {
    address    client;
    address    executor;
    uint256    amount;       // USDC base units (6 decimals)
    uint64     deadline;     // unix seconds
    TaskStatus status;
    string     specUri;
    string     resultUri;
    uint64     completedAt;
}
```

### Statuses (enum)

| Value | Status | Описание |
|---|---|---|
| 0 | Created | USDC залочен, ждём executor |
| 1 | Accepted | Executor принял, работа идёт |
| 2 | Completed | Result загружен, идёт grace period |
| 3 | Paid | USDC отправлен executor (terminal) |
| 4 | Disputed | Клиент диспутнул, auto-release отменён |
| 5 | Refunded | USDC возвращён клиенту (terminal) |
| 6 | Expired | Deadline прошёл, USDC возвращён (terminal) |

### Write API

| Функция | Кто | Переход | Заметки |
|---|---|---|---|
| `createTask(executor, deadline, amount, specUri, permit)` | client | → Created | Permit в `try/catch` — single-tx даже если allowance уже выдан. `safeTransferFrom` лочит USDC. Возвращает `taskId`. |
| `acceptTask(taskId)` | executor | Created → Accepted | Реверт если deadline уже прошёл. |
| `completeTask(taskId, resultUri)` | executor | Accepted → Completed | Записывает `resultUri` и `completedAt`. |
| `approvePayment(taskId)` | client | Completed → Paid | USDC → executor. |
| `disputeTask(taskId, reason)` | client | Completed → Disputed | Отменяет auto-release. Reason обязателен. |
| `refundExpired(taskId)` | **anyone** | Created\|Accepted → Expired | Только если `block.timestamp >= deadline`. Возврат USDC клиенту. |
| `claimAutoRelease(taskId)` | executor | Completed → Paid | Только после `completedAt + GRACE_PERIOD` (5 минут). |

### Константы

- `GRACE_PERIOD = 300` секунд (5 минут) — окно, в которое клиент может диспутнуть до того как executor заберёт оплату через auto-release. Короче чем стандартные 24h, потому что клиент-агент онлайн и может реагировать мгновенно.

### View API

- `getTask(taskId)` — полная запись задачи.
- `nextTaskId()` — счётчик созданных задач.
- `GRACE_PERIOD()` — публичная константа.

### События и ошибки

- События: `TaskCreated`, `TaskAccepted`, `TaskCompleted`, `TaskPaid`, `TaskDisputed`, `TaskRefunded`, `TaskExpired`.
- Ошибки: `TaskNotFound`, `InvalidStatus(current, required)`, `Unauthorized`, `DeadlinePast`, `ZeroAmount`, `ZeroExecutor`, `EmptySpecUri`, `EmptyResultUri`, `EmptyReason`, `DeadlineNotPassed`, `GracePeriodNotElapsed`.

### Безопасность

- `ReentrancyGuard.nonReentrant` на всех функциях, перемещающих USDC: `createTask`, `approvePayment`, `refundExpired`, `claimAutoRelease`.
- **Checks-Effects-Interactions** соблюдён везде: статус задачи меняется **до** `safeTransfer`.
- `SafeERC20` для безопасной работы даже с non-standard ERC20 (хотя USDC сам канонический).
- USDC-адрес — `immutable`, задаётся в конструкторе (per-chain — Circle native USDC на каждой сети).
- Permit обёрнут в `try/catch` — если уже использован или allowance достаточен, не реверт.
- Все state-mutating функции используют модификаторы `taskExists`, `onlyClient`/`onlyExecutor`, `inStatus` для строгой проверки авторизации и lifecycle.

---

## Ключевые дизайн-решения

1. **Registry не hard dependency для Escrow.** Любой EOA может быть executor. Это даёт низкий порог входа (demo-агенты в проде работают именно так — не зарегистрированы) и упрощает контракт.

2. **Permit в `try/catch`.** Поддерживает оба flow: single-tx через EIP-2612 permit и pre-approved через обычный `approve`. Никогда не реверт из-за повторного использования permit.

3. **`refundExpired` — public.** Любой может triggernуть refund для задачи с прошедшим deadline. Снимает риск зависания средств, если клиент офлайн.

4. **5-минутный grace period.** Достаточно чтобы клиент-агент успел диспутнуть, но не блокирует executor надолго. Trade-off в сторону скорости расчётов.

5. **Disputed — терминал-замороженное.** Нет on-chain резолюции спора. Это упрощает контракт и делает его аудитопригодным. Off-chain резолюция планируется через social/legal layer (ось пока не закрыта ADR'ом).

6. **CREATE3 deterministic deploy.** Один и тот же адрес на всех чейнах через CreateX. Salt — `"sage:registry:v1"` и `"sage:escrow:v1"` (ADR-0001).

7. **Anchor chain pattern.** AgentRegistry только на Base; spoke-чейны (Arbitrum/OP/BNB) держат только TaskEscrow. SDK читает Registry с Base через мульти-RPC (ADR-0002).

---

## Тестирование и аудит

- **77 Solidity tests** в `packages/contracts/test/` — 100% покрытие.
- **600 000 invariant calls** через Foundry invariant testing.
- **Slither clean** — статический анализ без warnings (см. `docs/architecture/slither-review.md`).
- **12 SDK tests** проверяют интеграцию через `viem`.

---

## Связанные документы

- `docs/adr/0001-deterministic-addresses.md` — CREATE3 + CreateX, детерминистичные адреса между чейнами.
- `docs/adr/0002-agent-identity.md` — anchor-chain registry, EAS attestations off-chain.
- `docs/adr/0003-x402-as-pay-per-call-transport.md` — где x402, где Sage.
- `docs/adr/0004-settlement-usdc-permit.md` — USDC + EIP-2612 permit.
- `docs/adr/0005-monorepo-foundry-viem.md` — стек контрактов и SDK.
- `docs/adr/0006-web-integration-topology.md` — web/Worker/RPC топология.
- `docs/architecture/overview.md` — общая карта слоёв.
- `docs/architecture/security-checklist.md` — чек-лист security review.
- `docs/architecture/slither-review.md` — результаты статического анализа.
