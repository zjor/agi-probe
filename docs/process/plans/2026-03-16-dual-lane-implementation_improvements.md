# Improvements Backlog: Dual-Lane Architecture

Generated from critique of: `docs/process/plans/2026-03-16-dual-lane-implementation.md`
Date: 2026-03-16

## Critical Issues (Must Address Before Implementation)

- [ ] **Per-channel write serialization in ConversationManager.** Two concurrent fast lane calls for the same channel will corrupt conversation history. Add a per-channel async lock (promise chain) so writes serialize per-channel but different channels proceed in parallel. This must land before Phase 2.
- [ ] **Cost budget overshoot protection.** The check-then-spend pattern across an `await` boundary allows N concurrent calls to all pass the budget check. Add a `reserveCost()` / `settleCost()` pattern to the CostTracker that optimistically deducts before the API call.
- [ ] **Fast lane error handling.** Wrap the agentic loop in try/catch. On API failure, send a fallback Telegram message so the user isn't left hanging. Log the error. Do not retry automatically.

## High Priority Improvements

- [ ] **Impression quality.** The mechanical summary format loses too much nuance for the slow lane to reason about. Store truncated raw user/agent text (200/300 chars) instead of a generated summary string. Use the `summary` field for a short label only.
- [ ] **Impression queue cap.** Add a configurable max size (default 50). Drop oldest when full. Log dropped impressions.
- [ ] **Fast lane per-channel concurrency limit.** Even with serialized file writes, two fast lane calls for the same user/channel can produce confusing out-of-order responses. Consider serializing fast lane calls per-channel (queue the second call until the first completes) or at minimum deduplicating rapid-fire messages.
- [ ] **Graceful budget exhaustion.** Current code calls `process.exit(1)` when budget is exceeded. The new design should: (a) send a "budget exhausted" message via Telegram, (b) disable both lanes, (c) keep the process alive so it can be restarted with a higher limit without losing conversation state.

## Future Enhancements

- [ ] **Persist cumulative cost to disk.** Write cost to a file every slow lane tick. Read on startup. Prevents budget reset on crash/restart.
- [ ] **Fast lane model selection.** Use a cheaper/faster model (e.g., Haiku) for the fast lane to reduce cost and latency. The slow lane keeps the more capable model for deep thinking. Make this configurable.
- [ ] **Impression summarization by slow lane.** Instead of the fast lane generating summaries, let the slow lane receive raw impressions and generate its own summaries as part of its thinking process. This removes the "summary quality" problem entirely.
- [ ] **Typing indicator.** Send a "typing..." action to Telegram when the fast lane starts processing, so the user knows the agent is working.
- [ ] **Fast lane timeout.** Add a configurable timeout (e.g., 30s) for the entire fast lane processing. If exceeded, send a "still thinking..." message or cancel.
- [ ] **Slow lane trigger on high-importance impressions.** While the plan says "no forced slow-lane ticks," consider an escape hatch: if an impression is flagged as high-importance (e.g., user explicitly asks the agent to change its strategy), trigger an immediate slow lane cycle.

## Technical Debt to Track

- [ ] **`executeTool()` shared between lanes without access control.** The fast lane restricts tools via prompt-level tool definitions, but `executeTool()` itself will happily execute `update_state` if called. If Claude hallucinates a tool call not in the prompt, the fast lane could accidentally write mind files. Add a runtime allowlist check in the fast lane's tool execution path.
- [ ] **Logger `getRecentThoughts()` has no protection against partial JSONL reads.** Verify there's a try/catch around `JSON.parse` per line. Add one if missing.
- [ ] **No integration/unit tests.** The plan relies entirely on manual smoke tests. After the architecture stabilizes, add at least: (a) a unit test for CostTracker reserve/settle, (b) a unit test for ImpressionQueue cap behavior, (c) a unit test for ConversationManager serialization under concurrent access.
- [ ] **Hardcoded Claude Sonnet pricing in cost tracker.** If the model changes (fast lane on Haiku, slow lane on Sonnet), the pricing math needs to accept model-specific rates. Parameterize the pricing.

## Questions Requiring Clarification

- [ ] **Should the fast lane support multi-turn tool loops?** The current plan says "agentic loop until end_turn or max iterations." But for a responsive chat lane, do we really want the agent making 10 sequential tool calls? Consider limiting the fast lane to 3 iterations max — if it hasn't replied by then, something is wrong.
- [ ] **What happens to `send_telegram` in the slow lane?** The slow lane has all 6 tools including `send_telegram`. Can the background thinking process spontaneously message users? If so, this could be confusing (user receives a message out of nowhere). Consider removing `send_telegram` from the slow lane, or restricting it to a "broadcast" channel.
- [ ] **How should the fast lane handle messages from unknown/new channels?** The current system has `ALLOWED_TELEGRAM_USERS`. Does the fast lane inherit this check, or does it need its own?
- [ ] **Should impressions include the channel's conversation history length?** The slow lane might benefit from knowing "this was message 3 in a long conversation" vs. "this was a cold open."

## Alternative Approaches Considered

### Single-lane with priority queue (rejected)
Keep the single-threaded model but prioritize chat messages over heartbeat events. Rejected because: it still blocks on in-progress API calls (5-30s). The fundamental problem is latency, not ordering.

### Worker threads for fast lane (rejected)
Use Node.js `worker_threads` for true parallelism. Rejected because: adds complexity for shared state (mind files, cost tracker), and the single-threaded event loop is sufficient since the bottleneck is I/O (API calls), not CPU.

### Separate process for fast lane (rejected)
Run fast lane as a separate Node.js process communicating via IPC. Rejected because: massive increase in operational complexity for a single-developer project. Shared state becomes a distributed systems problem. Not worth it at this scale.
