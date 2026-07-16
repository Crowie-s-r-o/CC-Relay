---
name: Forward-Planning Turbo
description: Machine-readable planning and dependency-aware execution across multiple Codex terminals.
type: architecture
---

# Forward-Planning Turbo

Forward-planning turbo is a third queue workflow beside Execute and Plan council. It uses one selected Codex terminal exclusively as a read-only planner and one or more other live Codex terminals in the same workspace as execution workers. The default fleet is three workers, which means four connected terminals in total.

## Defaults

- Planner: GPT-5.6-Sol at high effort
- Workers: GPT-5.6-Luna at high effort
- Worker count: 3

The UI prefers models whose IDs contain `sol` and `luna`. If either model is unavailable, it falls back to the account default or first available model. Effort also falls back to a supported value.

## Plan contract

The planner returns JSON rather than Markdown. Relay validates this structure before any write-capable worker begins:

```json
{
  "version": 1,
  "summary": "Coordination summary",
  "sharedContext": "Contracts shared by every worker",
  "tasks": [
    {
      "id": "stable-task-id",
      "title": "Task title",
      "instructions": "Complete implementation scope",
      "dependsOn": ["another-task-id"],
      "ownedPaths": ["src/example.mjs"],
      "verification": ["npm test"]
    }
  ]
}
```

Validation rejects duplicate IDs, missing IDs, unknown dependencies, self-dependencies, cycles, incomplete tasks, and plans with fewer tasks than configured workers.

## Scheduler

Relay owns execution order. It maintains pending, active, and completed graph nodes. Any node whose `dependsOn` entries are complete may be assigned to a free worker terminal. When a worker finishes, Relay marks the node complete, unlocks dependents, and reuses that terminal for another ready node. Independent roots run concurrently up to the selected worker count.

The shared Codex bridge tracks active turns by terminal thread ID. This is required because the normal Relay queue still has one running parent task while turbo owns multiple concurrent child turns.

> [!important]
> Worker terminals must be distinct from the planner and must use the planner's exact workspace path. Workers share one working tree, so the planner must prefer disjoint file ownership and encode unavoidable ordering through dependencies.

## Persistence and visibility

Turbo configuration is stored in the task's `turbo_json` database column. Runtime graph state is stored under the task artifact directory as `turbo-plan.json`. The task API returns this as `turboPlan`, and the task inspector renders graph nodes, dependencies, worker assignments, and current status.

## Files

- `src/turbo-runner.mjs`
- `src/codex-app-server.mjs`
- `src/database.mjs`
- `src/relay-runner.mjs`
- `src/server.mjs`
- `src/artifacts.mjs`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/turbo-runner.test.mjs`

#relay #turbo #codex #parallel #dag #scheduler
