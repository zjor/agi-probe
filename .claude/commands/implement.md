---
description: Perform the task, change, update that user is asking to do
allowed-tools: Task, Read, Grep, Glob, WebSearch, WebFetch, LS, Read, Bash, Write, Edit
allowed-commands:
  - "tsc --noEmit"
  - "pnpm tsc --noEmit"
  - "pnpm exec tsc"
  - "eslint"
  - "pnpm exec eslint"
  - "prettier"
  - "pnpm exec prettier"
  - "pnpm build"
  - "npm run build"
  - "pnpm --filter"
  - "pnpm add"
  - "pnpm install"
  - "npm install"
  - "npm add"
  - "cd "
---

# Task

## Input
**$ARGUMENTS**

## Pre-Stage: Parse Input
First, determine what type of input was provided:
- **If a file path**: Read the file to get the implementation plan/requirements
- **If a direct task description**: Use it as the requirements

## Implementation Stages

Follow these stages in order. Think deeply (ultrathink) before each stage.

**CRITICAL: Continue working until ALL stages are complete. Do not stop or summarize until the entire plan is fully implemented. If context compaction occurs, use the todo list to track what has been completed and what remains. If you must pause for any reason, explicitly ask permission first.**

### Stage 0: Branch Verification
Before any implementation work, verify the git branch is appropriate:

1. **Check current branch and working tree status:**
   ```bash
   git branch --show-current
   git status --short
   ```

2. **Evaluate branch appropriateness:**
   - Does the current branch name correlate with the task/plan being implemented?
   - If YES → proceed to Stage 1
   - If NO → ask the user:
     - Continue on the current branch?
     - Create a new branch for this work?

3. **If creating a new branch:**
   - First, check for uncommitted changes (from step 1)
   - If there are changes, ask the user:
     - Stash the changes before switching? (`git stash`)
     - Carry the changes to the new branch? (just checkout)
   - Ask which branch to create from (e.g., `main`, `develop`, etc.)
   - Create the new branch:
     ```bash
     git checkout <base-branch>
     git pull origin <base-branch>
     git checkout -b <new-branch-name>
     ```
   - If changes were stashed, ask if they should be restored: `git stash pop`

4. **Confirm branch is ready** before proceeding to implementation.

### Stage 1: Planning & Delegation
1. Analyze the task requirements thoroughly (from file or direct input)
2. Identify which parts can be delegated to sub-agents
3. Determine the scope: **frontend-only**, **backend-only**, or **full-stack**
4. Create a clear implementation plan with sub-tasks (if not already provided in a plan file)
5. Delegate research and exploratory tasks to sub-agents to preserve main agent context

### Stage 2: Implementation
1. Execute the implementation plan
2. For each sub-task, delegate to sub-agents when appropriate
3. Collect and integrate results from sub-agents

### Stage 3: Backend Validation (if backend changes were made)
Run appropriate validation commands based on your backend technology:
- Run linters/formatters
- Run unit tests if applicable
- Check for compilation errors

### Stage 4: Frontend Validation (if frontend changes were made)
Run appropriate validation commands:

**Type checking:**
```bash
pnpm tsc --noEmit
# or
npm run type-check
```

**Linting (if configured):**
```bash
pnpm exec eslint .
# or
npm run lint
```

**Build check:**
```bash
pnpm build
# or
npm run build
```

### Stage 5: Integration Testing (if full-stack changes)
When changes span both frontend and backend:
1. Test API endpoints to verify backend responses
2. Verify frontend can communicate with backend correctly
3. Test critical user flows end-to-end

**Example API test:**
```bash
curl -s "http://localhost:3000/api/endpoint" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer {token}" \
  --data '{"key":"value"}' | jq .
```

**Important:** Always use double quotes (`"`) for URLs and headers in curl commands, not single quotes.

### Stage 6: Summary
1. Report what was implemented
2. List any type errors or test failures that need attention
3. Note any follow-up tasks or considerations