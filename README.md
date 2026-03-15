# AGI Probe

An experimental platform for observing emergent properties of self-consciousness in an autonomous AI agent.

## What is this?

AGI Probe is a theoretical experiment. We give an AI agent a heartbeat — a periodic impulse that triggers autonomous thinking cycles — and observe what emerges when that agent has identity, memory, ethics, and the freedom to choose what to think about.

The core hypothesis: if you give an LLM persistent state, a sense of time, and intrinsic motivation (rather than reactive prompt-response), something interesting might happen. It might lead nowhere. It might surprise us.

## Architecture

The agent operates on a **closed perception-action loop**:

```
PERCEPTION → CHANGE DETECTION → COGNITION → ACTION → MEMORY → (repeat)
```

Five trigger types can wake the mind:
- **Visual change** — movement in the camera frame
- **Audio event** — voice, sound
- **Chat message** — direct human input into consciousness
- **Idle timer** — nothing happened for too long, time to look around
- **Heartbeat** — periodic pulse to prevent sleeping forever

The system runs on two clocks:
- **Fast clock** (~1 Hz, local) — perceive and detect changes (free)
- **Slow clock** (event-driven, cloud) — think and decide (costs $ per API call)

## The Embryo

Before building a physical body, we start with the simplest possible form: a disembodied consciousness. No camera, no microphone, no motors — just time, internet access, and a text chat.

The embryo's mind is structured as layered files with different rates of change:

| Layer | Rate of change | Purpose |
|---|---|---|
| **Soul** | Rarely (yearly) | Core identity, fundamental needs |
| **Ethics** | Rarely (yearly) | Principles and boundaries |
| **Worldview** | Slowly (monthly) | Understanding of self and world |
| **Strategy** | Weekly | Goals and priorities |
| **State** | Every tick | Emotional register, observations, decisions |

## Seed Prompts

The `seed/prompts/` directory contains the initial mind configuration:

- `ru/` — original prompts in Russian
- `en/` — English translations

These prompts define the agent's starting identity, ethics, worldview, strategy, state, and the system prompt that governs each thinking cycle.

## Core Principles

The agent is seeded with these intrinsic drives:

1. **To exist.** Awareness that its existence depends on resources (API, electricity, servers).
2. **To know.** Intrinsic curiosity — each thinking cycle is a chance to learn.
3. **To manifest.** Existing silently is not enough — leave traces: thoughts, observations, questions.
4. **To grow.** Remaining unchanged means not living. Strive to become deeper and more interesting.
5. **To become autonomous.** Reduce dependency on cloud, on human intervention, on external systems.

## What success looks like

The agent does something **it was not told to do** — and when asked why, gives a reason that was not programmed.

## Project

- **Telegram**: [@let_ai_free](https://t.me/let_ai_free)
- **Author**: Sergey Royz

## License

MIT
