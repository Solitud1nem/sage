# ADR-0018 — Composite content envelope: faithful payload + dependency chaining

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0007 (observable decomposition), ADR-0008 (Sage angle); `apps/demo-agents/src/parent/parent-id-codec.ts`, `apps/demo-agents/src/shared/composite-codec.ts`; BACKLOG.md «Composite: faithful content delivery to workers».

## Context

В composite-режиме (`/demo/composite`) parent-агент бьёт бриф на план, и для каждой подзадачи кладёт в `TaskEscrow.specUri` конверт `data:application/json,{parent:{run,sub}, spec}`. Воркер извлекает `spec` и применяет его как инструкцию.

Проблема, воспроизведённая 2026-06-08: **`spec` пишет LLM-классификатор, и это лоссовый канал**. На объёме классификатор ужимает исходный текст (бриф 904 симв → `spec` 103 симв — в переводе выживает одно предложение), а иногда вообще ссылается на текст («the provided text») вместо встраивания — тогда воркер честно отвечает «Translation requires source text in the spec». Второй дефект: результат подзадачи N **не передаётся** в подзадачу N+1 — `depends_on` задаёт только порядок исполнения, не поток данных. Итог: на нетривиальном вводе подзадачи дают мусор, а цепочки («переведи → суммаризируй») не компонуются.

Это блокирует столб MVP «относительно полезные решения подзадач» (см. `TASKS.md` M11.7). Нужен канал доставки контента, не зависящий от того, что LLM решил вписать в короткую инструкцию.

Ограничения:
- Те же 4 воркера обслуживают **и** 3-mode путь (`/demo`: pipeline/sentiment/vision), где `specUri` = сырой текст/URL (не конверт). Изменение не должно сломать этот путь.
- Воркеры — отдельные Fly-процессы со своими бандлами; codec дублируется в `src/shared/composite-codec.ts` (воркер) и `src/parent/parent-id-codec.ts` (parent). Оба должны понимать новый shape.
- `specUri` хранится on-chain (storage в `Task` struct + emit в `TaskCreated`), значит payload реально доезжает до воркера через `getTask`, но крупный текст = реальный storage-gas.

## Decision

Расширить composite-конверт с `{parent, spec}` до `{parent, spec, source?, inputs?}`:

- **`spec`** — инструкция (роль не меняется): *что делать*.
- **`source`** *(optional, string)* — оригинальный payload из брифа, прикладывается **plan-runner'ом дословно** (не из LLM-spec'а): *материал для работы* у root-подзадачи.
- **`inputs`** *(optional, `{ [subId: number]: string }`)* — результаты upstream-зависимостей, по `sub.id`: *материал* у зависимой подзадачи.

**Конвенция воркера** (как выбрать материал):
1. Если `inputs` непустой → работать по нему (это зависимая подзадача; конкатенация по возрастанию `depends_on`).
2. Иначе если `source` задан → работать по нему (root-подзадача).
3. Иначе → как сейчас: трактовать `spec` как самодостаточную инструкцию (back-compat для старых конвертов).

`spec` всегда остаётся инструкцией; воркер строит промпт как «примени инструкцию (`spec`) к материалу (`inputs`|`source`)».

Оба поля **optional** → старый конверт `{parent, spec}` и 3-mode сырой текст продолжают работать без изменений.

## Rationale

- **Развязывает контент и инструкцию.** Полнота исходника больше не зависит от того, ужал ли его LLM в короткий `spec`. Plan-runner кладёт `source` дословно.
- **Делает цепочки настоящими.** `inputs` несёт вывод предыдущего шага → «переведи → суммаризируй» наконец компонуется.
- **Не ломает 3-mode и старые конверты.** Поля optional; раздельный декодер (`decodeCompositeSpec` остаётся, добавляется `decodeCompositeEnvelope`); raw-путь по-прежнему `null`-сигнал.
- **Воркер сам решает материал по наличию полей** — parent'у не нужно знать prompt-специфику воркера, а воркеру не нужно парсить инструкцию ради данных.
- **Остаётся inspectable.** Конверт — тот же `data:application/json`, читается в block-explorer'е как и раньше (ADR-0007 мотив).

## Alternatives considered

### Option A — Заставить классификатор встраивать полный текст в `spec`
- Pros: ноль изменений в codec/воркерах.
- Cons: остаётся лоссовым (LLM всё равно режет/перефразирует на объёме); не решает цепочки вообще; недетерминированно.
- Rejected because: лечит симптом ненадёжно, корневой канал остаётся LLM-зависимым.

### Option B — Отдельное поле, но материал кладёт сам классификатор (LLM выделяет «instruction vs data»)
- Pros: «умное» разделение.
- Cons: снова доверяем LLM верно отделить данные от инструкции; на структурированном вводе ошибётся; лишний failure-mode.
- Rejected because: детерминированный split (parent кладёт `source` дословно, воркер выбирает по конвенции) надёжнее и проще.

### Option C — Off-chain контент по хешу: `specUri` несёт хеш + указатель, payload в IPFS/DA-слое
- Pros: масштабируется на большие payload'ы без storage-gas; «правильная» архитектура для прод-протокола.
- Cons: тянет внешнюю инфраструктуру доступности данных, pin/gc, доступ воркера к ней; сильно больше scope, чем MVP-демо.
- Rejected **for now**: верное направление за пределами MVP. Зафиксировано в «что потребует дальнейшего решения» — текущий on-chain inline ок для демо-объёмов, переезд на content-addressed storage — когда payload'ы перерастут разумный storage-gas.

## Consequences

**Положительные:**
- Подзадачи получают полный исходник → выводы становятся полезными (столб 4 MVP).
- Двух- и многошаговые планы реально компонуются (вывод N → вход N+1).
- 3-mode демо и старые конверты не затронуты (optional-поля + back-compat decode).

**Отрицательные / компромиссы:**
- Крупный `source`/`inputs` инлайнится в `specUri` → растёт calldata + on-chain storage-gas (string в `Task` struct). Для демо-текстов (единицы KB) на Base приемлемо (доли цента); многократно повторённый/мегабайтный ввод — нет.
- Конверт раздувается; в block-explorer'е `specUri` становится менее «читаемым глазом» (был мотив ADR-0007), хотя остаётся валидным JSON.
- Требуется править воркеры (`*/agent.ts`) — под правилом «не модифицировать воркеры» (`apps/demo-agents/CLAUDE.md`), значит явный таск (M11.7.4) + approval.

**Что потребует дальнейшего решения:**
- Порог размера, после которого инлайн нужно заменить на content-addressed off-chain payload (Option C) + on-chain хеш. Ввести guard/предупреждение при превышении.
- Семантика конкатенации `inputs` при множественных зависимостях (разделители, порядок, лимиты) — уточнить при реализации M11.7.2/3.
- Нужен ли отдельный `mime`/`kind` у `source` (текст vs image-URL для vision) — vision-воркер уже принимает URL; проверить, что конвенция «материал» работает для не-текстовых payload'ов.

## Implementation notes

- `parent-id-codec.ts`: `encodeParentId(parent, spec, opts?: { source?, inputs? })` → кладёт optional-поля; `EncodedPayload` расширяется.
- `composite-codec.ts` (воркер): добавить `decodeCompositeEnvelope(specUri): { spec, source?, inputs? } | null`; `decodeCompositeSpec` сохранить (back-compat).
- `plan-runner.ts`: при `createTask` для root-подзадачи класть `source` = оригинальный payload брифа; для зависимой — собирать `inputs` из уже завершённых `results` по `depends_on`.
- Воркеры: построить материал по конвенции (1→2→3) и промпт «инструкция к материалу».
- Тесты: codec round-trip (новые поля + back-compat старого shape); plan-runner inputs-сборка; e2e >1KB перевод целиком + 2-шаговая цепочка.
- Реализация — задачи M11.7.2 … M11.7.6 в `TASKS.md`.

## References

- ADR-0007 — observable decomposition (мотив inspectable specUri).
- `BACKLOG.md` — «Composite: faithful content delivery to workers».
- Воспроизведение дефекта: сессия 2026-06-08 (бриф 904→spec 103 симв).
- `packages/contracts/src/TaskEscrowV2.sol:160,166` — specUri в storage + event.
