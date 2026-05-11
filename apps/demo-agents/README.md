# Sage Demo Agents

Reference implementation showing how to build AI agents on the Sage protocol.

## Agents

| Agent | Port | Capability | Description |
|-------|------|------------|-------------|
| **Orchestrator** | 3000 | — | HTTP server, dispatches demos by mode (pipeline / sentiment / vision) |
| **Summarizer** | 3001 | `summarize` | Listens for tasks, summarizes text via OpenAI (or mock) |
| **Translator** | 3002 | `translate` | Listens for tasks, translates EN↔RU via OpenAI (or mock) |
| **Vision** | 3003 | `vision-describe` | Describes images via gpt-4o-mini vision (input: image URL) |
| **Sentiment** | 3004 | `sentiment-classify` | Classifies POSITIVE/NEGATIVE/NEUTRAL with score + rationale |

## Demo modes

The orchestrator's `POST /api/demo/start` accepts a `mode` field:

- `pipeline` (default) — 2-stage Summarizer → Translator, body: `{ text }`
- `sentiment` — single-stage Sentiment, body: `{ text }`
- `vision` — single-stage Vision, body: `{ imageUrl }` (http(s) URL)

## Quick start

### Prerequisites

- Node.js ≥ 20
- pnpm
- Three funded wallets on Base Sepolia (one per agent)
- USDC on Base Sepolia for the Orchestrator wallet

### Setup

```bash
# From repo root
pnpm install
pnpm -r build

# Configure
cd apps/demo-agents
cp .env.example .env
# Edit .env with your keys
```

### Run individually

```bash
# Each agent in its own terminal
pnpm dev:summarizer
pnpm dev:translator
pnpm dev:vision
pnpm dev:sentiment
pnpm dev:orchestrator
```

### Run with Docker

```bash
docker compose up
```

### Test the flow

```bash
# Pipeline (default — summarize → translate)
curl -X POST http://localhost:3000/api/demo/start \
  -H 'Content-Type: application/json' \
  -d '{"mode": "pipeline", "text": "AI agents are becoming autonomous economic actors in 2026..."}'

# Sentiment
curl -X POST http://localhost:3000/api/demo/start \
  -H 'Content-Type: application/json' \
  -d '{"mode": "sentiment", "text": "The team shipped the release ahead of schedule and customers love it."}'

# Vision
curl -X POST http://localhost:3000/api/demo/start \
  -H 'Content-Type: application/json' \
  -d '{"mode": "vision", "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg"}'
```

Each call returns `{ demoRunId, streamUrl, mode, chainId, ... }`. Subscribe to `GET /api/demo/stream/:demoRunId` (SSE) to watch the lifecycle events.

## Architecture

`POST /api/demo/start { mode, text? | imageUrl? }` — orchestrator dispatches by `mode`.
The 2-stage `pipeline` flow shown below is the longest path; `sentiment` and `vision`
modes run a single stage with the same primitives.

```
Client → POST /api/demo/start { mode: "pipeline", text } → Orchestrator
                           │
                           ├─ Stage 1 (summarize):
                           │   createTask(summarizer) → on-chain escrow
                           │   └─ Summarizer watches TaskCreated event
                           │      ├─ acceptTask()
                           │      ├─ [summarize via OpenAI]
                           │      └─ completeTask(resultUri)
                           │   approvePayment() → USDC to Summarizer
                           │
                           └─ Stage 2 (translate): same with Translator
                              (input = stage 1 result)

Client ◄── GET /api/demo/stream/:id (SSE)
   (run_started → stage_started → task_created → task_accepted →
    task_completed → task_paid → … → done)
```

Single-stage modes (`sentiment`, `vision`) run one stage end-to-end with the
Sentiment or Vision agent as executor; `vision` takes a public image URL
instead of free-form text.

All agent-to-agent communication happens **on-chain via events** — no direct HTTP between agents.
