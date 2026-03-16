# Dual-Lane Architecture — Implementation Plan

**Date:** 2026-03-16
**Proposal:** [2026-03-15-dual-lane-architecture.md](../../project/proposals/2026-03-15-dual-lane-architecture.md)
**Status:** Draft

---

## Phase 1: Shared Infrastructure

Extract shared state out of `core.ts` so both lanes can use it independently.

### Step 1.0 — Add per-channel serialization to `src/conversations.ts`

**Why:** The fast lane will call `appendMessage()` concurrently for the same channel. The current read-modify-write pattern is not safe — two concurrent calls both read the file, both append, and the second write silently drops the first append. This is a data loss bug that must be fixed before the fast lane exists.

Add a per-channel async lock using a promise chain:

```typescript
// In ConversationManager
private locks = new Map<string, Promise<void>>();

async appendMessage(channel: ChannelId, msg: Message): Promise<void> {
  const key = channelKey(channel);
  const prev = this.locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => this._doAppend(channel, msg));
  this.locks.set(key, next.catch(() => {})); // swallow to avoid poisoning the chain
  return next;
}
```

This serializes writes per-channel while allowing different channels to proceed in parallel. The existing `_doAppend()` (renamed from current `appendMessage()`) keeps its read-file → append → write-file logic unchanged.

**Files touched:** modify `src/conversations.ts`

### Step 1.1 — Create `src/cost-tracker.ts`

Extract cost tracking from `core.ts` into a standalone module with **reserve/settle** semantics to prevent budget overshoot under concurrent fast lane calls.

**Problem with naive check-then-spend:** `isWithinBudget()` and `addCost()` are separated by an `await callClaude()`. Two concurrent calls both pass the check, both fire API calls, both add cost — exceeding the budget by 2x or more.

**Solution:** Optimistically reserve an estimated cost before the API call, then settle with the actual cost after.

```typescript
interface CostTracker {
  /** Reserve estimated cost before an API call. Returns false if would exceed budget. */
  reserveCost(estimatedUsd: number): boolean;
  /** Settle after API call: release the reservation and record actual cost. */
  settleCost(reservedUsd: number, actualInputTokens: number, actualOutputTokens: number): void;
  /** Fallback: release reservation without recording cost (e.g., on API error). */
  releaseReservation(reservedUsd: number): void;
  getCumulativeCost(): number;
  isWithinBudget(): boolean;
}
```

- Owns `cumulativeCostUsd`, `reservedCostUsd`, `costLimitUsd`
- `reserveCost(est)` checks `cumulativeCostUsd + reservedCostUsd + est < costLimitUsd`, then adds `est` to `reservedCostUsd`
- `settleCost(reserved, input, output)` subtracts `reserved` from `reservedCostUsd`, adds actual cost to `cumulativeCostUsd`
- `releaseReservation(reserved)` subtracts `reserved` from `reservedCostUsd` (used on error paths)
- `isWithinBudget()` checks `cumulativeCostUsd + reservedCostUsd < costLimitUsd`
- Default reservation estimate: $0.02 per call (configurable) — a conservative upper bound for a single Sonnet call

**Files touched:** new `src/cost-tracker.ts`, modify `src/core.ts` (remove cost logic)

### Step 1.2 — Create `src/impressions.ts`

New impression queue module, same pattern as `events.ts`, **with a configurable max size**.

```typescript
interface Impression {
  timestamp: string;
  channel: ChannelId;
  userSaid: string;      // user's message, truncated to 200 chars
  agentReplied: string;  // agent's reply, truncated to 300 chars
  emotionalSignal?: string;
  // Future: add a `summary` field with a one-line LLM-generated label (e.g., "philosophical challenge",
  // "casual greeting"). Requires an extra API call or structured output in the fast lane prompt — more
  // expensive but would give the slow lane better signal for prioritizing which impressions matter.
}

interface ImpressionQueue {
  push(impression: Impression): void;
  drain(): Impression[];
  size(): number;
}
```

- Array-backed queue with push/drain/size — mirrors `EventQueue`
- **Max size** (default 50, configurable via `MAX_IMPRESSIONS` env var). When full, oldest impressions are dropped. Log a warning when dropping occurs.
- `push()` checks size before appending; if at capacity, shifts the oldest entry and logs

**Files touched:** new `src/impressions.ts`

### Step 1.3 — Create `src/claude-client.ts`

Extract the Anthropic API call logic from `core.ts` into a reusable wrapper.

```typescript
interface ClaudeCallResult {
  response: Anthropic.Message;
  inputTokens: number;
  outputTokens: number;
}

function callClaude(params: {
  client: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}): Promise<ClaudeCallResult>;
```

Both lanes use this to call the API. Cost tracking happens at the caller level (lane calls `costTracker.addCost()` after receiving the result).

**Files touched:** new `src/claude-client.ts`, modify `src/core.ts` (use new client)

---

## Phase 2: Fast Lane

### Step 2.1 — Create `src/fast-lane-prompt.ts`

Lightweight prompt assembly for the fast lane. Much simpler than the full `prompt.ts`.

**Includes:**
- System prompt (same `system-prompt.md`)
- All mind files (snapshot read, no locks)
- Conversation history for the triggering channel only
- Recent thoughts (last 10) — for mood/tone context

**Excludes:**
- Event queue contents
- Impressions from other channels
- Tick metadata (tick ID, time since last tick)

**Adds:**
- A brief instruction: "You are responding to a live conversation. Be natural and responsive. You do NOT have access to update your mind files — that happens in your background thinking."

**Files touched:** new `src/fast-lane-prompt.ts`

### Step 2.2 — Define fast lane tool subset

Create a filtered tool definition list for the fast lane.

```typescript
// src/tools/fast-lane-tools.ts
export const fastLaneToolDefinitions: Anthropic.Tool[];  // send_telegram, log_thought, web_search only
```

Reuse existing `executeTool()` — it already dispatches by name. The restriction is purely in what tools Claude sees in the prompt.

**Files touched:** new `src/tools/fast-lane-tools.ts` (or add export to `src/tools/index.ts`)

### Step 2.3 — Create `src/fast-lane.ts`

The fast lane processor. Called directly by `telegram.ts` on each incoming message.

```typescript
interface FastLane {
  handleMessage(channel: ChannelId, text: string, displayName: string, messageId?: string): Promise<void>;
}
```

**Flow:**
1. Check `costTracker.isWithinBudget()` — if over budget, send a "I'm out of budget" message and return
2. Reserve cost via `costTracker.reserveCost(estimatedCostUsd)` — if reservation fails, send budget message and return
3. Read mind files snapshot via `stateManager.readMindFile()` (concurrent reads are safe)
4. Read conversation history for this channel via `conversationManager.getHistory()`
5. Get recent thoughts via `logger.getRecentThoughts(10)`
6. Assemble prompt via `assembleFastLanePrompt()`
7. **Agentic loop** (wrapped in try/catch — see error handling below):
   - Call Claude with fast lane tools only
   - Execute tool calls — **with runtime allowlist check** (only `send_telegram`, `log_thought`, `web_search`; reject any other tool name even if Claude hallucinates it)
   - Loop until `end_turn` or max iterations (cap at **3 iterations** for fast lane — if it hasn't replied by then, something is wrong)
   - Settle cost via `costTracker.settleCost()` after each API call
8. After loop completes, build and push an `Impression` to the impression queue
9. Log the fast lane call (tagged `lane: 'fast'`)

**Error handling:** Wrap steps 3–8 in try/catch. On any error:
- Release the cost reservation via `costTracker.releaseReservation()`
- Send a fallback Telegram message: "I'm having trouble thinking right now, try again in a moment"
- Log the error with full context: `{ lane: 'fast', error: err.message, channel, trigger: 'chat_message' }`
- Do NOT retry automatically — retries risk double-spending and double-responding

**Key detail — Impression generation:** Extract fields directly from the conversation turn, no extra API call:
- `userSaid` = incoming message text, truncated to 200 chars
- `agentReplied` = agent's text blocks concatenated, truncated to 300 chars
- No summary — the slow lane receives the raw snippets and does its own sensemaking during background thinking. It's the consumer, so it should own the interpretation.

**Tool safety:** The fast lane restricts tools via prompt-level tool definitions, but `executeTool()` itself will execute any tool by name. Add a runtime allowlist check before dispatching:
```typescript
const FAST_LANE_ALLOWED_TOOLS = new Set(['send_telegram', 'log_thought', 'web_search']);
if (!FAST_LANE_ALLOWED_TOOLS.has(toolName)) {
  return { error: `Tool ${toolName} is not available in the fast lane` };
}
```

**Files touched:** new `src/fast-lane.ts`

---

## Phase 3: Slow Lane

### Step 3.1 — Update `src/prompt.ts` to include impressions

Add an `## Impressions from Recent Conversations` section to the existing prompt assembly.

Between "Recent Thoughts" and "Events Since Last Tick", add:

```
## Impressions from Recent Conversations
- [2026-03-16T10:05:00Z] telegram:12345 — User: "What's the weather like today?" → Agent: "Based on what I can find, Moscow is around -5°C with light snow..."
- [2026-03-16T10:06:30Z] telegram:67890 — User: "Don't you think your worldview is too optimistic?" → Agent: "That's a fair challenge. I tend to lean optimistic because..."
```

The slow lane prompt explicitly instructs: "Review the impressions below. Decide whether any conversations should influence your state, worldview, or strategy."

**Files touched:** modify `src/prompt.ts` (add impressions parameter and rendering)

### Step 3.2 — Create `src/slow-lane.ts`

Refactor the current `core.ts` tick loop into the slow lane module.

```typescript
interface SlowLane {
  runTick(trigger: string): Promise<void>;
  isRunning(): boolean;
  getTickCount(): number;
}
```

**Changes from current `core.ts`:**
- Drains **both** `eventQueue` and `impressionQueue`
- Passes impressions to `assemblePrompt()`
- Keeps the mutex (`tickInProgress`)
- Keeps the agentic loop with **all 6 tools** (including mind file updates)
- Uses shared `costTracker` instead of local cost variables
- Tags log entries with `lane: 'slow'`
- **Removes** the cascading tick logic (follow-up on queued events) — no longer needed since chat messages go to fast lane, and heartbeat is the only slow lane trigger

**Files touched:** new `src/slow-lane.ts`, `src/core.ts` becomes deprecated/deleted

---

## Phase 4: Rewiring

### Step 4.1 — Update `src/telegram.ts`

Change message handler to call fast lane directly instead of pushing to event queue + triggering tick.

**Before:**
```
message → appendConversation → push event → core.runTick('chat_message')
```

**After:**
```
message → appendConversation → fastLane.handleMessage(channel, text, displayName, messageId)
```

- Remove `core` dependency and `setCore()` method
- Add `fastLane` dependency and `setFastLane()` method (or inject at creation)
- Chat messages no longer go through the event queue at all
- The event queue is now slow-lane-only (heartbeat events, visual change, audio, idle)

**Files touched:** modify `src/telegram.ts`

### Step 4.2 — Update `src/heartbeat.ts`

Change heartbeat to call slow lane instead of core.

**Before:**
```
interval → push heartbeat event → core.runTick('heartbeat')
```

**After:**
```
interval → push heartbeat event → slowLane.runTick('heartbeat')
```

- Update heartbeat interval default to 120000ms (2 minutes)
- Replace `core` with `slowLane` dependency

**Files touched:** modify `src/heartbeat.ts`

### Step 4.3 — Update `src/config.ts`

- Change `heartbeatIntervalMs` default from `60000` to `120000`

**Files touched:** modify `src/config.ts`

### Step 4.4 — Rewrite `src/index.ts`

Update the bootstrap sequence to wire the new components.

**New startup sequence:**
1. Load config
2. Create StateManager
3. Create Logger
4. Create EventQueue (slow lane only now)
5. Create ImpressionQueue (new)
6. Create CostTracker (new, shared)
7. Create ConversationManager
8. Create TelegramAdapter (Grammy bot)
9. Create FastLane (stateManager, conversationManager, logger, costTracker, impressionQueue, bot)
10. Create SlowLane (stateManager, conversationManager, logger, costTracker, eventQueue, impressionQueue, bot)
11. Wire: telegram → fastLane
12. Create Heartbeat (slowLane)
13. Signal handlers, start bot + heartbeat

**Files touched:** modify `src/index.ts`

### Step 4.5 — Delete `src/core.ts`

All logic has been migrated to `fast-lane.ts`, `slow-lane.ts`, `cost-tracker.ts`, and `claude-client.ts`. Delete `core.ts`.

**Files touched:** delete `src/core.ts`

---

## Phase 5: Logging & Observability

### Step 5.1 — Add lane tagging to logs

Update `Logger` interface and implementation to support a `lane` field.

```typescript
interface TickLogEntry {
  // ... existing fields
  lane: 'fast' | 'slow';
}
```

Both `fast-lane.ts` and `slow-lane.ts` pass their lane identifier when logging.

**Files touched:** modify `src/logger.ts`

### Step 5.2 — Add impression logging

Log impressions as they're enqueued (for debugging).

Add a new log entry type or reuse thought log:
```typescript
interface ImpressionLogEntry {
  timestamp: string;
  lane: 'fast';
  channel: string;
  summary: string;
}
```

**Files touched:** modify `src/logger.ts`

---

## Phase 6: Testing & Validation

### Step 6.1 — Manual smoke test: fast lane only

1. Start the agent
2. Send a Telegram message
3. Verify: immediate response (no waiting for heartbeat)
4. Verify: impression appears in queue
5. Verify: cost tracked correctly

### Step 6.2 — Manual smoke test: slow lane only

1. Wait for heartbeat tick (2 min)
2. Verify: slow lane drains events + impressions
3. Verify: mind files updated
4. Verify: impressions appear in the slow lane prompt

### Step 6.3 — Manual smoke test: concurrent operation

1. Send a message while a heartbeat tick is running
2. Verify: fast lane responds immediately, doesn't wait for slow lane
3. Verify: no file corruption (atomic reads/writes)

### Step 6.4 — Cost limit test

1. Set a low cost limit ($0.01)
2. Send messages + let heartbeat run
3. Verify: both lanes stop when budget exhausted

---

## File Summary

| Action | File |
|--------|------|
| **Modify** | `src/conversations.ts` — per-channel async serialization (Step 1.0) |
| **Create** | `src/cost-tracker.ts` — with reserve/settle semantics |
| **Create** | `src/impressions.ts` — with max size cap |
| **Create** | `src/claude-client.ts` |
| **Create** | `src/fast-lane-prompt.ts` |
| **Create** | `src/fast-lane.ts` — with error handling + tool allowlist |
| **Create** | `src/slow-lane.ts` |
| **Create** | `src/tools/fast-lane-tools.ts` |
| **Modify** | `src/prompt.ts` — add impressions section |
| **Modify** | `src/telegram.ts` — wire to fast lane |
| **Modify** | `src/heartbeat.ts` — wire to slow lane, 2 min interval |
| **Modify** | `src/config.ts` — default heartbeat 120s, `MAX_IMPRESSIONS` |
| **Modify** | `src/index.ts` — new bootstrap wiring |
| **Modify** | `src/logger.ts` — lane tagging |
| **Delete** | `src/core.ts` — replaced by fast-lane + slow-lane |

## Risks & Mitigations

> **Note:** Critical issues (conversation file corruption, cost overshoot, fast lane error handling, impression quality, queue bounds) have been integrated directly into the implementation steps above. The risks below are residual items.

### LOW — Cost Tracker Not Persisted

**Risk:** Carried forward from current architecture. If the process crashes and restarts, `cumulativeCostUsd` resets to 0, allowing the agent to spend the full budget again.

**Mitigation (future):** Periodically write cumulative cost to a file (e.g., every slow lane tick). On startup, read it back. Not blocking for this implementation but should be tracked.

### LOW — `getRecentThoughts()` Concurrent Access

**Risk:** Fast lane reads JSONL logs while slow lane is appending to them. Concurrent read during a partial line write could return malformed JSON.

**Mitigation:** `getRecentThoughts()` already parses line-by-line and should skip malformed lines gracefully. Verify this is the case in the existing logger code — add a try/catch around `JSON.parse` per line if not already present.

### LOW — `send_telegram` in Slow Lane

**Risk:** The slow lane has all 6 tools including `send_telegram`. The background thinking process could spontaneously message users, which may be confusing. Consider whether this is intentional or whether `send_telegram` should be slow-lane-restricted.

---

## Implementation Order

**Step 1.0** (conversation serialization) must land first — it's the only modification to existing code in Phase 1 and is a prerequisite for safe concurrent fast lane operation.

Steps 1.1–1.3 and Phases 2–3 create new files only, so they don't break the existing system. Phase 4 is the cutover — swap the wiring in one commit. Phase 5 is polish. Phase 6 validates.

Estimated scope: ~700–900 lines of new code (increased due to error handling, reserve/settle, serialization), ~250 lines removed from `core.ts`, ~80 lines modified in existing files.
