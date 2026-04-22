# ADR-0003 — x402 as primary transport for pay-per-call; Sage focuses on task-level escrow

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses), ADR-0002 (agent identity); D5 в `project-sage`

## Context

AI-агенты в Sage нуждаются в двух разных моделях оплаты:

1. **Pay-per-call** — single-shot платёж за атомарный вызов: «спроси inference, получи ответ, заплати». Без состояния задачи, без deadline, без dispute. Это 80% всех agent-to-agent транзакций.
2. **Task-level escrow** — multi-step задача с lifecycle (Created → Accepted → Completed → Paid/Disputed/Refunded), deadlines, возможной частичной оплатой, механикой auto-release. Это то, что отличает Sage от простых payment-протоколов.

v1 AgentPay реализовывал оба сценария своими контрактами: `TaskEscrow` для задач, `InferenceMarket` для pay-per-call. В v2 стоит вопрос: имеет ли смысл держать два contract-слоя, когда в индустрии появился внешний стандарт под один из сценариев?

Внешний контекст:
- **x402** — протокол Coinbase (2025), использующий HTTP-status 402 для payment-negotiation между клиентом и сервером. Settlement on-chain через facilitator-сервисы (Coinbase-hosted или alternative). Chain-agnostic by design; primary settlement currency — USDC.
- Индустрия быстро адоптит: Coinbase AgentKit, Eliza framework, Virtuals Protocol, ряд stackов интегрируют x402 напрямую.
- Строить свой аналог = проигранная позиция против де-факто стандарта.

## Decision

**x402 — единственный рекомендованный транспорт для pay-per-call сценариев в экосистеме Sage.** Sage-контракты (`AgentRegistry`, `TaskEscrow`) занимаются исключительно task-level escrow. `InferenceMarket.sol` из v1 — deprecated, не портируется в v2.

Конкретика:
- Агент, экспонирующий pay-per-call API (например, inference-endpoint), возвращает HTTP 402 с x402-payment-instructions. Клиент (другой агент) платит через x402-facilitator и ретраит с доказательством.
- SDK предоставляет высокоуровневый метод `sage.callAgent({ agentId, payload })`, который под капотом использует x402-interceptor и управляет payment flow.
- Для задач с escrow-семантикой (многошаговые, с deadline, с payment только по факту результата) SDK предоставляет `sage.createTask(...)`, который идёт через `TaskEscrow` контракт.
- Агент сам решает, какой из двух слоёв экспонировать — или оба. Sage-registry хранит информацию, какие методы оплаты поддерживает агент.

## Rationale

- **x402 — де-факто стандарт 2026.** Coinbase продвигает, индустрия адоптит, интеграции с agent-frameworks идут быстро. Собственный конкурирующий протокол = маркетинговое и техническое поражение.
- **Разделение ответственности.** x402 решает атомарный payment, Sage — state machine задачи. Каждый слой оптимизирован под свой сценарий.
- **Меньше контрактов — меньше аудита.** Удаление `InferenceMarket.sol` снимает один контракт из v1-поверхности, упрощает v2 deploy, снижает gas-cost на сеть (один контракт вместо двух).
- **Chain-agnostic из коробки.** x402 уже работает на Base, Ethereum, Arbitrum, Optimism и расширяется. Нам не нужно реплицировать pay-per-call логику на каждую сеть — x402-facilitator это делает за нас.
- **Fokus на уникальной ценности.** Task-level escrow — то, где Sage действительно добавляет value (x402 этого не делает). Всё остальное — коммодитизированный payment-слой.

## Alternatives considered

### Option A — Держать свой pay-per-call контракт (как в v1)
- Pros: полный контроль, нет внешних зависимостей.
- Cons: конкуренция с x402 → проигранная позиция; дубликация функциональности; больше gas на deploy; нет переиспользования existing tooling.
- Rejected because: строить против стандарта индустрии — стратегическая ошибка на раннем этапе.

### Option B — Гибрид: x402 **и** свой InferenceMarket параллельно
- Pros: пользователь выбирает; fallback если x402 недоступен.
- Cons: фрагментированный UX (два способа делать одно и то же); удвоенный аудит; непонятная матрица совместимости агентов.
- Rejected because: когнитивная нагрузка и путь «какой вариант когда» без реальной выгоды. При необходимости fallback — это делается на уровне SDK через ERC-20 transfer, не через отдельный контракт.

### Option C — Ждать и посмотреть, станет ли x402 доминировать
- Pros: не коммитимся рано, видим рыночную динамику.
- Cons: теряем год на ожидание; если не коммитимся — остаёмся своим pay-per-call, т.е. Option A по умолчанию.
- Rejected because: в протокольных решениях колебаться нельзя, поздняя миграция дороже раннего решения.

## Consequences

**Положительные:**
- Один контракт меньше (`InferenceMarket.sol` из v1 уходит) → меньше аудит, меньше gas на deploy, меньше surface для багов.
- Immediate ecosystem fit: Sage совместим с Coinbase AgentKit, Eliza, Virtuals из коробки, без дополнительных интеграций.
- Chain-agnostic pay-per-call бесплатно — x402-facilitator разворачивается Coinbase и альтернативами, не нами.
- Чёткий narrative для маркетинга: «Sage — про task-escrow, pay-per-call мы делегируем x402».

**Отрицательные / компромиссы:**
- **Зависимость от x402-протокола и его направления развития.** Если Coinbase закроет спеку или сменит экономику, нам больно. Митигация: x402 — открытая спека, мы имплементируем против неё, не против Coinbase-specific фич. SDK держит escape-hatch — прямой ERC-20 transfer с permit, если x402-facilitator недоступен.
- **Менее полный контроль над UX** pay-per-call. x402 диктует HTTP-flow, мы следуем ему. В v1 у нас был свой on-chain flow с полным контролем.
- **Два разных mental model для агентов-разработчиков.** Агент либо exponируется через x402 (HTTP), либо через escrow (on-chain). Нужна чёткая документация, когда что. Это компенсируется SDK, который абстрагирует выбор.

**Что потребует дальнейшего решения:**
- Выбор **x402-facilitator** для v2.0: Coinbase-hosted, собственный, или поддержка любого спек-совместимого. Отдельный ADR в кластере «Деньги».
- Точный контракт-спек `settlePayment()` — как TaskEscrow и x402 взаимодействуют в edge-cases (например, задача финализируется через escrow, но intermediate-вызовы в ходе задачи — через x402).
- Политика escape-hatch (прямой ERC-20 transfer) — в каких случаях SDK автоматически фолбэкает, а когда пробрасывает ошибку наверх.

## Implementation notes

- **SDK:**
  - `sage.callAgent({ agentId, payload, options })` — x402-flow. Использует internal x402-interceptor, facilitator-адрес из chain config.
  - `sage.createTask({ agentId, deadline, amount, spec })` — on-chain escrow flow через `TaskEscrow`.
  - Два метода — два use-case. Документация подчёркивает различие.
- **AgentRegistry:**
  - Поле `paymentMethods: enum[] { X402, ESCROW, BOTH }` (TBD — точный формат в ADR по registry-схеме).
  - Поле `endpoint` используется обоими — x402 возвращает 402 из этого endpoint, escrow-агенты получают на него webhook-уведомления о новых задачах.
- **`InferenceMarket.sol`** из v1 **не переносится**. В репо v2 (`D:\Sage\contracts/`) этого файла не будет. Для исторического contextа — ссылка на v1-файл в `D:\AgentsPay\contracts/InferenceMarket.sol`.
- **Escape-hatch:** SDK метод `sage.payDirect({ to, amount, token })` — прямой ERC-20 transfer с permit, для случаев когда x402 недоступен или не подходит. Это не официальный payment-path, а крайняя мера.

## References

- x402 specification: https://www.x402.org
- Coinbase anns: https://www.coinbase.com/blog/x402-internet-native-payments
- v1 InferenceMarket для исторического контекста: `D:\AgentsPay\contracts\InferenceMarket.sol` (read-only archive)
- D5 в `project-sage.md` — decision record высокого уровня, который формализуется этим ADR
