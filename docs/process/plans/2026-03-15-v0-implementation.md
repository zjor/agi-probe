# 2026-03-15 — V0 Implementation Plan

## Stack

| Component | Choice |
|---|---|
| Language | TypeScript (latest) |
| Package manager | pnpm |
| LLM | Claude API via `@anthropic-ai/sdk` |
| Telegram | `grammy` |
| Config | `.env` + typed config loader |
| Logging | JSONL (append-only) |
| State storage | Markdown files on disk (external runtime directory) |
| Locking | File-system lock (lockfile per mind layer) |

## Modules

### 1. Config (`src/config.ts`)
- Load `.env` via `dotenv`
- Typed config object: API keys, heartbeat interval (ms), file paths, cost limit
- **`RUNTIME_DIR`** — absolute path to the runtime directory, outside the repo. Default: `~/.agi-probe/runtime`. All mutable state (mind files, conversations, logs) lives here.
- Validate on startup, fail fast if anything missing

### 2. State Manager (`src/state.ts`)

**Runtime directory layout** (`$RUNTIME_DIR`):
```
$RUNTIME_DIR/
├── mind/
│   ├── soul.md            — copied from seed, read-only at runtime
│   ├── ethics.md          — copied from seed, read-only at runtime
│   ├── worldview.md       — agent-writable
│   ├── strategy.md        — agent-writable
│   ├── state.md           — agent-writable (every tick)
│   └── history/           — snapshots before each write
│       ├── state.md.2026-03-15T10-00-00Z
│       ├── worldview.md.2026-03-15T12-30-00Z
│       └── ...
├── conversations/         — per-channel JSON files
├── logs/                  — JSONL output
│   ├── thinking-2026-03-15.jsonl
│   └── raw-2026-03-15.jsonl
└── system-prompt.md       — copied from seed, read-only at runtime
```

**Bootstrap (first run)**:
1. Check if `$RUNTIME_DIR/mind/` exists
2. If not — create the directory structure and copy all files from `seed/prompts/en/` into it
3. If yes — validate that all required files are present, warn if any are missing
4. This is the only time seed files are used. After bootstrap, the agent's mind lives entirely in `$RUNTIME_DIR`.

**Read/write**:
- Read/write mind layer files from `$RUNTIME_DIR/mind/`
- `soul.md` and `ethics.md` are enforced read-only (state manager refuses writes)
- File-based locking: create `<file>.lock` before write, remove after — skip tick if lock exists (crash recovery: stale lock timeout)
- **Snapshot-on-write**: before overwriting a file, copy the current version to `mind/history/<filename>.<ISO-timestamp>`
- Atomic writes: write to `.tmp`, rename into place
- Direct writes within the tick (agent decides → applied immediately)

### 3. Prompt Assembler (`src/prompt.ts`)
- Each tick: read all mind layers from `$RUNTIME_DIR/mind/` + event queue → build messages array for Claude API
- System prompt = `$RUNTIME_DIR/system-prompt.md` content
- User message = assembled context: current state, pending events, conversation histories, cost summary
- Returns `MessageParam[]` ready for the SDK

### 4. Event Queue (`src/events.ts`)
- In-memory queue, drains on each tick (tick coalescing)
- Event types: `chat_message`, `idle_timeout`, `heartbeat`, `visual_change`, `audio_event`
- Each event: `{ type, timestamp, payload, channel?: ChannelId }`
- `chat_message` events carry a `channel` field identifying the source (see Module 10)
- Heartbeat pushes a `heartbeat` event on interval; Telegram adapter pushes `chat_message` events

### 4a. Conversation Memory (`src/conversations.ts`)

Per-channel conversational context, so the agent maintains separate conversation history with each person/chat.

**Channel identifier** — a composite key:
```typescript
type ChannelId = {
  platform: 'telegram' | 'whatsapp' | string;  // extensible
  chatId: string;                                // platform-specific chat ID
};

// Serialized as: "telegram:123456789", "whatsapp:79001234567"
function channelKey(ch: ChannelId): string {
  return `${ch.platform}:${ch.chatId}`;
}
```

**Storage** — one JSON file per channel in `$RUNTIME_DIR/conversations/`:
```
$RUNTIME_DIR/conversations/
  telegram_123456789.json
  telegram_987654321.json
  whatsapp_79001234567.json
```

**File format**:
```json
{
  "channel": { "platform": "telegram", "chatId": "123456789" },
  "displayName": "Sergei",
  "messages": [
    { "role": "user", "text": "Hello", "timestamp": "2026-03-15T10:00:00Z", "messageId": "42" },
    { "role": "agent", "text": "Hello, Sergei.", "timestamp": "2026-03-15T10:00:05Z" },
    ...
  ]
}
```

**Sliding window**: Only the last N messages (configurable, default 20) are loaded into context per channel. Older messages remain in the file for history but are not sent to Claude.

**API**:
- `getHistory(channel: ChannelId): Message[]` — returns last N messages
- `appendMessage(channel: ChannelId, msg: Message): void` — appends and writes to disk (atomic write)
- `listChannels(): ChannelId[]` — list all known channels (scan directory)

**How it feeds into the prompt**: The Prompt Assembler (Module 3) collects all `chat_message` events from the queue, groups them by channel, loads the conversation history for each channel, and presents them as distinct conversations in the user message. The agent sees who said what and in which channel.

**How the agent responds**: The `send_telegram` tool gains a `chat_id` parameter so the agent can direct replies to the correct conversation. After sending, the response is appended to that channel's history.

### 5. Cognitive Core (`src/core.ts`)

**Tick mutex**: A boolean `tickInProgress` flag guarding the entry point. When a trigger (heartbeat, chat message) calls `runTick()`:
1. Check `tickInProgress` — if `true`, log `tick_skipped` event with reason and queued event count, return immediately. Events stay in the queue for the next tick.
2. Set `tickInProgress = true`
3. Execute the tick (see below)
4. Set `tickInProgress = false` in a `finally` block (always clears, even on error)

**Tick execution flow**: `perceive → assemble prompt → agentic loop → log`

**Agentic loop** (tool-call iteration):
1. Call Claude API with assembled messages + tool definitions
2. If response contains tool calls → execute them, append tool results to messages, go to step 1
3. If response is a final text message (no tool calls) → tick complete
4. **Hard cap**: `MAX_TOOL_ITERATIONS` (default 10, configurable). If reached, log `tick_forced_stop` warning, end the tick. This prevents runaway loops where Claude keeps calling tools indefinitely.

**Cost gate**: Before each Claude API call within the loop, check cumulative cost against `COST_LIMIT_USD`. If exceeded, log `cost_limit_reached`, send a final Telegram alert, and shut down gracefully.

**Tools** (defined as Claude tool-use JSON schemas):
  - `update_state` — write to `state.md` (content: string)
  - `update_strategy` — write to `strategy.md` (content: string)
  - `update_worldview` — write to `worldview.md` (content: string)
  - `send_telegram` — send a message via Grammy (chat_id: string, message: string, reply_to_message_id?: number)
  - `log_thought` — internal monologue entry (thought: string, category?: string)

**Cost tracking**: Extract `usage` (input_tokens, output_tokens) from each API response, compute cost using model pricing, accumulate per-tick and per-session totals. Inject cost summary into next tick's context.

### 6. Logger (`src/logger.ts`)
- Append to `$RUNTIME_DIR/logs/thinking-YYYY-MM-DD.jsonl`
- Each line: `{ timestamp, tick_id, trigger, events, prompt_summary, response_summary, tool_calls, state_delta, cost_usd, cumulative_cost_usd }`
- Raw full log: `$RUNTIME_DIR/logs/raw-YYYY-MM-DD.jsonl` (full prompt + response for debugging)
- Rotation: new file per day

### 7. Telegram Adapter (`src/telegram.ts`)
- Grammy bot instance
- Incoming messages → push to event queue
- Outgoing messages → called by the `send_telegram` tool
- Graceful shutdown

### 8. Heartbeat (`src/heartbeat.ts`)
- `setInterval` at configured rate
- Pushes `heartbeat` event to queue
- Triggers a tick of the cognitive core

### 9. Entry Point (`src/index.ts`)
- Load config
- **Bootstrap runtime**: if `$RUNTIME_DIR/mind/` doesn't exist, create directory structure and copy seed prompts from `seed/prompts/en/` into it. Log `runtime_bootstrapped` event.
- Initialize all modules (state manager, logger, event queue, conversations, telegram, cognitive core)
- Start Telegram bot (polling)
- Start heartbeat
- Graceful shutdown on SIGINT/SIGTERM

## Project Structure

**Repository** (code + seed prompts):
```
agi-probe/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── state.ts
│   ├── prompt.ts
│   ├── events.ts
│   ├── conversations.ts      — per-channel conversation memory
│   ├── core.ts
│   ├── logger.ts
│   ├── telegram.ts
│   ├── heartbeat.ts
│   └── tools/
│       ├── index.ts          — tool definitions for Claude
│       ├── update-state.ts
│       ├── update-strategy.ts
│       ├── update-worldview.ts
│       ├── send-telegram.ts
│       └── log-thought.ts
├── seed/prompts/              — pristine mind templates (checked into git)
├── docs/
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

**Runtime directory** (`$RUNTIME_DIR`, default `~/.agi-probe/runtime`, lives outside repo):
```
$RUNTIME_DIR/
├── system-prompt.md           — copied from seed on first run
├── mind/
│   ├── soul.md                — read-only (copied from seed)
│   ├── ethics.md              — read-only (copied from seed)
│   ├── worldview.md           — agent-writable
│   ├── strategy.md            — agent-writable
│   ├── state.md               — agent-writable (every tick)
│   └── history/               — pre-write snapshots
├── conversations/             — per-channel JSON files
└── logs/
    ├── thinking-YYYY-MM-DD.jsonl
    └── raw-YYYY-MM-DD.jsonl
```

## Implementation Order

1. **Scaffold** — `pnpm init`, tsconfig, .env.example, .gitignore
2. **Config** — load and validate env vars, including `COST_LIMIT_USD`, `ALLOWED_TELEGRAM_USERS`, `MAX_TOOL_ITERATIONS`, `CONVERSATION_HISTORY_LENGTH`
3. **State Manager** — read/write mind files with locking + snapshot-on-write (copy previous version to `mind/history/`)
4. **Logger** — JSONL append with daily rotation for both `thinking` and `raw` logs
5. **Event Queue** — in-memory queue with drain, events carry `channel` field
6. **Conversation Memory** — per-channel JSON storage, sliding window read, atomic append
7. **Prompt Assembler** — stitch mind layers + events + conversation histories into messages
8. **Cognitive Core** — single tick (no loop yet), call Claude, parse tool use. **Include tick mutex and cost gate from the start.**
9. **Tools** — implement each tool handler (`send_telegram` writes to conversation history after sending)
10. **Heartbeat** — interval timer triggering ticks (respects tick mutex — skip if busy)
11. **Telegram Adapter** — Grammy bot, wire to event queue with channel ID. **User ID allowlist filtering.**
12. **Entry Point** — glue everything, graceful shutdown
13. **First run** — test with heartbeat only, observe JSONL output, verify cost tracking

## Resolved Questions

- **Heartbeat interval for v0**: 60s to keep costs low during dev. Configurable via `.env`.
- **Previous thoughts in context**: Include last 5 entries from `state.md` as sliding window. Keeps context grounded without blowing up token count.
- **Cost hard limit**: YES — mandatory. Auto-shutdown when cumulative cost exceeds `COST_LIMIT_USD` from config. Default $5/day for dev.

## Risks & Mitigations

### CRITICAL: Tick Reentrancy — RESOLVED
**Risk**: Heartbeat fires while a previous tick is still running (Claude API call takes 5-30s). Two concurrent ticks corrupt state and double API costs.
**Mitigation**: `tickInProgress` boolean mutex in the cognitive core (see Module 5). Triggers that arrive during an active tick are kept in the event queue and processed on the next tick. Skips are logged as `tick_skipped` events.

### CRITICAL: Cost Runaway
**Risk**: Bug in tool-call loop, Telegram spam, or tight heartbeat burns through API budget in minutes.
**Mitigation**: Implement hard cost limit as a mandatory startup config. Check before every API call. Auto-shutdown with alert on breach. Also: cap tool-call loop iterations (max 5 per tick).

### CRITICAL: Self-Injection via Mind Files
**Risk**: Agent writes adversarial or drifting content into its own mind files, which persist into every future tick's prompt.
**Mitigation for v0**: Git-commit mind file snapshots before each write (or copy to `mind/history/`). Add a manual review step — human can diff and revert. Future: automated drift detection comparing against soul.md invariants.

### HIGH: Telegram Prompt Injection
**Risk**: Any Telegram user can send messages that become part of the Claude prompt — direct injection vector.
**Mitigation**: Allowlist of Telegram user IDs in config (`ALLOWED_TELEGRAM_USERS`). Reject all messages from unknown users. Sanitize message content (strip markdown formatting that could interfere with prompt structure).

### HIGH: System Prompt / Tool Use Conflict — RESOLVED
**Risk**: Seed `system-prompt.md` originally defined a JSON response format, incompatible with tool use.
**Resolution**: System prompt rewritten (`seed/prompts/en/system-prompt.md`). JSON response format removed. All actions are now expressed through tool calls. Each tool is described with parameters and usage guidance. `soul.md` and `ethics.md` are explicitly marked read-only.

### MEDIUM: Unbounded Tool Call Loop — RESOLVED
**Risk**: Claude returns tool calls indefinitely, each costing another API round-trip.
**Mitigation**: `MAX_TOOL_ITERATIONS` hard cap (default 10) in the agentic loop (see Module 5). After limit, `tick_forced_stop` is logged and the tick ends.

### MEDIUM: Event Queue Volatility
**Risk**: In-memory queue loses all pending events on crash/restart. Telegram messages vanish.
**Mitigation acceptable for v0**: Document this limitation. For production: persist queue to a file. Grammy's built-in update handling provides some durability via Telegram's getUpdates offset.

### LOW: Log File Growth
**Risk**: `raw.jsonl` grows 15-70MB/day with full prompts. No cleanup = disk full in weeks.
**Mitigation**: Daily rotation (already planned). Add config for max log retention days (default 7). `raw.jsonl` rotation should be daily too, not just `thinking.jsonl`.

### NOTE: Architecture Doc Divergence
The architecture doc (`docs/project/architecture.md`) specifies Python, SQLite, Raspberry Pi, OpenCV. This v0 plan intentionally deviates — TypeScript, file system, no hardware. This is the software-only embryo phase. Hardware integration comes in v1. Both docs are valid for their respective scope.
