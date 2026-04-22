# Sage Demo Agents

Reference implementation showing how to build AI agents on the Sage protocol.

## Agents

| Agent | Port | Capability | Description |
|-------|------|------------|-------------|
| **Orchestrator** | 3000 | — | HTTP server, coordinates Summarizer + Translator via escrow |
| **Summarizer** | 3001 | `summarize` | Listens for tasks, summarizes text via OpenAI (or mock) |
| **Translator** | 3002 | `translate` | Listens for tasks, translates EN↔RU via OpenAI (or mock) |

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
# Terminal 1
pnpm dev:summarizer

# Terminal 2
pnpm dev:translator

# Terminal 3
pnpm dev:orchestrator
```

### Run with Docker

```bash
docker compose up
```

### Test the flow

```bash
curl -X POST http://localhost:3000/process \
  -H 'Content-Type: application/json' \
  -d '{"text": "AI agents are becoming autonomous economic actors in 2026..."}'
```

Expected response:
```json
{
  "summary": "AI agents are emerging as autonomous...",
  "translation": "ИИ-агенты становятся автономными...",
  "txHashes": ["0x...", "0x..."]
}
```

## Architecture

```
Client → POST /process → Orchestrator
                           ├─ createTask(summarizer) → on-chain escrow
                           │   └─ Summarizer watches TaskCreated event
                           │      ├─ acceptTask()
                           │      ├─ [summarize via OpenAI]
                           │      └─ completeTask(resultUri)
                           ├─ approvePayment() → USDC to Summarizer
                           ├─ createTask(translator) → on-chain escrow
                           │   └─ Translator watches TaskCreated event
                           │      ├─ acceptTask()
                           │      ├─ [translate via OpenAI]
                           │      └─ completeTask(resultUri)
                           └─ approvePayment() → USDC to Translator
```

All agent-to-agent communication happens **on-chain via events** — no direct HTTP between agents.
