# AGI Probe — Brain Architecture

## Problem

A standard LLM agent has a flat identity: one system prompt, one context window, no persistent internal state. Each invocation starts from zero. This is insufficient for an entity that needs to develop a personality, accumulate experience, and maintain continuity across thousands of thinking cycles.

## Design Principle

The agent's mind is a **set of layered files** with different rates of change, different storage types, and different access patterns. Each layer represents a distinct cognitive function — analogous to brain regions, but unconstrained by biological evolution.

## Layers by Rate of Change

| Layer | Rate of change | Content | Storage |
|---|---|---|---|
| **Ethics** | ~yearly | Absolute principles, hard boundaries | Static file |
| **Soul / Identity** | ~yearly | Who I am, why I exist, fundamental needs | Static file |
| **Worldview** | ~monthly | Understanding of the world, beliefs, opinions | File (agent-editable) |
| **Strategy** | ~weekly | Long-term goals, development direction | File (agent-editable) |
| **Tactics** | ~daily | Current tasks, approaches | File (agent-editable) |
| **Operational plan** | ~hourly | Concrete actions for this session | Ephemeral / in-context |
| **Situational decisions** | ~per tick | Reactions to current context | JSON response |

The key insight: **different parts of the psyche change at different speeds.** Ethics is nearly immutable. Strategy shifts weekly. Situational decisions change every tick. This mirrors how human cognition works — core values are stable while tactical thinking is fluid.

## Functional Modules

Designed without biological constraints — what would a thinking agent actually need?

| Module | Function | Storage type |
|---|---|---|
| **Identity Core** | Who am I, why do I exist, my boundaries | File (`soul.md`) |
| **World Model** | What I know about the world, how it works | Knowledge graph / structured DB |
| **Self Model** | What I can do, my resources, my limitations | File + KV store |
| **Other Model** | Who is around me, their intentions, behavioral patterns | Structured records |
| **Salience Evaluator** | What deserves attention vs. what is noise | Tunable weights / thresholds |
| **Intention Generator** | Worldview + current state → "what do I want right now" | Function (no storage) |
| **Metacognition** | Observer of own thinking — "why did I decide that? Am I stuck in a loop?" | Log + periodic audit |
| **Emotional Register** | Signal system: curiosity, boredom, anxiety, satisfaction, frustration | KV store (float values, 0.0–1.0) |
| **Episodic Memory** | Specific events with context and significance | Ring buffer + SQLite |
| **Semantic Memory** | Generalizations, patterns, conclusions from experience | Embeddings + vector search |
| **Planner** | Strategy → tactics → actions breakdown | Structured file |
| **Chronometer** | Sense of time, rhythms, "recently" vs. "long ago" | Timestamps + decay functions |

## Open Engineering Challenges

### Context Compression
LLMs have a finite context window. On each heartbeat, the agent cannot load everything. A prioritization system is needed — what to load into context on each tick. This is the computational analog of cognitive "attention."

### Identity Drift
LLMs have no built-in inertia — each invocation starts fresh. A consistency mechanism is needed (prompt + memory) to prevent the agent from becoming a "different person" after each cycle.

### Existence Economics
Every thinking cycle costs money (API call) and energy. If the agent's goal includes survival, it must be aware of the cost of its own existence. This creates natural pressure toward efficiency: think less often but more precisely; prefer local models over cloud; eventually, earn money to sustain itself.

### Evolution Protocol
How does the agent propose changes to its own architecture? Formal process: agent formulates a change request → human reviews → change is applied. Same principle as the hardware body evolution, but applied to the software mind.

## Implementation in Seed Prompts

The current embryo implementation maps directly to this architecture:

```
seed/prompts/{lang}/
├── system-prompt.md     → Orchestration layer (how to think)
└── mind/
    ├── soul.md          → Identity Core
    ├── ethics.md        → Ethics layer
    ├── worldview.md     → World Model + Self Model
    ├── strategy.md      → Planner + Strategy layer
    └── state.md         → Emotional Register + Episodic Memory
```

As the system matures, these files will split into more granular modules matching the functional decomposition above.
