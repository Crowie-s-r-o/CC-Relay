---
name: Memory Efficiency
description: Why CC Relay could reach multi-gigabyte RAM use and the contracts that keep task history bounded in memory.
type: architecture
---

# Memory Efficiency

## September 3, 2026 diagnosis

The installed v0.2.27 app had been running for about two and a half days when Activity Monitor showed CC Relay at 5.98 GB. The application process tree had matching high-water footprints: about 2.4 GB for the Electron main process, 2.4 GB for the renderer, 711 MB for the GPU helper, and 358 MB for the optional voice worker. At rest during diagnosis, the renderer was about 600 MB and the main process about 160 MB, which made the large reading an allocation spike rather than a constant baseline.

The local `relay.sqlite` was 1.84 GB with 490,680 event rows. About 1.74 GB belonged to the `events` table. Completed command events alone accounted for roughly 1.14 GB, with some individual event payloads larger than 1 MB. Exact provider events also exist in each task's append-only `events.jsonl` artifact, so keeping another unbounded display copy in SQLite multiplied both storage and read amplification.

Four paths combined into the spike:

1. Prompt, response, and project search extraction selected every event payload for a task or project and filtered it after `JSON.parse()`. Tool results and command output therefore entered the Node heap even though they could never be search matches.
2. `GET /api/tasks` returned full prompts, results, and errors for all historical cards.
3. SSE change bursts and a separate two-second poll both refreshed the same snapshot. The renderer replaced the complete card list and selected event DOM even when their content had not changed.
4. Historical cards created image elements for every visible attachment. Browser image decoding can consume much more RAM than the compressed files on disk.

## Bounded contracts

`RelayDatabase.listTaskSummaries()` is the list endpoint and status monitor source. Finished tasks carry at most 512 prompt characters and no completed result body. Errors remain available because the Relay queue CLI reports failed-task diagnostics from this endpoint. Active tasks keep their full fields because the global monitor needs current session state. `GET /api/tasks/:id` remains the full selected-task view.

Each summary carries `latest_event_id`, and selected detail carries `eventRevision`. The renderer compares that revision and a task metadata signature before requesting or rebuilding detail. It also signs the task-card inputs and leaves the existing card DOM intact when nothing visible changed. SSE remains the primary update channel; the visible-page full snapshot is now a 15-second recovery poll.

Conversation extraction filters canonical user and assistant event shapes in SQLite before payloads enter JavaScript. Tool events, command output, file changes, reasoning, and status noise are never materialized by prompt history or search.

Queue-card attachment images use an intersection observer. Only images near the viewport receive a `src`, and an image leaving that region releases it. Cards also use `content-visibility: auto` with an intrinsic size so offscreen card layout is skipped.

New provider activity rows use a bounded display copy:

- Command output keeps a 16,000-character head and tail with an explicit omission marker.
- A started file-change event drops its duplicate patch. The completed file-change event remains exact for the task diff viewer.
- Tool results bound oversized text, omit embedded data-URL media, and stop pathological object nesting.
- The original event object is not mutated. Normal provider paths append it to the task artifact before adding the compact SQLite row.

Historical activity windows are read with a SQLite iterator and compacted one row at a time. This avoids retaining up to 500 raw payload strings before parsing, and gives old databases the same bounded display behavior without rewriting their rows.

> [!important]
> Existing SQLite rows are not rewritten or deleted by this change. Historical evidence and task artifacts stay intact. The read paths are bounded immediately after restart, while the event-storage bounds prevent new activity from repeating the database growth pattern.

## Verification

`test/event-storage.test.mjs` covers immutable command compaction, exact completed patches, media omission, small limits, and nested provider values. `test/database.test.mjs` proves list summaries retain full selected detail and that `addEvent()` stores the bounded copy. `test/renderer-memory.test.mjs` covers the summary endpoint, revision gate, canonical SQL filtering, and slow fallback poll. `test/task-card-attachments.test.mjs` covers viewport-bound image loading and offscreen card containment.

The complete Node suite passes 1,812 tests, `release:check` passes for v0.2.30, JavaScript syntax checks pass, and `git diff --check` is clean.

See [[renderer-performance]], [[task-search]], [[task-history]], and [[diagnostics]].

#relay #memory #performance #renderer #sqlite
