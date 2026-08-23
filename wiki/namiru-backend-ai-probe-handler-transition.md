---
name: Namiru Backend AI Probe Handler Transition
description: Relay handoff context for the failed Namiru v1.1.0 production activation and the repository-side manifest repair.
type: incident
---

# Namiru backend AI probe handler transition

## Relay handoff outcome

A non-interactive Relay task received Patrik's manual Namiru production log after the rollout had already finished. The log showed a coordinated activation failure in `namiru-backend-ai`, followed by successful restoration of frontend, backend AI, and backend API to their captured revisions.

Relay did not start, resume, drive, or inspect the production rollout. Namiru's production contract remains human-only, so the task changed and tested only the deployment tooling in `/Users/patrikkelemen/WebstormProjects/namiru-ai`.

## Root cause and repair

The long-lived production backend AI Deployment retained legacy PM2 `exec` liveness and readiness probes. The candidate manifest selected HTTP probes. Client-side Kubernetes apply retained both handler types, and the API server rejected the candidate because a Probe may select only one handler.

The shared Namiru Deployment renderer now requires exactly one active handler for every present liveness, readiness, and startup probe. It emits explicit nulls for inactive handlers so strategic merge deletes stale union members during handler transitions. Regression coverage rejects both missing and conflicting handler definitions.

Namiru focused deployment safety passes 45 of 45, and its complete root contract suite passes 168 of 168. No production retry, registry mutation, or database access occurred during the repair. The complete evidence is in Namiru's `wiki/production-backend-ai-probe-handler-rollout-failure-2026-08-21.md`.
