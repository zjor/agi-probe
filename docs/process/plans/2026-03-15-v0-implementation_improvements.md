# Improvements Backlog: V0 Implementation

Generated from critique of: `docs/process/plans/2026-03-15-v0-implementation.md`
Date: 2026-03-15

## Critical Issues (Must Address Before Implementation)

- [ ] **Tick reentrancy guard** — Add a mutex/flag in the cognitive core that prevents concurrent ticks. Without this, any two events arriving within the API call latency window will corrupt state.
- [ ] **Cost hard limit** — Implement as a mandatory config value checked before every Claude API call. Auto-shutdown on breach. Not optional, not an "open question."
- [ ] **System prompt / tool use conflict** — The seed `system-prompt.md` defines a JSON response format that is incompatible with the tool-use paradigm in the implementation plan. Must rewrite the system prompt to instruct Claude to use tools instead of returning raw JSON. This is a blocking inconsistency.
- [ ] **Telegram user allowlist** — Filter incoming messages by user ID. Without this, any Telegram user is a prompt injection vector directly into the agent's cognition.
- [ ] **Tool call loop cap** — Add `MAX_TOOL_ITERATIONS` (suggest 5) to prevent a single tick from making unbounded API calls.

## High Priority Improvements

- [ ] **Mind file snapshots** — Before any write to `worldview.md`, `strategy.md`, or `state.md`, save the previous version to a history directory or git commit. This is the only defense against identity drift and self-injection.
- [ ] **Mind file validation** — After agent writes to a mind file, run basic sanity checks: file isn't empty, doesn't exceed size limit, doesn't contain known prompt injection patterns. Log anomalies.
- [ ] **API error handling** — Implement retry with exponential backoff for Claude API calls (429, 500, timeout). Max 3 retries per tick. Log failures. Don't crash the process on transient errors.
- [ ] **Structured error recovery** — If a tick fails mid-execution (after some tools ran but before completion), log the partial state and ensure the next tick starts clean.
- [ ] **Telegram rate limiting** — Even with an allowlist, rate-limit incoming messages (e.g., max 5/minute) to prevent accidental cost spikes from rapid messaging.
- [ ] **Daily rotation for raw.jsonl** — Currently only `thinking.jsonl` mentions daily rotation. `raw.jsonl` will grow much faster and needs the same treatment.

## Future Enhancements

- [ ] **Persistent event queue** — Replace in-memory queue with file-backed queue to survive restarts. Low priority for v0 since Grammy's getUpdates offset provides some durability.
- [ ] **Identity drift detection** — Automated comparison of agent's current worldview/strategy against soul.md invariants. Alert if core identity markers drift beyond a threshold.
- [ ] **Thought context window** — Load last N thinking log entries into the prompt so the agent has continuity beyond what's in `state.md`. Tunable parameter.
- [ ] **Log compression/cleanup** — Auto-delete or compress logs older than N days. Monitor disk usage.
- [ ] **Telegram message acknowledgment** — Send a brief "thinking..." reaction or typing indicator when a message is received, so the user knows the agent is processing.
- [ ] **Metrics dashboard** — Simple stats: ticks/day, cost/day, tool calls/tick, average response time, event distribution. Could be a daily summary in JSONL or a simple web page.
- [ ] **Agent-initiated questions** — The architecture mentions the agent asking humans questions. The current tool set has `send_telegram` but no mechanism for the agent to track pending questions and their answers.

## Technical Debt to Track

- [ ] **Mind files live in `seed/prompts/`** — These are "seed" files but will be actively modified by the agent. Consider moving the runtime copy to a separate `runtime/mind/` directory, keeping `seed/` as the pristine original for resets.
- [ ] **Language duality (ru/en)** — Seed prompts exist in both Russian and English. The implementation plan doesn't specify which set to use. Needs a decision — likely English for v0, with the Russian originals as reference.
- [ ] **No tests** — The plan has no mention of testing strategy. Not critical for an experimental v0, but at minimum the state manager (locking, atomic writes) and cost tracking should have unit tests.
- [ ] **Grammy polling vs webhooks** — Polling is fine for dev but has latency. Document the tradeoff and plan to switch to webhooks for any production-like deployment.

## Questions Requiring Clarification

- [ ] **Which mind files are writable?** — The plan has tools for `state`, `strategy`, `worldview`. Can the agent EVER modify `soul.md` or `ethics.md`? If not, this should be enforced in code, not just by omission of tools.
- [ ] **What language does the agent think in?** — Russian prompts vs English prompts. The API cost differs with language (token count). This affects the prompt assembler.
- [ ] **Who monitors the agent?** — Is there a human review cadence for mind file changes? The manifesto mentions "building in public" — does the Telegram channel get automated updates?
- [ ] **Restart behavior** — When the process restarts, does the agent know it was restarted? Should this be an event? Without it, the agent has no awareness of downtime.

## Alternative Approaches Considered

### Structured output instead of tool use
Claude's structured output (JSON mode) could replace tool use — the agent returns a JSON object with fields for each action. Simpler to implement, no tool-call loop risk. Rejected because: tool use gives Claude more flexibility to chain multiple actions per tick and is the documented best practice for agentic workflows.

### SQLite instead of file system
The architecture doc specifies SQLite. Would solve the locking problem and make queries possible. Rejected for v0 because: file-based state is human-readable, git-diffable, and matches the "mind as markdown files" philosophy. SQLite is appropriate for v1 when structured memory (episodic, semantic) is needed.

### Separate process for Telegram
Running the Telegram bot as a separate process communicating via IPC or a message queue. Would prevent Telegram issues from crashing the cognitive loop. Rejected for v0 because: over-engineering for a single-user dev setup. Worth revisiting if stability becomes an issue.
