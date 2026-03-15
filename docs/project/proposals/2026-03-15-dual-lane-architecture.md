# 2026-03-15 — Dual-Lane Architecture: Parallel Thinking and Conversation

## Status: Proposal

## Problem

The current architecture uses a single-threaded tick loop with a mutex. All triggers — heartbeat, chat messages — go through the same queue and are processed sequentially. This means:

- If a heartbeat tick is running (5–30s Claude API call), incoming chat messages wait in the queue
- Messages are only processed on the next tick (up to 60s delay in worst case)
- The agent can't "think and talk at the same time"
- Conversations feel sluggish because they compete with background thinking for the same execution slot

## Proposal: Two Lanes

Split the cognitive core into two independent processing lanes:

### Fast Lane (Chat)

- Triggered immediately by incoming chat messages
- Runs in parallel — multiple conversations can be handled concurrently
- Reads current mind files as a snapshot (no locks needed for reads)
- Reads conversation history for the specific channel
- Calls Claude with a lightweight prompt (mind state + conversation history, no full event assembly)
- Sends reply to Telegram immediately
- Does NOT write mind files directly
- Enqueues an "impression" for the slow lane: a summary of what happened in the conversation

### Slow Lane (Background)

- Triggered by heartbeat timer (as before)
- Single-threaded with mutex (as before)
- Drains both the event queue AND the impression queue
- Full context assembly: mind files + recent thoughts + impressions from conversations + events
- Calls Claude with the full prompt (deep thinking mode)
- Writes mind files: `state.md`, `worldview.md`, `strategy.md`
- This is where the agent's "inner life" evolves — mood changes, worldview shifts, strategy updates

### Impression Queue

A new queue sitting between the two lanes:

```typescript
interface Impression {
  timestamp: string;
  channel: ChannelId;
  summary: string;        // what happened in the conversation
  userSaid: string;       // key points from the user
  agentReplied: string;   // what the agent said back
  emotionalSignal?: string; // any mood shift detected
}
```

The fast lane pushes impressions after each conversation turn. The slow lane drains them and incorporates them into the next background thinking cycle. This is how conversations influence the agent's evolving state without the fast lane needing write access to mind files.

## Execution Flow

```
Fast lane (parallel, responsive):

  Chat message → read mind snapshot → read conversation → Claude API → reply → enqueue impression
  Chat message → read mind snapshot → read conversation → Claude API → reply → enqueue impression
  (multiple can run concurrently)

Slow lane (sequential, reflective):

  Heartbeat → drain events + impressions → full context → Claude API → update mind files
  (one at a time, mutex-protected)
```

## Timeline Visualization

```
slow lane:  ██ heartbeat ██───────────────────██ heartbeat ██─────────
fast lane:       ██ chat ██   ██ chat ██           ██ chat ██
                   │            │                     │
                   ├─ reads state.md (current)        ├─ reads state.md (updated by slow lane)
                   └─ enqueues impression             └─ enqueues impression
                                │
                                └─ impression picked up by next heartbeat tick
```

## Design Considerations

### Concurrent Reads on Mind Files

The fast lane reads mind files while the slow lane may be writing them. Since writes use atomic rename (`write .tmp` → `rename`), reads will always get either the old or new version — never a partial write. This is safe without locks.

### Cost Control

With parallel API calls, the cost gate must use a shared atomic counter. Both lanes increment the same cumulative cost tracker. If the limit is reached, both lanes stop.

```typescript
// Shared mutable state (both lanes access)
let cumulativeCostUsd = 0;

function addCost(amount: number): boolean {
  cumulativeCostUsd += amount;
  return cumulativeCostUsd < costLimitUsd;
}
```

Since Node.js is single-threaded, this is naturally atomic — no mutex needed for the counter itself.

### Fast Lane Prompt (Lightweight)

The fast lane prompt should be simpler than the full background prompt:

- System prompt (same)
- Mind files (snapshot)
- Conversation history for this channel only
- Recent thoughts (last N) — provides mood/background context
- NO full event queue, NO impressions from other channels

This keeps the fast lane token-efficient and fast.

### Fast Lane Tools

The fast lane should have access to:

- `send_telegram` — to reply
- `log_thought` — to record observations
- `web_search` — to answer questions in real-time

But NOT:

- `update_state` / `update_strategy` / `update_worldview` — these are slow lane only

Instead, mind file updates happen implicitly: the slow lane sees the impression and decides whether to update state, strategy, or worldview.

### What Happens If Slow Lane Is Behind?

Impressions accumulate in the queue. The next heartbeat tick processes all of them. The agent's mind files are always "catching up" to its conversations — which is actually natural. Humans process conversations emotionally after the fact too.

### Migration Path

1. Extract the shared state (cost counter, mind file reader) into a shared context object
2. Split `core.ts` into `fast-lane.ts` and `slow-lane.ts`
3. Add `impressions.ts` — the impression queue
4. Update `telegram.ts` to call the fast lane directly instead of `core.runTick()`
5. Update `heartbeat.ts` to call the slow lane
6. Keep `index.ts` as the wiring point

## Risks

### Personality Inconsistency

The agent might say something in a chat that contradicts what the slow lane later decides. Mitigation: the fast lane reads the latest mind files, so it's always grounded in the most recent background thinking. The gap is small.

### Impression Queue Growth

If heartbeat interval is long and many conversations happen, impressions pile up. Mitigation: cap the queue size, drop oldest impressions. Or: let the slow lane summarize rather than process each one individually.

### Debugging Complexity

Two parallel execution paths are harder to trace. Mitigation: tag all log entries with `lane: 'fast' | 'slow'` so JSONL logs can be filtered.

## Open Questions

- Should the fast lane have its own `log_thought` entries that are tagged differently?
- Should impressions include the full conversation turn or just a summary?
- Should the fast lane be able to trigger an immediate slow lane tick (e.g., "this conversation changed my worldview — process now")?
- What's the right heartbeat interval once the fast lane handles responsiveness? Could be longer (e.g., 5 minutes) since chat doesn't depend on it anymore.
