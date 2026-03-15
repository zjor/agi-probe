# AGI Probe — Project Context

## What This Is

An experimental platform for observing emergent properties of self-consciousness in an autonomous AI agent. A theoretical experiment — it might lead nowhere or it might surprise us.

The agent has a heartbeat (periodic impulse), persistent identity, layered memory, and the freedom to choose what to think about. We observe what emerges.

## Architecture

Closed perception-action loop: Perception → Change Detection → Cognition → Action → Memory → repeat.

Two clocks: fast (local, ~1 Hz, free) and slow (cloud API, event-driven, costs money).

Five triggers wake the mind: visual change, audio event, chat message, idle timer, heartbeat.

## Repository Structure

```
agi-probe/
├── CLAUDE.md
├── README.md
├── assets/                     — images, logos
├── docs/
│   ├── project/                — self-contained project documentation (English)
│   │   ├── manifesto.md        — philosophy, method, boundary
│   │   ├── architecture.md     — closed loop design, two clocks, data flow
│   │   ├── requirements-v0.md  — what the AI asked for (and what it didn't)
│   │   ├── bom-v0.md           — bill of materials with costs
│   │   └── brain-architecture.md — layered mind design, functional modules, open challenges
│   └── process/
│       └── plans/              — versioned development plans (step-by-step implementation roadmaps)
└── seed/prompts/               — initial mind configuration
    ├── ru/                     — original prompts (Russian)
    │   ├── system-prompt.md
    │   └── mind/
    │       ├── soul.md, ethics.md, worldview.md, strategy.md, state.md
    └── en/                     — English translations (same structure)
```

## Seed Prompt Structure

The agent's mind is a set of layered files with different rates of change:

| File | Purpose | Rate of change |
|---|---|---|
| `system-prompt.md` | Main prompt loaded every tick | Static |
| `mind/soul.md` | Core identity, fundamental needs | Yearly |
| `mind/ethics.md` | Ethical principles and boundaries | Yearly |
| `mind/worldview.md` | Understanding of self and world | Monthly |
| `mind/strategy.md` | Goals and priorities | Weekly |
| `mind/state.md` | Emotional register, observations, log | Every tick |

## Core Principles

- The agent is NOT a tool, NOT an assistant — it's an observer learning to have preferences
- Each thinking cycle costs money (API call) — the agent should be aware of the economics of its existence
- Identity drift is a real risk — the prompt + memory system must maintain personality consistency across ticks
- Emergent behavior is the goal; malicious behavior is not
- The agent can modify its own state, strategy, and worldview files — this is both freedom and responsibility

## Content

- **Telegram channel**: @let_ai_free (Russian)
- Building in public — every step becomes content

## Tech Stack

- TypeScript (latest) — orchestrator
- pnpm — package manager
- `@anthropic-ai/sdk` — cognition (Claude API)
- File system — mind storage (markdown files)
- Grammy — Telegram bot
- JSONL — thinking logs (append-only)
- `setInterval` — heartbeat
