---
name: CC Relay Landing Page Build Prompt
description: Product-grounded command for a scroll-driven marketing page with workspace assembly and task-session continuity.
type: design
tags:
  - relay
  - marketing
  - design
  - documentation
---

# CC Relay Landing Page Build Prompt

The September 5, 2026 request asked for an extensive command to create a landing page, positioning
CC Relay as the IDE of the future with advanced parallax, scroll-controlled assembly and rotation,
parallel projects, individual task sessions, completion review, Plan council, Standup, quick view,
and usage monitoring.

The deliverable is [[../docs/relay-landing-page-prompt|the ready-to-paste landing-page build command]].
This task writes the command and its context; the landing page itself is a subsequent build.

## Product wording decisions

- Keep **CC Relay** as the full name under [[product-naming]]. "IDE of the future" is the requested
  positioning, supported by an explicit description of the actual AI orchestration workspace.
- New direct Codex and Claude tasks start fresh conversations in automatically managed terminals.
  OpenCode is headless, and interactive continuation is not presented as an OpenCode feature.
  See [[disposable-terminal-pools]] and [[opencode-provider-and-token-throughput]].
- Closing the native terminal does not delete the task record. Supported continuation restores the
  saved provider conversation in a new terminal under the same task ID. Fresh work and explicit
  continuation have different context behavior. See [[same-task-session-continuation]].
- Describe reduced unrelated context carryover, without guaranteed token savings. Usage consumption,
  output speed, and provider allowance are distinct. See [[daily-token-usage]],
  [[token-throughput-correction]], and [[provider-usage-monitor]].
- The global task monitor covers running tasks and open manual sessions across projects. Queue and
  History remain project-scoped, per [[parallel-project-queues]] and [[interface-layout]].
- Ready for review indicates an unread completion, not approval or independent verification.
  Opening a result acknowledges it, per [[launchpad-completion-notifications]].
- Standup is a project-scoped, dated changelog from successful execution attempts. Use the current
  Added, Changed, Fixed, and Security contract in [[daily-standup]], not retired Tasks and Blockers.
- Plan council authors, reviews, and revises before a separate execution handoff. Either supported
  provider can go first. See [[plan-council]].

## Visual direction

Use the product itself as the visual material: project tabs, task cards, terminal planes, and
review indicators assemble into the familiar Launchpad, composer, queue, and Task Activity layout.
The command specifies only two extended sticky scenes, with explicit scroll checkpoints: workspace
assembly and a single task's fresh-session, completion, terminal-close, and continuation lifecycle.
Other chapters use shorter, unpinned transitions.

The proposed landing page pairs a cool light ground with the existing graphite brand surface,
Instrument Sans, and JetBrains Mono. It reuses the Crowie SVG and the product's semantic state and
provider colors. See [[brand-startup-and-about]] and [[interface-layout]].

> [!important]
> `docs/assets/cc-relay-overview.png` is a historical structural reference containing real task
> content. Use synthetic project and task fixtures for the landing-page demonstration and verify
> current behavior against the living wiki before reproducing an old screenshot.

> [!note]
> The build command keeps website demonstrations local and synthetic, isolates a future marketing
> implementation from the desktop renderer, and introduces no environment variables. Phone and
> reduced-motion versions replace long pinned scenes with complete, readable document flow.

## Sources and scope

Product research used `README.md`, `CLAUDE.md`, the wiki index and current notes, and the feature
contracts linked above. The existing product image was inspected. Current GSAP ScrollTrigger
documentation confirms that the suggested library supports scrubbed timelines and pinning; the
command links directly to that official reference. The release destination comes from `README.md`.

Files created: `docs/relay-landing-page-prompt.md` and this wiki page. The wiki index gains a link
without replacing existing entries. No application behavior or release metadata changes are part
of this task.

## Verification

The subsequent pricing request is incorporated into section 11 and the navigation, FAQ, and
verification instructions. [[pricing]] records the 30-day trial, USD assumption, $7.99 monthly,
$79.99 yearly, and $159.98 lifetime offer with automatic updates forever. Reusable copy lives in
[[../docs/pricing]]. The brief requires planned-pricing disclosure until real activation and
checkout flows exist.

- The full repository suite passed through `npm test -- --test-reporter=dot`.
- `npm run release:check` reported consistent v0.2.35 metadata.
- Repository, latest release, README, and license destinations all returned HTTP 200; the latest
  release destination resolved to v0.2.35 during this check.
- The new page's local wikilinks resolve, its index entry is unique, and the documents contain no
  em dash characters or trailing whitespace.
- The extra content review corrected ambiguous scroll-distance wording to `340svh` and `240svh`,
  representing 3.4 and 2.4 viewport heights. It also aligned the opening task and terminal counts
  and added explicit documentation and license destinations.
- The artifact is a build command. Browser rendering and animation performance become verification
  requirements for the subsequent website implementation, not completed checks in this task.

#relay #marketing #design #documentation
