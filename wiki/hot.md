---
name: Current CC Relay Notes
description: High-signal context for the next development session.
type: hot
---

# Current CC Relay Notes

> [!note]
> **August 27: repeated Claude working heartbeats now occupy one Task Activity row.** Consecutive
> `claude/progress` records fold only when their message and complete payload match, update a compact
> `×N` badge and latest occurrence time, and split again at any real event or changed status. Raw
> database and artifact evidence remains intact. All 1,752 repository tests pass, `release:check`
> is green for v0.2.26, and `git diff --check` is clean. See
> [[claude-terminal-live-output]] and [[task-activity-overview]].

> [!important]
> **August 27: push-to-talk now proves the selected source has a live signal before blaming speech
> recognition.** Settings actively reveals named inputs even when initial device enumeration is empty,
> releases the permission probe, and persists the chosen microphone by label. A four-bar meter shows
> live input while held, and digital silence is rejected immediately with the exact source named. The
> local faster-whisper worker transcribed generated speech down to 0.6 percent volume while true silence
> stayed empty, confirming the repeated failure was capture-source silence. The automatic-terminal
> fieldset is now 57px high, with 26px session-mode and Settings controls, and the settings dialog is
> denser and responsive. All 78 focused checks and all 1,749 repository tests pass. See
> [[push-to-talk-voice-input]], [[project-terminal-settings]], and
> [[compact-interface-density]].

> [!important]
> **August 27: follow-ups now have an explicit token-accounting boundary.** Reusing a task and event
> rail could leave the preceding turn's cached input and output visible until the first new provider
> snapshot. Manual terminal sessions also measured output rate against the complete workspace age
> because their lifecycle start is intentionally preserved. Every run now records and stamps its
> exact attempt start, and both Task Activity and the global monitor reset to that boundary. The 90
> focused checks and all 1,747 repository tests pass. See [[token-throughput-correction]] and
> [[same-task-session-continuation]].

> [!important]
> **August 26: selected Task Activity text now has a native desktop Copy menu.** Terminal
> scrollback explicitly permits text selection while signal numbers remain excluded, and Electron
> opens **Copy** for selected read-only text instead of presenting no right-click action. Editable
> controls receive only their currently available native editing roles, and unselected application
> surfaces stay menu-free. A real-browser fixture held a 273-character terminal response selection
> through polling and copied it byte for byte; a fresh second pass had zero browser warnings or
> errors. The 27 focused checks and all 1,744 repository tests pass, and `release:check` is green for
> v0.2.26. See [[stable-text-selection]] and [[task-references]].

> [!important]
> **August 26: the global task monitor always keeps project identity visible, and closing a
> Terminal session now completes its task.** The project name leads the compact card's prompt row
> with protected space, so a bottom monitor card cannot lose it to terminal state, token speed, or
> duration metadata. **Complete session** still finishes a task without closing its retained
> terminal. Closing that terminal through Relay finishes both immediately. External terminal loss
> requires two distinct authoritative provider-discovery misses; duplicate or stale polls cannot
> create a false completion, and rediscovery resets the pending miss. See
> [[manual-terminal-session-mode]], [[session-tasks]], [[interface-layout]], and
> [[compact-interface-density]]. An isolated bottom-monitor pass covered default and compact cards
> at desktop and 600px widths with no overflow or console warnings, and all 1,734 tests pass.

> [!important]
> **August 26: push-to-talk now identifies and selects the real microphone source.** Live failures
> proved that the only macOS input was an unfed `Microsoft Teams Audio` virtual device: three normal
> duration clips were just 436 through 968 bytes of digital silence, so no Whisper setting could
> recover speech. Terminal settings now lists the system default and named inputs, persists a named
> choice by label across Electron origin changes, and switches after permission reveals hidden
> devices. An empty low-bitrate Opus clip names the source and asks for a working microphone instead
> of repeating the generic no-speech message. See [[push-to-talk-voice-input]] and
> [[durable-ui-layout-preferences]].

> [!important]
> **August 26: OpenCode reasoning is now visible through the Thinking switch.** OpenCode 1.18.23
> suppresses reasoning records by default in non-interactive mode, even though the durable session
> export can contain them. Relay now launches JSON runs with `--thinking`, converts native reasoning
> parts into the existing escaped and filterable Task Activity rows, and recovers them during bounded
> export reconciliation. Reasoning text stays independent from the numeric provider usage field, so
> a provider-reported zero remains zero instead of becoming an estimate. See
> [[opencode-provider-and-token-throughput]], [[opencode-thinking-visibility-review]], and
> [[interface-layout]].

> [!important]
> **August 25: inflated token speed now uses current-attempt output accounting.** Real Codex tasks
> proved that `thread/tokenUsage/updated.last` is one response, not a cumulative task total, and
> that input plus output over wall time is not generation speed. Relay now subtracts a fixed
> pre-attempt baseline from the thread total, displays exact input and output counts in Task
> Activity, and calculates the compact rate from cumulative output tokens only. See
> [[token-throughput-correction]] and [[opencode-provider-and-token-throughput]].

> [!note]
> **August 25: Task Activity can now show or hide thinking summaries independently.** The compact
> **Thinking** switch starts on, removes only provider-exposed reasoning summary rows when off,
> and keeps All counts, visible-versus-total status, empty state, and Copy log aligned with the
> rendered signals. The choice follows task selections during the renderer session and resets to
> visible on a fresh load. Private hidden chain-of-thought remains unavailable. See
> [[interface-layout]].

> [!important]
> **August 25: the task composer now supports local CPU push-to-talk dictation.** Enable voice
> input in Terminal settings, perform the explicit faster-whisper setup, then hold the configurable
> activation keys and release any one of them to stop recording. Relay inserts the multilingual
> base-model transcript at the current prompt selection, deletes the transient clip, and retains
> only app-wide preferences. Quiet clips rejected by VAD now receive one recovery decode, and a
> refreshed app updates the external worker helper without reinstalling its runtime. The settings
> expose primary and alternate shortcut buttons with individual keycaps. The primary default is
> `Ctrl+Shift+Space`, and both shortcuts work while the Relay window is active. See
> [[push-to-talk-voice-input]] and
> [[durable-ui-layout-preferences]].

> [!important]
> **August 25: OpenCode is now a third direct Execute provider with live token speed.**
> The automatic composer places OpenCode beside Codex and Claude, discovers its configured model
> catalog, gives it an independent project capacity, and runs it headlessly with a durable native
> session for retry. Task Activity and the running-task monitor calculate native cumulative tokens
> per elapsed second throughout supported provider runs. OpenCode reads direct step statistics and
> uses a bounded native session export only when its final JSON stream is incomplete. See
> [[opencode-provider-and-token-throughput]] and [[opencode-token-throughput-review]].

> [!note]
> **August 25: Task Activity can show the complete conversation without operational noise.**
> The new **Conversation** filter keeps My messages and AI messages together in their original
> signal order, with a live combined count, filtered copy output, and a dedicated empty state.
> It uses the same strict role boundary as the individual views, so commands, provider lifecycle
> notices, input requests, and plan records remain excluded. See
> [[terminal-conversation-filters]] and [[interface-layout]].

> [!important]
> **August 21: the failed Namiru backend AI production activation has a repository-side repair.**
> The long-lived Deployment retained legacy PM2 `exec` probes while the candidate selected HTTP
> probes, so Kubernetes rejected the merged object for having two handlers. Namiru's shared
> renderer now requires exactly one handler and emits explicit deletion markers for inactive
> union members. The supplied rollout log reports successful coordinated restoration of frontend,
> backend AI, and backend API. Relay did not run, resume, or inspect production. See
> [[namiru-backend-ai-probe-handler-transition]].

> [!important]
> **August 21: expanded Claude agent rosters no longer block live follow-ups.** Task 1003's
> Claude 2.1.238 screen placed four timed worker rows below `/rc` and `main`, pushing the real empty
> composer beyond Relay's six-line ordinary chrome bound. Relay keeps that safety bound and adds a
> separate capped allowance only for the exact agent-panel shape. Unrelated or oversized tails
> still fail closed, all 1,653 tests pass, and the same live viewport now reads as an empty
> composer. Restart the packaged app after active terminals drain. See
> [[claude-expanded-agent-panel-composer]].

> [!note]
> **August 21: desktop update details now include the release brief.** The dialog replaces
> its five-minute polling disclosure with bounded Added, Changed, Fixed, and Security facts
> from the official GitHub release. Automatic updater HTML and portable-discovery Markdown
> are reduced to plain text before crossing the status API, then rendered with text nodes.
> The full release remains one click away, and the card scrolls safely on compact viewports.
> See [[desktop-updates]].

> [!note]
> **August 21: Task Activity can now isolate either side of the conversation.** The terminal
> filter rail shows live counts for All, Highlights, Commands, My messages, and AI messages.
> The user view includes the canonical original request even when Claude never echoed it, and
> strips Relay's appended non-interactive notice from display without changing stored events.
> The AI view accepts only real Codex or Claude response messages, so session heartbeats,
> input requests, and background notices stay out. Speaker-labelled rows keep original signal
> numbers, filtered copy uses canonical text, and narrow rails scroll without moving Copy log.
> See [[terminal-conversation-filters]] and [[terminal-markdown]].

> [!important]
> **August 20: new Claude workspaces no longer strand queued tasks at the folder trust prompt.**
> Claude does not register the interactive session while that first-use dialog is open, so task
> execution could time out before the executor had a session to control. Relay now recognizes only
> the exact legacy or current trust screen on its fresh owned Terminal.app tab, compares the whole
> screen again before choosing option 1, latches the action so it cannot repeat, and gives Claude a
> fresh binding window afterward. Unknown or changed screens receive no key. The executor shares
> the same strict classifier for later prompts and can re-arm one swallowed paste. Restart Relay to
> activate the fix. See [[claude-folder-trust-startup]] and [[claude-resume-picker-guard]].

> [!important]
> **August 20: an accepted desktop update now follows the newest release that becomes ready before
> exit.** A long-running v0.2.16 process staged v0.2.17, then missed v0.2.18 because both the
> downloaded state and a pending restart paused every five-minute check. Relay now keeps checking
> after either installation choice, including while owned terminals delay shutdown, skips the same
> or an older offer, and silently replaces the staged target when a higher release downloads. One
> install intent carries forward, so the higher release does not open another native prompt. A
> final check and download barrier runs immediately before the native handoff, and a failed refresh
> keeps the prior ready release. Relay owns the automatic `downloadUpdate()` decision while native
> install-on-quit stays enabled. See [[desktop-updates]] and
> [[desktop-update-supersession-review]].

> [!note]
> **August 19: the restored Codex five-hour allowance is visible in the provider runway.** Relay
> reads the exact 300-minute window from the authenticated general Codex rate-limit bucket and
> keeps it independent from the 10,080-minute weekly value and model-specific buckets. The header
> now shows **Cod 5h** beside **Cod Week**, with percentage-used coloring, an hours-and-minutes reset
> countdown, stale preservation, and an honest unavailable state when that window is absent. See
> [[provider-usage-monitor]] and [[interface-layout]].

> [!note]
> **August 19: Task Activity now shows three rows of the task definition before overflow.** The
> compact inspector recognizes the persisted 80-character generated title and substitutes the
> complete saved prompt while preserving genuine custom titles. It gives that definition the
> available width, wraps long tokens safely, and clamps only after the third visible row while
> retaining the full hover title. See
> [[task-detail-modal-and-app-zoom]] and [[interface-layout]].

> [!note]
> **August 19: tasks can now be starred and renamed inline at any stage.** A persistent star
> creates a stable top group in Queue, History, search, and the active-task monitor without
> changing scheduler position or dispatch priority. The pencil edits queued, running, open, and
> finished task titles in place while preserving live-refresh focus, identity, prompt,
> conversation, outcomes, and artifacts. Planner breakdown names remain linked to plan steps,
> and queued reorder gestures stay inside their current star group. See [[task-starring]] and
> [[task-naming]].

> [!important]
> **August 19: desktop releases now become visible atomically.** v0.2.17 exposed
> `latest-mac.yml` about 40 seconds before its 119 MB ZIP finished uploading, so v0.2.16 checked
> inside the gap, received HTTP 404, and showed **Relay will try again**. Its normal five-minute
> retry downloaded successfully and reached ready state. Future workflows keep Windows output and
> release notes in a draft; local deploy verifies every signed macOS payload as fully uploaded,
> adds the feed and completion marker last, then publishes the complete release. Workflow reruns
> leave an already complete published tag untouched. See [[desktop-updates]] and
> [[open-source-releases]].

> [!note]
> **August 19: each Launchpad can now save default Standup guidance.** The Standup modal stores an
> optional 4,000-character custom prompt on the exact shared project row and saves a dirty edit
> before date-triggered generation. The generation endpoint reloads that prompt server-side, then
> applies it as subordinate guidance without weakening the categorized JSON, evidence, or security
> contract. Existing project tables migrate to an empty default, older backends simply hide the
> guarded editor, and focused persistence, migration, generator, and UI checks pass. See
> [[daily-standup]] and [[shared-project-configuration]].

> [!important]
> **August 19: Changes now separates exact task edits from the shared workspace window.** A current
> backend opens the dialog on successful provider-reported patches, keeps repeated edits to one
> file as numbered operations, and exposes the old baseline-to-end snapshot under **Workspace
> window** for shell, external-tool, operator, and overlapping-task writes. Historical Codex
> file-change events already contain exact patches; future Claude Edit, Write, and NotebookEdit
> completions now retain bounded structured patches, while older path-only Claude events degrade
> honestly. The additive `taskExactDiff` capability keeps refreshed assets on Workspace window
> against an older backend. See [[task-diff-preview]] and [[task-activity-overview]].

> [!note]
> **August 18: Clear images now wins over pending follow-up image reads.** Follow-up additions are
> serialized per task, and clearing, dispatching, or restoring an authoritative retry invalidates
> older reads before they can commit. A read that finishes after task navigation can update only
> its originating task and cannot repaint the selected task's dock. Focused continuation checks
> cover clear-during-read, consecutive additions, and task-switch ownership. See [[task-history]]
> and [[same-task-session-continuation]].

> [!note]
> **August 18: earlier task conversations can now be attached to new work.** Right-click a task card and choose My messages, AI responses, or Both. The composer holds project-local task tickets with editable scopes, then freezes their canonical prompt and response history into a quoted, self-contained context section for Execute, Plan council, or Turbo. Keyboard context-menu access, active-project revalidation, failed-submit retention, successful-clear ordering, and a 90,000-byte composed-prompt guard protect the workflow. See [[task-references]].

> [!note]
> **August 18: Daily Standup now attributes completed work to when each task started.** Both the
> renderer preselection and the server-authoritative filter use persisted `started_at`, with
> `created_at` only for legacy completed rows that have no valid start timestamp. `finished_at`
> never selects the Standup day, so a task that crosses midnight stays on its start date and a task
> that began earlier does not move to its completion date. The additive `aiStandupStartDate`
> capability prevents refreshed renderer assets from mixing this rule with an older backend. The
> 23 focused Standup checks and all 1,582 repository tests pass, and `release:check` is green for
> v0.2.15. See [[daily-standup]] and [[task-history]].

> [!important]
> **August 18: automatic tasks now require one extra verification pass before completion.** Task
> 806 ended normally after 30 minutes and 27 seconds; its `70/70 signals` label was a visible and
> total activity count, not an execution quota. Relay still adds no artificial Codex wall-clock
> ceiling. Instead, every provider-delivered prompt requires one more verification pass, with any
> discovered issue fixed before finishing. For implementation work, that pass revisits the
> requested outcome, relevant tests, regressions, and documentation. The instruction stays on one
> logical line so guarded Claude live-follow-up delivery keeps its established three-line paste
> shape. The focused provider set passes 327 tests, all 1,577 repository tests pass, and
> `release:check` is green for v0.2.14. See [[non-interactive-relay-prompts]].

> [!note]
> **August 17: the startup square now includes the Crowie logo in its visual center.** The splash
> reuses the bundled `public/favicon.svg` in a 64 by 64 box between **Starting** and the company
> credit, with the established dark-surface filter making the near-black bird white. The 320 by 320
> window, static pre-server lifecycle, graphite background, typography, and clean main-window
> handoff are unchanged. An exact Electron 43.4 capture confirmed centered placement with no
> overflow. The 10 focused brand checks and all 1,574 repository tests pass, `release:check` is green
> for v0.2.14, and `git diff --check` is clean. See [[brand-startup-and-about]].

> [!important]
> **August 18: macOS update publication now preserves the installed signature lineage.** The live v0.2.13 to v0.2.14 incident proved both **Restart and install** and **Install on quit** reached Squirrel.Mac, but its unsigned public v0.2.14 ZIP made both reopen v0.2.13. Hosted Actions no longer publishes macOS output. `npm run deploy` requires the exact local Apple Development identity, verifies the build app and the app extracted from the updater ZIP, validates the DMG and feed, waits for the Windows workflow, then uploads the signed macOS set plus `mac-release.json`. From v0.2.15 onward, a release without that marker remains pending and recovery rebuilds its tag in an isolated worktree. Updater internals now persist under `desktop.updater.log`, while known interruptions still appear as **Retrying vX.Y.Z**. See [[desktop-updates]] and [[open-source-releases]].

> [!note]
> **August 17 historical note, superseded August 20: Install on quit first became a one-time choice for each downloaded version.** The updater coordinator remembered the exact version after that button was selected, so a duplicate `update-downloaded` event kept the release ready without reopening the native prompt. A genuinely different downloaded version could still ask. The August 20 correction above replaces that version-scoped acknowledgement with one deferred-install intent that silently follows a higher release during the same process. See [[desktop-updates]].

> [!important]
> **August 17: an active Codex goal now stays one running Relay task across automatic turns.** Task 781 proved that app-server completed one turn, then started its goal successor only 67 milliseconds later while the terminal still showed **Pursuing goal**. Relay had treated that provider-turn boundary as the whole run, released its subscription, changed the manual session to `open`, and disabled messages as **Conversation busy**. The app-server runner now loads persisted goal state, keeps the task and subscription live, adopts the exact successor, reconciles missed notifications through explicit thread state, and lets a message submitted during the handoff steer that successor. Ambiguous reads never finish work, stale completions cannot close the new turn, cancellation cannot become success, and final output cannot leak from the prior turn. Task Activity now says **Turn finished**, not **Session finished**. The dedicated app-server suite passes 52 tests and all 1,572 repository tests pass; `release:check` is green for v0.2.13 and `git diff --check` is clean. Rebuild and restart the desktop bundle after active terminal work finishes. See [[provider-plan-and-goal-visibility]], [[manual-terminal-session-mode]], and [[codex-goal-continuation-review]].

> [!important]
> **August 17: Terminal session mode workspaces now remain in the global Task monitor between turns.** A manual session that finishes a turn changes from `running` to `open` without leaving the top or bottom rail, and disappears only after **Complete session**. Its compact metadata chip says **Session running**, **Terminal idle**, **Terminal busy**, **Terminal closed**, or **Session idle**, with light and dark color treatments reinforcing the text. The backend keeps legacy `runningTasks` running-only for older renderers and exposes an additive `monitoredTasks` feed; a current renderer paired with an older backend reconstructs exact open manual sessions from the task snapshot and deduplicates them. The empty rail now says **No active tasks or sessions**. The 100 focused checks and all 1,561 repository tests pass, `release:check` is green for v0.2.13, and `git diff --check` is clean. A temporary isolated backend was stopped and trashed after the browser runtime reported no controllable browser, so no live screenshot was available. See [[manual-terminal-session-mode]], [[interface-layout]], and [[compact-interface-density]].

> [!important]
> **August 17: provider runway now rejects mixed Claude `/usage` frames and treats a missing Fable-specific window honestly.** A live Claude 2.1.233 monitor session moved its five-hour value backward from `22%` to `21%`, then forward to `23%`, while an older `34%` Fable row appeared and disappeared. Relay had been selecting each row independently across persisted and refreshed terminal paints. It now waits for the live repaint, parses only the final complete frame, accepts current Fable label variants, marks Claude's own last-known response stale, and samples every 30 seconds. When Claude omits a separate Fable allowance, the Fable meter shows the shared Claude-week percentage and explains the fallback instead of displaying `--` as model unavailability. A live source probe returned `25%` five-hour, `48%` Claude week, and shared `48%` Fable. The 19 focused checks and all 1,556 repository tests pass, `release:check` is green for v0.2.13, and `git diff --check` is clean. See [[provider-usage-monitor]] and [[interface-layout]].

> [!note]
> **August 17: the macOS desktop title bar is more compact.** Its renderer row is now `32px` high
> with a centered `20px` Crowie mark, returning four vertical pixels to the workspace while keeping
> the native traffic-light area comfortable. The desktop title-bar contract protects both values.
> See [[compact-interface-density]], [[interface-layout]], and [[packaged-renderer-startup]].

> [!note]
> **August 14: provider runway now resamples once per minute and handles a five-hour rollover honestly.** The previous five-minute cache could retain `98%` after Claude had reset to `1%`, while the expired time-only reset label rolled into tomorrow and displayed `23h 58m`. A five-hour reset now advances overnight only when the resulting timestamp is within five hours; an expired cached label clamps at `0h 0m` until the next sample. Focused usage checks pass 58 of 58, the complete suite passes 1,553 tests, `release:check` is green for v0.2.12, and `git diff --check` is clean. See [[provider-usage-monitor]].

> [!note]
> **August 14: desktop startup is now one minimal square.** The frameless splash is 320 by 320 and
> contains `CC Relay`, `Starting`, and the restrained two-line attribution `Created by software
> development company Crowie s.r.o.` on the existing graphite surface. The Crowie artwork, tagline,
> extra typeface, rounded treatment, progress UI, and motion are absent. The pre-server visibility
> and clean handoff to the main window are unchanged. An isolated exact Electron render confirmed
> the final spacing, readable attribution contrast, and hairline edge. The 32 focused desktop checks
> and all 1,551 repository tests pass, and `release:check` is green for v0.2.12. See
> [[brand-startup-and-about]] and [[packaged-renderer-startup]].

> [!important]
> **August 14: the macOS Crowie title bar is now gated by the shell that created it.** The Electron main process pairs `hiddenInset` with a versioned renderer URL marker, and the early renderer bootstrap requires that marker as well as Electron and Macintosh identity. Refreshing newer static files inside an older native-title window can no longer create a second 36px title bar. Task 752's screenshot came from the installed v0.2.10 bundle while source was already v0.2.12, so a rebuild and relaunch remain necessary to replace the visible native `CC Relay` title with the centered mark. An isolated Electron 43.4 capture showed native traffic lights and the Crowie mark in one bar with no visible product title. The 39 focused checks and all 1,551 repository tests pass, `release:check` is green for v0.2.12, and `git diff --check` is clean. See [[brand-startup-and-about]] and [[packaged-renderer-startup]].

> [!note]
> **August 14: the far-right header cog now owns every display control.** Monitor rows and card width, Top or Bottom placement, theme, Zoom out, the current zoom percentage, and Zoom in share one compact popover after the provider runway. Cog zoom uses the same bounded 50 through 200 percent native `webContents` scale as shortcuts, and desktop state keeps the percentage synchronized across buttons, menu actions, and keyboard input. Standalone browser mode hides the native-only zoom row. An isolated real Electron run moved the visible level from `100%` to `90%` and back with no overflow and the cog still open. Focused checks pass 48 of 48, the complete suite passes 1,551 tests, `release:check` is green for v0.2.12, and `git diff --check` is clean. See [[task-detail-modal-and-app-zoom]], [[interface-layout]], [[compact-interface-density]], [[header-position]], and [[dark-mode]].

> [!important]
> **August 14: signed macOS and installed Windows builds now use the GitHub repository as an automatic update feed.** Updater-capable builds download a discovered release in the background, offer **Restart and install**, and otherwise install it on normal quit after Relay's graceful terminal and server shutdown. The macOS release includes the desktop ZIP, ZIP blockmap, and `latest-mac.yml` beside the initial DMG; Windows portable remains manual. A real local v0.2.11 arm64 build produced a ZIP-selected feed, passed ZIP integrity and strict deep signature checks, and used the expected GitHub provider. The focused update and packaging set passes 48 tests, the complete suite passes 1,543 tests, `release:check` is green, and `git diff --check` is clean. Public v0.2.11 has no updater ZIP, so one final DMG install is unavoidable. The August 18 handoff now keeps unsigned hosted macOS artifacts out of releases and publishes the verified local continuity build. See [[desktop-updates]], [[desktop-update-discovery-review]], and [[open-source-releases]].

> [!important]
> **August 13: Ready for review state now survives desktop upgrades and restarts.** Completion
> review ownership moved from port-scoped renderer `localStorage` into each task row in SQLite.
> Every new transition to complete becomes durably unread, opening Task Activity or using
> **Mark reviewed** persists acknowledgement, and both actions identify the exact completion so a
> delayed request cannot hide a newer outcome. The additive migration baselines historical rows
> as reviewed and imports still-reachable legacy unread IDs once before the first task snapshot.
> Dynamic embedded ports and browser-origin changes can no longer erase the review stack. The
> focused review suite passes 48 tests, the complete suite passes 1,544 tests, `release:check` is
> green for v0.2.11, and `git diff --check` is clean. See
> [[launchpad-completion-notifications]], [[task-history]], and [[desktop-updates]].

> [!note]
> **August 13: the responsive workspace no longer has a two-panel split state.** From 1101px through 1344px, Composer, Task queue, and Task activity stay together in one fluid row, with activity receiving the largest track. At 1100px and below they stack into one full-width lane. This keeps Task activity visible at common Electron zoom levels instead of placing it below a full-height Composer and Queue row. Isolated 1280 by 900 and 1024 by 900 Chrome previews confirmed both states, and the dedicated responsive contract passes. See [[interface-layout]], [[compact-interface-density]], and [[task-detail-modal-and-app-zoom]].

> [!note]
> **August 13: additional running-task rows now use the complete header width.** At wide desktop sizes the first task row remains between the CC Relay brand and header actions, while configured rows two and three span the full padded header below those fixed regions. Column-first task assignment, card widths, row heights, durable preferences, and compact breakpoints remain unchanged. The complete suite passes 1,537 tests and `release:check` is green. See [[interface-layout]], [[compact-interface-density]], and [[durable-ui-layout-preferences]].

> [!note]
> **August 13: provider runway labels and countdown readability were tightened.** The four visible labels are now **Cla 5h**, **Cla Week**, **Fable**, and **Cod Week**. Full provider and window names remain available to assistive technology, and the remaining-time countdown text increased from 7px to 9px. See [[provider-usage-monitor]] and [[interface-layout]].

> [!note]
> **August 13: every task run in a git repository now has a per-task Changes preview.** Task detail
> gains a capability-gated **Changes** action that opens a changed-file tree with status letters and
> per-file line counts beside a side-by-side before and after diff on the Tokyo Night terminal
> surface. A working-tree baseline is snapshotted through a temporary git index when the task
> starts; the live diff then follows the working tree every 3 seconds with a server render
> signature preserving scroll, selection, and collapse state, and a terminal outcome freezes the
> diff against the captured end tree. Snapshots never touch the user's index, worktree, refs, or
> HEAD, and legacy task rows simply show no button. The focused diff suites pass 58 of 58, the
> complete suite passes 1,531 of 1,531, `release:check` is green for v0.2.9, and `git diff --check`
> is clean. Restart CC Relay and rebuild the desktop bundle to activate it. See
> [[task-diff-preview]].

> [!important]
> **August 13: deploy now recovers an unpublished release suffix automatically.** A rerun after an
> authorization failure compares reachable local SemVer tags with stable GitHub Releases, validates
> every pending annotated tag and its package, lockfile, changelog, release-commit, and ancestry
> invariants before any write, then publishes oldest first and waits for each exact Release. A tag
> that reached GitHub but has not finished publishing resumes its watch, and completed versions are
> skipped on another retry. Recovery always watches publication, exits successfully if there are no
> newer commits, and otherwise continues into the normal release flow. The current recovered suffix will
> be v0.2.7, v0.2.8, and v0.2.9 once `pkelemen` regains GitHub write access. Focused release tests
> pass 12 of 12, the complete suite passes 1,531 of 1,531, and `release:check` is green for v0.2.9.
> See [[open-source-releases]] and [[desktop-updates]].

> [!note]
> **August 13: completion speech is now aligned and configurable.** Terminal settings places sound
> and voice in matching full-width rows. Voice can announce any combination of project name, task
> name, and `Task complete`, with a 1 through 12 word task-name limit and an exact spoken preview.
> Existing saved behavior remains project plus one task word, at least one spoken part is enforced,
> and all choices persist through shared UI preferences. The focused suite passes 65 of 65, the
> complete suite passes 1,472 of 1,472, and `release:check` is green for v0.2.8. Browser control was
> unavailable for live screenshot verification. See [[task-completion-alerts]],
> [[project-terminal-settings]], and [[durable-ui-layout-preferences]].

> [!note]
> **August 13: unviewed completions now form a Ready for review block.** The operational Queue ranks them directly below running work until each task is opened, then returns the acknowledged card to its normal Today or Past section. The rose divider replaces the repeated New label in Queue, individual review badges remain in Search and History, and **Mark reviewed** clears the current project's review stack. Today, Past, and review dividers have more vertical breathing room with coordinated light and dark colors. The ordering helper leaves History, search relevance, queued FIFO positions, and scheduler state unchanged. The complete suite passes 1,471 tests and `release:check` is green. See [[task-history]], [[task-search]], and [[interface-layout]].

> [!note]
> **August 13: Task Activity now opens with a complete execution overview.** The top terminal strip shows live runtime first and expands by default into the newest provider plan plus every recorded sub-agent assignment, with explicit per-item state and elapsed time. **Minimize** collapses it back to the compact counters without periodic refreshes reopening it. Finished tasks convert stale live steps and workers to **Unfinished**, provider text stays escaped and bounded, and the expanded body has a compact container layout plus a bounded scroll budget. The complete suite passes 1,470 tests and `release:check` is green. See [[task-activity-overview]], [[provider-plan-and-goal-visibility]], and [[provider-sub-agent-visibility]].

> [!note]
> **August 13: the task list now searches complete saved conversations.** The project-scoped search covers task names, original and follow-up commands, saved Codex and Claude responses, final outcomes, and errors across all dates. Matching cards show ranked, highlighted evidence. Text matching ignores case, accents, and punctuation, supports quoted phrases and exact task numbers, and limits the rendered result set to 200. Filtered cards remain inspectable but are read-only for queue ordering, assignment, and parallel batching. The complete suite passes 1,442 tests. See [[task-search]] and [[task-history]].

> [!important]
> **August 13: a Claude provider API error can no longer become a green completed task.** Task 713 emitted two `API Error: 529 Overloaded` messages, then Claude reached an exit-zero idle boundary and Relay stored that error text as a successful result. `ClaudeExecutionRunner.run()` now validates the effective final response before emitting `claude/completed`. A final response beginning with `API Error:` fails the task, so cards, history, result artifacts, and completion alerts no longer claim success. Terminal turns remain non-retryable after submission; headless provider failures retain bounded transient retry. The focused provider, queue, and completion-notification suites pass 106 tests and `release:check` is green for v0.2.6. A complete run reached 1,454 of 1,454 before concurrent task-search work changed the shared tree; the current full rerun has one unrelated stale static assertion in `project-layout.test.mjs`, so rerun the complete gate after that work settles. See [[claude-provider-api-error-outcomes]], [[automatic-retry-safety]], and [[claude-terminal-visibility]].

> [!note]
> **August 13: the global running-task monitor now has configurable density.** A small cog on the rail's right edge selects one, two, or three rows plus Compact 230px, Default 286px, or Wide 360px cards. The default remains one row at 286px. Cards fill down before scrolling horizontally, the header and workspace share the measured height budget, top and bottom monitor positions both support the popover, and the choice persists in shared UI layout preferences with a local first-paint cache. The complete suite passes 1,451 tests and `release:check` is green. See [[interface-layout]], [[compact-interface-density]], and [[durable-ui-layout-preferences]].

> [!important]
> **August 13: attachment-bearing Claude updates no longer stop at a pasted message that still needs manual Enter.** Task 713 injected the update into the exact running terminal, then recorded `composerStates: ["junk"]`, `submitAttempts: 0`, and an exact rewritten queue record only 21.39 seconds later when the operator pressed Enter. Claude had replaced the attachment path with one image chip and shortened the collapsed body from the raw `+5 lines` to `+3 lines`; Relay compared only with `+5`, treated its own paste as foreign, and correctly sent no Return under that incomplete classification. Composer checks now derive both complete forms, require the exact image-chip count for the rewritten form, and use the rule in stable-draft flush, live-update recovery, normal continuation recovery, and post-clear verification. The Task 129 fixture now models the real rewritten geometry. Executor 204/204 and full suite 1,450/1,450 pass. The installed app was not restarted during active work; rebuild and relaunch it to activate this source fix. See [[claude-image-composer-rewrite-submit]].

> [!important]
> **August 13: running Claude updates no longer lock Relay behind an in-flight send or a preexisting native draft.** Task 697 rejected four sends over about four minutes because `namiru-ai-45` held unsent composer text; every failure occurred before any submit attempt, so the same draft blocked every later update until it was handled manually. The capability-gated Claude outbox now captures each press immediately, keeps the Relay composer enabled with an `N sending` count, and lets the active watcher's existing steering tail serialize delivery. On the exact owned terminal, a stable native draft is submitted first without being cleared or overwritten, then the captured update receives its own exact-evidence recovery window. Definite failures restore only their own prompt and attachments without erasing newer typing. With the Task 713 attachment correction, the four focused suites pass 323 tests, the complete suite passes 1,450 tests, and `release:check` is green for v0.2.6. Rebuild and restart CC Relay after active work finishes. See [[claude-live-steer-outbox]].

> [!important]
> **August 13: the Import localhost action was removed.** The desktop task queue heading no longer offers **Import localhost**. `POST /api/tasks/import-localhost`, the `taskHistoryImport` status payload, the `localhostTaskImport` capability flag, the `localhost-task-database` shared-configuration registration written by standalone startup, and `RelayDatabase.importTaskHistory()` are all gone. The `tasks.import_source` and `tasks.import_task_id` columns and the `idx_tasks_import_origin` index stay so already-imported desktop rows keep their legacy behavior. `test/task-import-ui.test.mjs` became `test/queue-ledger-ui.test.mjs`, which keeps the queue-card and Today/Past divider coverage and asserts the import surface stays gone. See [[localhost-task-import]].

> [!important]
> **August 13: Standup no longer fails when AI returns more than eight changelog facts.** The shared Standup and deploy schema no longer caps arrays at four items per section, and deterministic normalization no longer rejects more than eight items total. Prompts explicitly request every distinct confirmed fact without an item-count limit. Sentence length, plain-text safety, deduplication, source bounds, and the 2 MB provider-output bound remain. Focused tests prove 33 Standup facts and 20 release facts are accepted. See [[daily-standup]] and [[open-source-releases]].

> [!note]
> **August 12: Launchpad now has one project-add action.** The separate **Pin folder** and **Add and launch** buttons were consolidated into one **Add project** button. It pins and selects the chosen folder without opening an interactive terminal; manual launches remain in the terminal panel. See [[project-workspaces]] and [[interface-layout]].

> [!important]
> **August 12: the terminal settings dialog dropped its launch command row and was redesigned.** The `codex ...` string and its **Copy** button are gone; automatic pools open their own terminals and the manual path keeps **Launch Codex** and **Launch Claude** in the terminal panel. The dialog is now two sections with one rhythm, shared pill switches, and a single `renderTerminalSettingsHeader()` that always names the project being edited. `state.connection.launchCommand` is unchanged on the backend. Light and dark verified at 900, 620, and 420 pixels with no horizontal overflow. See [[project-terminal-settings]].

> [!important]
> **August 12: composer and Plan council dropdowns no longer fight the refresh.** The two-second snapshot refresh and the four-second thread poll rewrote the options of `#model-select`, `#plan-author-model`, `#plan-reviewer-model`, `#plan-author-terminal`, and both council effort selects on every tick, which closed whichever native popup was open and made changing the Claude model take several attempts. `public/stable-select.js` now writes a select only when its live options, value, or disabled state would actually change, and the effort slider markers are rebuilt only when the effort values change. Measured on the live page: 15 and 23 rewrites in 31 idle seconds before, zero in 46.8 idle seconds after, with a provider switch still repainting exactly once. See [[stable-composer-selects]].

> [!important]
> **August 12: Standup now generates one deploy-style daily changelog.** The former All tasks, Short, Standard, and Detailed choices and the Tasks or Blockers output are removed. Selecting a workday synthesizes completed saved conversations into short Added, Changed, Fixed, and Security sentences, then displays and copies ready-to-paste Markdown headings and bullet points. Standup and deploy share the same JSON Schema, section order, 180-character sentence limit, deduplication, and plain-text validation through `src/changelog-notes.mjs`. The August 13 update removed the original eight-item total limit. The new `aiStandupChangelog` capability fails closed across mixed backend and renderer versions. See [[daily-standup]] and [[open-source-releases]].

> [!important]
> **August 12: the header now shows provider subscription runway instead of a queue pause button.** Four compact bars report Claude's five-hour session, all-model weekly, and Fable weekly usage plus Codex weekly usage. They refresh every five minutes, expose reset details, preserve last-known values across temporary failures, and use green below 50 percent, yellow from 50 through 74, orange from 75 through 89, and red from 90. The strip sits immediately after the **Top** or **Bottom** position control, before the theme control, and the redundant **CC Relay online** pill is removed. Codex weekly usage now works because null JSON-RPC params survive request diagnostics and reach `account/rateLimits/read`; an isolated authenticated probe returned a normalized weekly value. Provider credentials remain inside the installed CLIs. The backend pause contract remains available to queue integrations. See [[provider-usage-monitor]] and [[interface-layout]].

> [!important]
> **August 12: packaged macOS now detects new versions without pretending a DMG can auto-install.** Version 0.2.3 accidentally started `electron-updater` on Darwin because the Electron entry point overrode the coordinator's Windows-only eligibility rule. The DMG-only release deliberately has no `latest-mac.yml`, so the running app entered `error` with no latest version and the header had nothing safe to display. Packaged macOS and Windows portable builds now query GitHub's stable latest-release metadata every five minutes, show the existing version indicator, and link to the exact manual download. Only installed Windows NSIS builds start `electron-updater`. See [[desktop-updates]] and [[open-source-releases]].

> [!important]
> **August 12: macOS releases remain DMG-only.** The macOS builder does not create an application ZIP, and the GitHub workflow does not upload or publish ZIP desktop artifacts. Squirrel.Mac automatic installation stays disabled because it requires that ZIP payload. GitHub's generated source-code ZIP and tarball still appear on every release, but they are not desktop packages. See [[desktop-updates]] and [[open-source-releases]].

> [!note]
> **August 12: desktop startup and About now carry the Crowie company identity.** A dedicated
> frameless Crowie splash appears before the embedded server is ready, the main window stays hidden
> until its first complete render, and then the two windows hand off cleanly. Clicking the header
> brand opens a responsive light-and-dark About dialog for Crowie s.r.o., Software Development
> company, and Ing. Patrik Kelemen; native About metadata carries the same ownership. Focused tests
> pass 19 of 19, and isolated visual checks covered the exact splash size plus light, dark, and
> compact About layouts with no browser warnings. The complete suite passes 1,406 of 1,406 and
> release metadata is consistent. See [[brand-startup-and-about]].

> [!note]
> **August 12: terminal settings now describe minimized launches literally and can copy one window layout to all pinned projects.** The dialog removes the diagnostics copy control, renames **Launch behind other windows** to **Open new terminals minimized**, and states that only the newly opened native terminal window is minimized. **Apply to all projects** copies grid enablement, rows, columns, monitor, and the minimized-launch choice with one backend write while preserving every project's retention and idle-routing choices. Later edits remain project-specific. Desktop and 620 pixel visual checks had no overflow or console warnings; 136 focused tests passed. See [[project-terminal-settings]] and [[interface-layout]].

> [!note]
> **August 12: provider plan and goal state is now visible in Task Activity for both Codex and
> Claude.** Codex `turn/plan/updated` and `thread/goal/*` notifications are routed by `threadId`
> above the turnId guard, because a goal-carrying thread reports them on a different turn-id space
> and the guard silently dropped exactly those threads. A turn that observed a goal replays it once
> with a top-level `turnEnded: true`, so a finished task stops reading live. Claude's board
> (`TaskCreate` / `TaskUpdate` / `TaskList`, plus legacy `TodoWrite`) is folded at the tool_result,
> because a rejected `TaskUpdate` answers `{"success": false}` with no `is_error` flag, and the
> `~/.claude/tasks/<sessionId>/` mirror overlays that fold rather than replacing it. A knowingly
> partial board carries `partial: true` and layers onto the last whole revision. Full suite
> 1,395 tests, the four suites covering this contract 199 tests, `release:check` green. Restart CC Relay and
> rebuild the desktop bundle to activate it. See [[provider-plan-and-goal-visibility]].

> [!note]
> **August 12: provider Markdown tables now render as readable semantic tables.** Task Activity,
> Result, plan, and session response surfaces recognize pipe tables with alignment, preserve inline
> code and escaped pipes, and keep raw HTML escaped. Header bands, column rules, alternating rows,
> cell wrapping, keyboard focus, and bounded horizontal scrolling replace visible Markdown pipe
> syntax. Wide and 480 pixel browser checks had no page overflow or console warnings. See
> [[terminal-markdown]].

> [!important]
> **August 12: GitHub Support ticket #4656799 is open for the stale `claude` sidebar contributor.** A fresh live audit still showed only `pkelemen` in the Contributors REST API and contributor graph, while `GET /Crowie-s-r-o/CC-Relay/_sidebar` alone returned `pkelemen,claude`. The only branch is clean, both release tags are clean, and all five closed pull request refs are clean. GitHub Support's guided analysis confirmed that there is no self-service sidebar purge and that contributor displays can take about 24 hours to refresh after a history rewrite. The submitted ticket asks GitHub to recalculate or purge the sidebar record and, if possible, garbage collect orphaned pre-rewrite commit `844fdb999532e43ba9d12ebb12d585bd11346673`. Track it at https://support.github.com/ticket/personal/0/4656799. See [[open-source-releases]].

> [!important]
> **August 12: `claude` appeared as a second GitHub contributor and the history was rewritten to remove it.** One commit (`fix(release): publish releases instead of silently skipping them`) carried `Co-Authored-By: Claude` plus a `Claude-Session:` trailer. They came from the Claude Code harness and are now suppressed globally by `"includeCoAuthoredBy": false` in `~/.claude/settings.json`. `git filter-branch --msg-filter` stripped both lines from `HEAD~2..HEAD` with identity and timestamps intact, and `main` plus the moved `v0.2.1` tag were force pushed atomically (old head `3228098`, rewritten head `40dd5f6`). The temporary backup branch and `refs/original` ref were removed after verification. **The tag had to move**, because `scripts/deploy.mjs` picks the latest tag with `git tag --merged HEAD` and an orphaned `v0.2.1` would break the next `npm run deploy`. That tag push legitimately re-ran `build-desktop.yml`, which republishes the same v0.2.1 assets to the existing release. **The git side is provably clean:** the contributors API lists only `pkelemen`, no named local or remote-tracking ref carries assistant attribution, and the rewritten default branch contains only the maintainer identity. A repository-owned commit hook now rejects Claude, Anthropic, Codex, and OpenAI author, committer, credit, and session metadata; full-history CI and the release command run the same check. The complete suite passes 1,239 of 1,239 tests. **The repository overview sidebar still rendered `claude` afterwards.** That box comes from `GET https://github.com/OWNER/REPO/_sidebar`, which answers `cache-control: no-cache` and still reported `contributorCount: 2`. The staleness is GitHub backend state, not an HTTP or browser cache, which is why reloads and further pushes change nothing. It clears on GitHub's own recount, with Support as the only lever if it outlives a day. See [[open-source-releases]].

> [!important]
> **August 12: `v0.2.0` was tagged and pushed but no GitHub Release exists, and it never will.** The desktop build workflow ran `npm test` on the Windows runner, where 75 POSIX-simulating cases fail (for example `resolver probes every POSIX candidate without stat filtering` expects `/Users/tester/.local/bin/claude` and gets `claude`), so `needs: build` skipped the release job while `npm run deploy` still exited 0 printing "GitHub Actions will build and publish". The fix runs the suite on the macOS matrix entry only and makes deploy poll GitHub until the release is published, failing with the run URL when it is not. **Re-running the workflow at `v0.2.0` would reuse the broken workflow file at that ref, so do not retag; the fix ships as the next version.** The change is working-tree local commit only and reaches GitHub on the next `npm run deploy`. The 75 Windows failures stay real and are now un-gated; see [[windows-compatibility]] and [[desktop-updates]].

> [!important]
> **August 12: the Claude session-end wedge is fixed in source; rebuild and restart to activate it.** Tasks whose Claude turn crossed background sub-agent boundaries (team sessions with standby agents) stayed Running forever and failed with "N background tasks had not finished when the terminal closed" when their terminal closed: the prompt-id guard dropped every later Stop hook, freezing the `hookBackgroundTasks` snapshot, and a stale `pendingBackgroundAgentCount` could strand finality even after the arrays cleared. Tonight's victims were tasks 218, 222, and 223 (task 129 was the first diagnosed case); single-boundary tasks like 221 were never affected. The fix (boundary-adopting Stop guard with acceptedTurnEnded latch and pending fence, countCleared re-arm of the held final, message dedupe) lives in `src/claude-terminal-executor.mjs` with 8 regression tests, adversarially reviewed twice with runtime probes; focused suite 196/196, full suite 1232/1232. The change is working-tree only and must be committed before any release tag. The running packaged app still holds the wedged code. See [[claude-stale-background-stop-hook]] and [[claude-background-sub-agent-completion]].

> [!important]
> **August 12: the public README now leads with Relay's seven core benefits and keeps end-user setup separate from development.** The order is provider-specific concurrency, disposable minimized terminals with same-conversation resume, multi-project Launchpad operation, queue-ahead prompts, challenged two-provider Plan council, fresh-planner plus single-executor Turbo, and visible provider subscription runway. **Get started** tells users to download and run the packaged macOS or Windows release, while source checkout, Node.js, localhost, and Electron commands live only under **Development**. The terminal promise was checked against the implementation: new projects default to minimized launch and no retention, macOS miniaturizes the exact owned window, terminal outcomes release exact owned launches, and **Continue session** resumes the saved provider conversation. See [[core-product-story]], [[open-source-releases]], [[disposable-terminal-pools]], [[provider-usage-monitor]], and [[project-terminal-settings]].

> [!important]
> **August 12: Windows support is code-complete and gated on a real-machine smoke run.** Before this pass the Windows build could not work at all: every static asset 404ed (backslash-blind containment guards), every direct provider spawn failed (npm `.cmd` shims plus a resolver probe that rejected them), kills orphaned providers holding port 4769, the grid-placement PowerShell never compiled, and manually closed terminals leaked pool slots forever. All fixed across 14 src files with win32-simulated tests; macOS behavior is byte-identical per adversarial review. Full suite 1194/1194, `release:check` green. Plan council terminal execution, live steering, and runtime terminal recovery stay macOS-only by design and are advertised through `capabilities`. The 15-item Windows smoke checklist (items 1-5 are the release gate) and the unproven-on-macOS register live in [[windows-compatibility]].

> [!important]
> **August 12: the repository is ready for source-available publication at `Crowie-s-r-o/CC-Relay` under PolyForm Noncommercial 1.0.0.** Users may modify and redistribute it for permitted noncommercial purposes; business use requires separate written permission from Patrik Kelemen. The README leads with the honest macOS-only validation status and the selected overview screenshot. One local release command now owns deterministic SemVer, isolated Codex-to-Claude AI changelog generation, metadata checks, all tests, dependency auditing, the release commit, annotated tag, and atomic GitHub push. The GitHub release body is extracted from the same changelog entry. The release candidate passes 1,232 tests and zero-advisory auditing; its macOS arm64 DMG, ZIP, update metadata, strict deep signature, archive integrity, and packed runtime sources were verified locally, with notarization still explicitly unconfigured. The audit also removed tracked IDE files and a stale `undefined/asar-src` package snapshot, made plugin installation portable, sanitized the real incident fixture, replaced literal source control bytes, and cleared all five dependency advisories. See [[open-source-releases]], [[licensing]], and [[desktop-updates]].

> [!note]
> **August 12: queue and terminal-retention actions now match the dark operator shell.** Rename has
> a compact pencil treatment, queue movement is one segmented chevron control, and every queue-only
> action now receives an explicit graphite dark surface instead of retaining a white light-theme
> fill. Stop auto-close uses a pin instead of a radio-like ring, preserving its one-way latch
> semantics while keeping explicit text and `aria-pressed`. Isolated light and dark browser checks
> passed at the real 500px queue width with no wrapping or console issues, and all 1,184 tests pass.
> Rebuild or restart CC Relay to load the updated renderer CSS. See [[compact-interface-density]],
> [[dark-mode]], and [[live-terminal-retention]].

> [!important]
> **August 11: completed tasks now have selectable sound and voice alerts.** Settings offers
> Silent, Gentle chime, Bright bell, and Digital pulse, with a Test action and an independent
> option that speaks the project folder plus the first task word, such as `relay. Add.`. Alerts
> use real unfinished-to-complete transitions, including a task already open in Task Activity,
> while the first historical snapshot remains quiet. Choices persist across desktop port changes
> and restore before task polling begins. Live Chrome QA verified preview and reload persistence
> with no console issues, and all 1,130 tests pass. Restart or rebuild CC Relay. See
> [[task-completion-alerts]].

> [!important]
> **August 10: text selection is protected for the complete drag gesture everywhere in Relay.** The task, project, terminal, planner, and duration refresh paths now wait from pointerdown through pointerup, closing the Task Detail race before the browser has established a nonempty range. A document-level click gate prevents a finished drag from toggling disclosures, activating cards, following links, or triggering other selected controls; normal pointer clicks and keyboard activation remain unchanged. Live Chrome checks held Task Detail body, disclosure-summary, terminal, and task-card ranges through multiple polls, and the disclosure no longer toggled after its text was selected. All 1,125 tests pass. Rebuild and restart CC Relay. See [[stable-text-selection]].

> [!important]
> **August 10: Standup now defaults to a terse All tasks mode.** It keeps every included task as a separate, source-ordered update, asks for 4 to 12 words, preserves repeated entries, and caps each line at 160 characters. Short, Standard, and Detailed remain available for grouped synthesis. A new capability gate protects mixed renderer and backend versions. All 1,117 tests pass. See [[daily-standup]].

> [!important]
> **August 10: Task Activity copy controls are stable during polling, and direct retries are configurable.** The two-second task refresh no longer clears clipboard payloads or resets feedback for the same selected task, so Copy remains continuously clickable. Prompt Copy now emits only user-authored text without the generated `01 · Original request` heading. Retrying a failed, cancelled, or interrupted automatic Execute task opens Executor, Model, and Effort choices. Keeping the provider preserves its conversation; switching between Codex and Claude starts fresh. Workflow-owned and automatic retries remain unchanged. All 1,115 tests pass. Rebuild and restart CC Relay. See [[configurable-task-retry]], [[interface-layout]], and [[task-history]].

> [!important]
> **August 10 correction: Fable 5 is current and is restored in Relay.** Claude Code `2.1.226` runs Fable from `~/.claude/settings.json` and lists it in the live `/model` picker. The earlier inference that Fable was retired confused an unrelated `SessionStart:startup hook error` with model availability. Relay now exposes `default`, `opus`, `fable`, `sonnet`, and `haiku`; preserves Fable through browser state, backend validation, native launches, and headless runners; and maps only the old Relay `best` value to Fable. Plan council and Turbo prefer Fable again. All 1,115 tests pass. Signed arm64 DMG and ZIP artifacts are rebuilt and verified. Reinstall and restart CC Relay. See [[claude-current-model-routing]] and [[claude-current-model-routing-review]].

> [!important]
> **August 8: interface layout now survives desktop restarts.** Electron uses a new embedded HTTP
> port on each launch, so origin-scoped `localStorage` could not remember panel widths, Task
> Activity terminal height, or a monitor bar moved to the bottom. These choices now persist in
> shared `relay-config.sqlite` through `/api/ui-preferences`, while local storage remains the fast
> first-paint cache. All 1,106 tests pass. See [[durable-ui-layout-preferences]],
> [[header-position]], and [[interface-layout]].

> [!note]
> **August 8: the Composer receives more reliable desktop space and queue cards stop repeating prompt-derived names.** Its default is 580px and its usable minimum is 400px, so older saved 360px layouts are widened too. Queue cards show the prompt preview only when an explicit task name differs from the request. A 2048 by 1152 browser check measured 400px Composer, 753px Task queue, and 839px Task activity, with zero duplicate previews and zero console errors. All 1,103 tests pass. See [[interface-layout]] and [[compact-interface-density]].

> [!important]
> **August 7: a pending Codex CLI release froze every queued Codex task, and the fix needs a restart.** The interactive TUI stops on `Update available! 0.146.1 -> 0.147.0 ... Press enter to continue` before it dials `--remote`, so no provider session ever bound and the task ran forever with no output. It looked intermittent only because Codex throttles the check through `~/.codex/version.json`. Every interactive launch command CC Relay builds now ends with `-c check_for_update_on_startup=false`: the connection-helper constant, the fresh and `codex resume` forms shared by Launchpad and the disposable pool, and the app-server `launchCommand`. `codex exec` never shows the prompt and was left alone. All 1,100 tests pass. Restart CC Relay and rebuild the desktop bundle. See [[codex-update-prompt-freeze]].

> [!important]
> **August 7: a TEXT-ONLY live update to a running Claude session was typed into the composer and then never submitted, and the installed desktop app is three defects behind.** A single-line follow-up is a three line paste once the non-interactive notice is appended, three lines never collapse, so Claude renders the text literally and word-wraps it over four or more rows. That pushed the caret past the one-row `CLAUDE_COMPOSER_MAX_TAIL_DEPTH`, every guarded recovery pass read `'unreadable'`, and an unreadable composer receives no action by design. Measured on a Claude Code 2.1.224 pty capture: `held` at 100 columns, `unreadable` at 80, which is Terminal.app's default and why the operator saw it "often". The composer scan is now bounded by the small stable chrome BELOW the closing rule instead of by caret depth, inconclusive reads no longer consume the action schedule, and `composerStates` reports every pass in diagnostics. Every fail-closed negative is unchanged and mutation checked. All 1,098 tests pass. **The running app is the Aug 5 18:49 build with the old 25 second one-action steer path, so rebuild and relaunch before validating anything.** See [[claude-steer-text-hold-reliability]].

> [!important]
> **August 5: image-bearing live updates to a running Claude session now recover from a swallowed Return instead of remaining as blocking composer chips.** Task 129 proved the first text update succeeded, the second update with one image never produced a user or queue record, and its `[Image #2][Pasted text #3 +3 lines]` stayed held after Relay's single guarded action. Live steering now uses up to four spaced actions, re-proves the exact session and exact held paste before each one, stops if the composer clears or differs, and can cross the earlier response's busy-to-idle boundary. The browser waits 120 seconds for the backend's 80 second bound. All 1,089 tests pass. Rebuild and relaunch CC Relay before validation. See [[claude-live-steer-held-paste-recovery]].

> [!important]
> **August 5: tasks can now receive an optional name at submission and can be renamed while they are still queued.** The canonical name appears on queue cards, the running-task rail, Task Activity, artifacts, standups, and the bundled queue helper. Rename uses the existing atomic queued-status guard and preserves task ID, prompt, position, routing, workflow state, and images. Blank names fall back to prompt-derived titles, names are part of idempotent submission identity, and older backends are protected by `capabilities.queuedTaskNaming`. All 1,087 tests pass, and an isolated backend accepted a named queued task through the real API. Restart CC Relay and rebuild the desktop bundle to activate the backend and renderer together. See [[task-naming]] and [[task-history]].

> [!important]
> **August 4: Task Activity now visualizes named Claude and Codex sub-agents through one live worker ledger.** Claude launch and finish notifications fold by tool use ID; Codex spawn, activity, and multi-worker state updates fold by agent thread ID. Worker rows show role or model, brief, and running, background, finished, interrupted, or failed state. Codex `interacted` activity preserves lifecycle instead of falsely finishing a worker, and Claude background command notifications no longer appear as unnamed agents. The earlier Claude premature-close defect remains protected by the unlimited headless background wait, interactive pending-work gates, and fresh-consolidation requirement. All 1,081 tests pass, and an isolated live UI rendered both providers as separate named workers. Restart CC Relay and rebuild the desktop bundle after active tasks finish. See [[provider-sub-agent-visibility]] and [[claude-background-sub-agent-completion]].

> [!important]
> **August 4 historical note, superseded August 26: Terminal session mode first kept both the direct task and its terminal workspace open across as many turns as the operator needed.** Every successful, failed, stopped, or restart-interrupted turn returned the same task to `open`; it never retried automatically and it originally completed only through **Complete session** in Task Activity. Completion did not close the retained native terminal, and **Close terminal** originally did not complete the task. The August 26 note above adds terminal-close completion. Manual session cards have a dedicated terminal rail, Launchpad reports **Session open**, the continuation dock says **Send command**, and the completed task cannot silently reopen. Plan council, Turbo, and the running-task **Stop auto-close** latch keep automatic completion. A temporary live backend verified the actual completion route at desktop and 600 pixel layouts in light and dark themes with zero console errors. Restart CC Relay and rebuild the desktop bundle to activate the schema, route, and renderer. See [[manual-terminal-session-mode]].

> [!important]
> **August 4: a running automatic task now has a bright, task-level Stop auto-close safety latch in Task Activity.** Pressing it persists retention for only that task, changes the control to **Auto-close stopped**, and keeps the exact prepared terminal or workflow fleet open at the final outcome. Completion re-reads the task row instead of the dispatch snapshot, automatic retries still close intermediate attempts, and shutdown promotes a prepared latched launch before cancelling the turn. Older backends show a disabled restart state. The complete suite passes 1,067 tests; isolated light, dark, 1180, 720, and 420 pixel checks produced no overflow or console errors. Restart CC Relay and rebuild the desktop bundle to activate the route and renderer. See [[live-terminal-retention]].

> [!important]
> **August 4: Task Activity now gives the terminal 84 percent by default and opens full task or Plan council detail in a modal.** Retained-session tasks keep a 72 percent terminal default so the session controls remain usable. The desktop app now supports Command or Control plus, minus, and zero whole-page zoom from 50 through 200 percent instead of forcing 100 percent. The complete suite passes 1,063 tests, and an isolated live dark-theme check confirmed the modal contrast and zero console warnings. Rebuild and relaunch the desktop app to activate the renderer and Electron changes. See [[task-detail-modal-and-app-zoom]].

> [!important]
> **August 3: Claude tasks can no longer complete while tracked background work is still live.**
> Headless print mode now receives the explicitly approved unlimited background wait setting, and
> an exit-zero run still fails non-retryably if stderr or `turn_duration` reports terminated work.
> Interactive turns hold the exact terminal across sub-agent launches, Stop-hook background tasks,
> session crons, and authoritative pending counts, then require a fresh consolidated response after
> everything finishes. The queue never replays partial work automatically. All 1,057 tests pass,
> the real-child queue shim covers failed and clean outcomes, and signed arm64 DMG and ZIP artifacts
> are rebuilt and verified. Install and restart only after active tasks finish. See
> [[claude-background-sub-agent-completion]].

> [!important]
> **August 3, latest: keep-terminal-open tasks now have a full session surface. Restart CC Relay (and rebuild the desktop bundle) to serve the new per-turn `responses` field and the retained-close task event; the refreshed renderer degrades cleanly until then.** Direct session tasks show a Session badge with live terminal state (open, busy, pending, closed) on their queue cards, and Task Activity swaps the flat Prompts and Result disclosures for a session strip plus a paired prompt-and-response conversation history. The strip's **Close terminal** kill action reuses the existing `DELETE /api/terminals/:threadId` ownership path, so a running follow-up blocks the close and a successful close records a queue event on the retained task. The two-second poll cannot rebuild the transcript under the reader: a content signature (including a djb2 prompt-text hash and provider, added after the reviewer proved a queued edit rendered stale) gates the DOM write, and per-turn disclosure state is remembered. Adversarial verdict Ship at 1039 of 1039 tests. See [[session-tasks]].

> [!important]
> **August 3, later: tasks 91 and 92 were real defects, not stale processes. Both are fixed at 1014 of 1014 tests, adversarial verdict Ship. Quit and rebuild the desktop app to activate, then retry both tasks.** A freshly launched Claude TUI renders its composer before its input loop consumes stdin (SessionStart hooks on this machine emit roughly 77KB), so the opening paste sits invisible in the PTY while the screen scrape reads an empty composer; the lost-paste recovery re-pasted, and Claude submitted ONE record holding the prompt twice with four image parts (task 92, seam at offset 66,509; chips `#1 #2` then `#4 #5` because `#3` and `#6` were the two paste widgets). Re-injection now requires positive loss evidence (`pasteSeenHeld`, `pickerResolvedAfterPaste`, `composerClearProven`, or `compactionObserved`); the reviewer proved the first draft's shared picker counter still licensed doubling from a PRE-injection dialog answer, so the picker term is latched only by the post-injection resolution. Separately, `<command-name>`, `<local-command-stdout>`, `<local-command-stderr>`, and `<local-command-caveat>` user records carry no `isMeta` flag and are flushed past the injection offset when a slash command completes; they latched `unmatchedSubmissionObserved` and froze task 91's retry before its paste was ever submitted, so `userPromptRecordText` now drops them. The stale July 29 standalone was stopped mid-session with zero queued work. Task 91 and 92 retries resume large sessions and need the bookkeeping fix to survive the resume compaction, so restart first. See [[claude-fresh-session-paste-buffering]].

> [!important]
> **August 3: every "resume still fails" report traced to stale processes, not new defects. Restart BOTH backends together onto this tree.** The standalone `node src/server.mjs` had run since July 29 16:58 and the installed desktop app since July 31 00:59 with an `app.asar` built at 00:55, so neither contained the July 30-31 resume fixes. Desktop task 88 failed at 11:17:38Z exactly on the already-fixed cumulative `[Image #N]` chip numbering: its follow-up carried one image into a session whose earlier follow-up had two, Claude recorded `[Image #3]...`, the stale bundle derived only `#1`, and the turn had zero possible delivery evidence. A replay of the real transcript record against the current tree proves `submittedRewrittenPromptMatches` accepts it while the old derivation rejects it; Claude had actually completed the work. Two hardening changes landed and were adversarially reviewed to Ship at 998 of 998 tests. First, task-owned Claude launches now carry model, effort, and hook `--settings` on the first command and skip the kill-and-relaunch on a proven match, removing the visible open-close-reopen on every resume; council, Turbo, legacy, adopted, and retained launches keep the relaunch. See [[claude-launch-settings]]. Second, the observed dual-backend terminal fight (at 11:21:02Z the stale standalone runtime-adopted a launch the desktop had opened five seconds earlier; same class as the July 30 incident) is ended by a cross-process launch-ownership registry in the shared `relay-config.sqlite` with pid-plus-start-token liveness, with `ps` reads pinned to `LC_ALL=C` and `TZ=UTC` because token text follows locale and zone. The guard arms only when BOTH backends run this code, so quit the old standalone and the old desktop app in one window, install the freshly built bundle from `dist/`, and only then relaunch. See [[dual-backend-ownership-guard]] and [[resume-dispatch-audit]].

> [!important]
> **Restart CC Relay to activate this fix.** Text typed into a **busy** Claude session is never submitted: Claude queues it and writes a `queue-operation` record with `operation: "enqueue"` whose `content` is the injected text byte for byte, with no framing and no composer rewrite. That is not a `user` record, so the evidence contract could not see it. Two defects came from that. Live updates always timed out: task 85's three failed `deliveryUncertain` at 25 seconds while their enqueue records had been written 1.4 to 8.3 seconds after each request, so timing was never the problem and the budget is unchanged. And a task's **opening prompt** could be pasted twice, because a queued paste leaves the composer empty and the recovery schedule reads an empty composer as a lost paste; that path now latches off the same way Task 61's unmatched-record latch does, and the turn anchors when Claude takes the prompt off the queue. An enqueue never starts a turn, so the previous response can never become the queued prompt's answer, and only the unambiguous `queued_command` consumption record may start one, because `remove` also means a human deleted the message. `promptAcceptanceTimeoutMs` and its fail-closed no-retype outcome are unchanged. See [[claude-steer-delivery-evidence]].

> [!important]
> **Restart CC Relay to activate this fix, then retry task 84's council revision.** Claude numbers `[Image #N]` chips cumulatively across the whole session, not per prompt. Task 84's revision stage was recorded as `[Image #3] [Image #4]...` and, after Resume, `[Image #5] [Image #6]...`, while CC Relay derived only the `#1` `#2` form. The stage sat unverified and failed at the five minute `promptAcceptanceTimeoutMs`, closing both terminals roughly four minutes after Claude had already finished the 28,701-character plan. Correlation now validates the chip run (exact count, strictly consecutive, any start `>= 1`) against a byte-identical body instead of deriving one numbering. See [[claude-image-prompt-correlation]].

> [!important]
> A Claude live update that CC Relay typed into the terminal but could not confirm now clears the **Continue session** composer and its per-task draft instead of leaving the text there to be resent. Task 85 was sent three times in six minutes for exactly that reason: every attempt failed at 25 seconds with `deliveryUncertain`, and the retained text made a landed message look failed. `sendError()` carries the flag, `api()` puts it on the thrown error, and `continuationDispatchOutcome()` maps delivered, unconfirmed, and failed to three different composer outcomes. The upstream evidence timeout in `claude-terminal-executor.mjs` is unchanged. See [[continuation-input-review]].

> [!important]
> **Rebuild and relaunch the desktop app before retrying Task 58.** Reviewed-plan execution on
> Fable exposed two independent failures. Terminal.app could submit the long hook-bearing Claude
> command before Fish finished startup, consuming Return and leaving the command held at the shell
> prompt. macOS launch now opens an empty tab, waits for that exact tab to become idle, and only
> then submits the provider command. After a fourth launch connected, Claude accepted and began
> processing the 30,901-character image prompt, but changed every space before `/` into a newline; strict
> correlation missed four characters and timed out. Image-prompt normalization now accepts that
> complete deterministic variant while text-only and partial matches stay strict. The real Task 58
> transcript matches, live launch smoke passed 3 of 3, and all 910 tests pass. See
> [[claude-fable-reviewed-plan-execution]] and [[claude-image-prompt-correlation]].
>
> Task 61 retried from a packaged app launched at 23:51, but its `app.asar` was built at 23:25,
> before the launcher fix landed at 23:36. Its diagnostics lack the new `shellReady` field, and its
> 30,746-character transcript prompt matches the corrected normalization exactly. The attached
> Task 62 screenshot is another stale-bundle launch where the command stayed held at the Fish
> prompt. Reopening that installed app is insufficient. A verified replacement DMG and ZIP were
> built at 00:35 in `dist/`; all 76 packed source and public files match the 921-test tree. The
> running `/Applications/CC Relay.app` was intentionally not replaced while tasks were active.
> After they finish, quit the old app, install the new DMG, and then run only one backend. See the
> Task 61 activation audit in
> [[claude-fable-reviewed-plan-execution]].
>
> Extracting `app.asar` confirms this exactly: precisely three packed modules differ from the
> working tree, and all three are that session's fixes. Everything else in `src/`, and all of
> `public/`, is byte identical, so relaunching swaps in nothing unrelated. Replaying the real
> transcript record proves the correlation fix alone was load bearing: the packaged
> `attachmentRewrittenPrompts()` matches `false`, the working tree matches `true` at 30,745 of
> 30,745 bytes. The terminal itself came up cleanly, so the launcher barrier was not involved.

> [!important]
> **An empty Claude composer is not proof of a lost paste, and Task 61 was not idle.** Its
> transcript runs to `21:56:49.957Z` with two sub-agents spawned and a final "Team is up and
> running" message; CC Relay failed the task at `21:57:33Z` and closed the terminal one second
> later, destroying live work. A successful submit and a swallowed paste leave the same empty
> composer, so at `21:52:41.901Z` the recovery re-pasted 30k characters into a session that had
> already accepted them at `21:52:40.284Z`. The executor now latches
> `unmatchedSubmissionObserved` when a top-level user prompt record lands after the turn's
> injection offset that no derived form matches (`isMeta` excludes Claude's own `[Image: source:
> ...]` annotation, `isSidechain` excludes sub-agents, and `/compact` is internal bookkeeping).
> While set, every automatic terminal recovery action is blocked. The transcript is drained again
> after awaited session and screen reads, directly before the action gate, so a submission arriving
> during that timing window cannot be followed by a re-paste, Return, picker input, or composer
> clear. The timeout says the turn may actually be running without also claiming it never started.
> This is never submission evidence, only permission to stop, so the exactness contract is
> unchanged.
>
> **Both evidence channels latch, not just the transcript.** `UserPromptSubmit` is the EARLIER
> signal and carries the same unmodelled rewrite the record will carry seconds later. An unmatched
> hook payload used to be dropped silently, which left a live re-paste window whenever the JSONL
> flush lagged the empty-composer pass and the status read sampled stale idle. `consumeHook` now
> latches on the same terms (`!promptSubmitted`, non-empty prompt, not `/compact`), with the
> existing `agent_id` guard standing in for `isSidechain`, and steering cannot reach it because a
> steer is acknowledged only while `promptSubmitted` is already true. Consequence worth knowing: a
> text-only turn whose hook reports a blank-line-collapsed prompt still never anchors, but its
> guidance no longer says the terminal holds unsubmitted text, because that hook proves Claude
> submitted something and the old wording invited a duplicate run. Every guard in the latch is
> mutation-pinned by a fixture. All 142 executor tests pass, as does the full repository suite
> (925 when this landed, still moving as the redesign adds coverage). See
> [[claude-fable-reviewed-plan-execution]] and
> [[claude-image-prompt-correlation]].

> [!important]
> The prompt composer now inherits the active project's collision-resolved identity color. Workflow
> and provider selection, native selects, prompt focus, the complete effort rail, and the main queue
> action all follow the selected Launchpad project in light and dark themes. Claude keeps its orange
> provider glyph. See [[active-project-composer-colors]].

> [!important]
> Project identities now use eight widely separated bright hues, and the actual visible order gives
> Relay bright cyan while talent-finder receives signal red. Click a project's initial tile to choose
> Automatic, one of eight named presets, or any custom color. The selection persists in shared project
> configuration and derives contrast-safe light and dark tokens for the Launchpad, composer, task
> selection, and running-task card. See [[project-color-customization]].

> [!important]
> Launchpad projects now show a numbered badge for completed tasks that have not been opened in
> Task Activity. The first task snapshot is a clean baseline, later completion transitions persist
> across refreshes and restarts, and opening the completed task acknowledges only that task.
> Running, waiting, restart, and attention states keep priority while retaining the badge; an
> otherwise idle project reads **Finished**. See [[launchpad-completion-notifications]].

> [!important]
> **Restart CC Relay after active tasks finish to enable Claude live updates.** A running direct
> Claude task can now receive text and images from **Continue session** without creating queue
> work. Delivery resolves only the exact active interactive task and terminal, requires a visible
> empty native composer, and confirms the exact prompt through `UserPromptSubmit` or the durable
> transcript. One guarded Return can recover a held paste. Foreign drafts fail closed, late hooks
> from the earlier prompt are ignored, and an ambiguous post-injection result is never retried.
> The 218 focused tests pass. At review time, the full suite had one unrelated dark-mode failure
> while task 397 was actively changing that feature. See [[claude-live-steering-review]].

> [!important]
> **Restart CC Relay to activate this fix, then retry task 39's Resume council.** Claude Code
> 2.1.220 shows a blocking resume picker when a resumed session is over 70 minutes inactive and
> over 100k tokens. Task 39's July 30 council resume pasted its 201-line revision prompt into that
> picker: the paste was swallowed with zero trace, the appended Return confirmed the default
> Resume from summary option, a 2.5 minute compaction ran, and all four guarded submit actions hit
> an empty composer. Readiness by `claude agents --json` alone cannot see the picker, so the
> executor now reads the exact owned terminal viewport before typing: the resume picker is
> answered with `2` (Resume full session as-is, never `1`, never the preference-writing `3`), a
> recognized folder trust dialog is approved once for the selected workspace, unknown screens
> fail closed with an excerpt, visible residue is cleared with one spaced Ctrl+C, every guarded submit
> action first verifies the held `[Pasted text #N +M lines]` placeholder on screen, a provably
> lost paste is re-injected once, and a junk-positive composer can never receive a blind Return
> (the junkUnproven latch). Snapshot failures degrade to the pre-change behavior. 1,636 tests green,
> classifier validated against 36 live-captured frames, adversarial review verdict Ship. See
> [[claude-resume-picker-guard]] and [[claude-folder-trust-startup]].

> [!important]
> **Restart CC Relay to activate this fix.** The guarded Claude submit action is no longer one-shot.
> Task 39 on July 30, 2026 failed its revision stage twice for unrelated reasons: first at
> `13:38:29Z` before any paste, when one undescribable Terminal window aborted the whole JXA
> inventory and terminal resolution returned nothing (see [[resume-dispatch-audit]]), and then on
> the resumed attempt described here. That attempt pasted a 201-line revision prompt at
> `13:52:02Z`, sent its single nudge
> at `13:52:05Z` while the composer was still collapsing the paste into a widget, and failed at
> `13:52:24Z` with the text still unsent and the transcript untouched since `13:33Z`. A held paste
> now receives up to four separate submit actions near 6, 15, 27, and 42 seconds, inside one
> 80-second submission window, each re-proving exact terminal identity, zero prompt correlation,
> transcript state, fresh idle status, no compaction, no pending question, and no cancellation. Any
> submission evidence stops the schedule permanently, and the exact-prompt contract is unchanged.
> The image-prompt gap noted here is now fixed and its diagnosis corrected, see the note below.
> See [[claude-held-paste-multi-attempt-submit]].

> [!important]
> **Restart CC Relay to activate this fix, and do not restart onto the strict evidence contract
> without it.** An attachment-bearing prompt is never recorded as delivered: Claude Code's composer
> removes the image paths with one preceding space, collapses blank lines, and prefixes
> `[Image #1] [Image #2]` chips, one per path occurrence. A live captured `UserPromptSubmit` payload
> from Claude Code 2.1.220 proved the hook reports that same rewritten text, byte identical to the
> transcript record, so the earlier belief that the hook still correlated image prompts was wrong.
> Under the strict contract an image turn had zero evidence sources, which would have failed every
> Plan council stage and every Execute task with attachments at the five minute
> `promptAcceptanceTimeoutMs`. CC Relay now derives the exact rewritten form from the task's own
> attachment paths and accepts it on both channels, still requiring the complete prompt and still
> rejecting compact summaries, tool results, truncations, and half-rewritten text. Text-only prompts
> are untouched: no attachment reference means no derived form at all. Watch
> `promptSubmissionEvidence` for `transcript-anchor-normalized` and `user-prompt-hook-normalized`.
> See [[claude-image-prompt-correlation]].

> [!important]
> **Restart CC Relay to activate this fix.** The macOS Terminal inventory behind every exact-identity check no longer aborts on one undescribable window. Terminal.app answers `null` for such a window's tabs, and the former single-expression JXA script called `.map()` on it, so one bad window returned no identity for every session in that pass. Task 39's Plan council revision died that way on July 30 at `13:38:29.743Z`, three milliseconds after `terminal.recovery.native_inspection_failed`, with a non-retryable **could not resolve the exact owned terminal** error and both council terminals closed. That is a separate earlier failure from the `13:52:24Z` unsent-paste failure above. A second fix stops a missing conversation ID from matching whichever owned launch is still binding during cleanup, which could close an unrelated terminal and report it as this task's. Restart the standalone `node src/server.mjs`, then quit and rebuild the packaged desktop app. Run only one backend: launch ownership is per-process, and on July 30 the two live instances were runtime-recovering each other's terminals. See [[resume-dispatch-audit]], [[terminal-close-review]], and [[codex-disposable-resume-review]].

> [!important]
> The desktop task queue now has an explicit **Import localhost** action. Standalone startup registers its task database through shared configuration; desktop copies only finished task outcomes, events, and task artifacts into desktop-local rows. Repeat imports refresh existing origins, continuation links are remapped, and queued or running work remains owned by localhost. Queue cards now use the project-canvas tint and the operational list has Today/Past ledger dividers without changing task order. See [[localhost-task-import]].

> [!important]
> Claude Continue-session delivery now uses exact evidence. `UserPromptSubmit` or the complete delivered user prompt confirms submission; `/compact`, compact summaries, restored attachments, arbitrary transcript bytes, and busy status do not. `PreCompact` and `PostCompact` keep the watcher live until one guarded submit can run. **Input needed** requires a current `AskUserQuestion`, and busy alone cannot claim that the question was answered. Current-turn hook output is isolated by `prompt_id`, and an unverified prompt cannot occupy a terminal for more than five minutes. Task 15 proved the old failure: compaction began at `16:01:00Z`, false input was reported at `16:02:23Z`, and the real prompt arrived only after manual Return at `16:07:28Z`. Finish active tasks, restart CC Relay, then run one live compaction smoke test. See [[claude-continuation-compaction-recovery-review]].

> [!important]
> Task Activity now renders Markdown in final Codex responses and live or final Claude responses. It reuses the HTML-safe renderer from the Result panel, with terminal-specific headings, lists, inline code, fenced code blocks, and blockquotes. Raw command output, tool output, protocol notes, and copied logs remain plain text. See [[terminal-markdown]].

> [!important]
> Claude Task Activity no longer waits only on the asynchronously persisted transcript. New CC Relay-owned sessions install token-scoped loopback HTTP hooks for live assistant text, tool starts, tool finishes, and final response; the endpoint acknowledges before dispatch so it does not delay Terminal.app. The transcript remains the durable fallback, now woken by native filesystem notifications instead of a fixed 800 ms sleep, while `claude agents --json` stays throttled. The measured old path had a 1.48 second median delay, an 11.4 second p90, and a 55.4 second maximum. Restart or rebuild CC Relay before validating. See [[claude-terminal-live-output]] and [[claude-terminal-visibility]].

> [!important]
> Task queue now has a date-gated AI-generated **Standup** action. Opening the modal performs no provider call. Choose Short, Standard, or Detailed, then select a browser-local day to start one isolated, non-persistent Codex or Claude CLI process. It never uses a task terminal. The AI groups saved prompts, responses, final results, and failures into separate Tasks and Blockers sections. Copy writes plain sectioned text with no Markdown hyphen prefixes. Exact Launchpad and Relay scope, outcome-day boundaries, 40-task source limits, a 120-second timeout, one global generation slot, no-tools provider isolation, Retry, Regenerate, and mixed-version capability gates are enforced. Generation creates no queue task or history row. See [[daily-standup]] and [[daily-standup-review]].

> [!important]
> Renderer startup must keep `renderPlanControls()` free of legacy bare `models` lookups. The Execute Council provider-order refactor renamed its catalogs to `codexModels` and `claudeModels`, but one obsolete `models.find(...)` stopped the synchronous first paint before any status or model request started. That also hid the current Codex and Claude provider tabs and exposed the legacy terminal controls. The stale block is removed and the startup-boundary regression is covered. See [[packaged-renderer-startup]].

> [!important]
> Execute Plan Council now has the same provider-order choice as Turbo Council: **Claude first** or **Codex first**. The first provider drafts and performs the final revision; the other provider reviews. Each provider keeps its own model and effort selection across order changes. `capabilities.planCouncilProviderOrder` protects mixed-version use, and the legacy database invariant remains `thread_id` for Codex plus `author_thread_id` for Claude regardless of role. See [[plan-council]] and [[execute-plan-council-provider-order-review]].

> [!important]
> The complete product display name is now **CC Relay**. Native bundle names, the macOS application and About menus, browser title, in-app brand, update prompts, generated notices, user-facing strings, documentation, and numbered terminal labels use that name. The npm package is `cc-relay`. Compatibility identifiers remain unchanged: `com.relay.queue`, command-line flags, code symbols, and the `dual-agent-orchestrator` application-data directory. The public repository and updater publisher are `Crowie-s-r-o/CC-Relay`. Release files use `CC-Relay-...` because electron-builder normalizes update-feed URLs to hyphens. See [[product-naming]] and [[desktop-updates]].

> [!important]
> Forward-planning Turbo now keeps its **Planning route** visible when Plan council is off. The collapsed route exposes one selectable Codex planning model and effort; enabling council expands the same route to two numbered provider stages. `#turbo-council-route` must remain rendered in the disabled state because `data-enabled="false"` hides only Claude and the connector. See [[turbo-execution]] and [[turbo-plan-council]].

> [!note]
> The macOS DMG now uses Finder's native `#e8eaef` background color and disables the mounted-volume icon. This removes `.background.tiff` and `.VolumeIcon.icns` entirely, so a user with hidden-file display enabled still sees only CC Relay and Applications. The volume title is `CC Relay`, with a balanced 640 by 380 two-icon layout. See [[dmg-presentation]] and [[desktop-updates]].

> [!important]
> macOS terminal grid placement now uses the primary screen's top edge when converting AppKit coordinates to Terminal.app coordinates and normalizes JXA's `{x, y, width, height}` window rectangles before occupied-cell detection. On the four-monitor reproducer, the former code mapped the primary usable top to 1470 instead of 30 and read every window as an empty object, so every launch selected cell zero and macOS clamped it to the bottom-left. Restart CC Relay before validating new launches. See [[macos-terminal-grid-coordinates]] and [[interface-layout]].

> [!important]
> Terminal behavior is isolated by exact project path. **Keep task terminals open** defaults to disabled for new projects and applies to new tasks immediately. Existing explicit project choices remain unchanged. Retention, legacy idle routing, grid dimensions, monitor, and minimized launch are persisted on each project row in `relay-config.sqlite`; a renderer paired with an older backend keeps the choice in that project's in-memory composer session without showing a restart requirement. The renderer does not use global localStorage for these choices, and a project with no saved layout receives clean defaults instead of inheriting the previous Launchpad's values. See [[project-terminal-settings]], [[retained-terminal-sessions]], and [[shared-project-configuration]].

> [!important]
> The desktop shell now uses a 58px header and a 44px single-row Launchpad, leaving the workspace `calc(100vh - 102px)`. Project cards are 176px by 30px, the composer uses an 18px compact scale, and the refreshed interface palette uses indigo, violet, teal, sky, pink, green, and Claude coral. Keep the header, dock, workspace, and task-list offsets synchronized. See [[compact-interface-density]], [[interface-layout]], and [[project-workspaces]].

> [!note]
> The Launchpad cards are now 176px wide and show only the folder name and current state. Unselected cards use a quiet 4 percent identity tint, rising to 7 percent on hover; the selected project keeps one crisp identity-color border, an 11 percent flat tint, and a quiet one-pixel shadow. Full paths remain available through the card title. See [[compact-interface-density]] and [[project-workspaces]].

> [!important]
> Every CC Relay-delivered Codex and Claude prompt now carries a final non-interactive notice. Providers are told that no answers can be supplied, so they must not ask questions, request approval, or wait for input. They should make reasonable assumptions and proceed, or report a blocker and end. Decoration happens only at provider delivery, leaving saved prompts and history unchanged, and covers Codex starts and steering plus visible, headless, Council, and Turbo Claude stages. Restart CC Relay normally to activate it. See [[non-interactive-relay-prompts]].

> [!important]
> Task 364's initialized Claude retry exposed a gap after the task 341 submit fix. A fresh UUID has no transcript file until its first prompt is accepted, but the guarded submit treated that known absence as an unreadable stat and never sent Return. Transcript sources now distinguish `absent` from `unreadable`; only a positively fresh and still-absent conversation may receive the one guarded action. Established or unreadable transcripts remain fail-closed. Task 370 later reproduced the old failure because the backend process started before the corrected modules were written and had not been restarted. Finish active tasks and restart CC Relay before validating the permanent fix. See [[claude-fresh-council-submit-recovery]].

> [!important]
> A fresh packaged Electron profile no longer freezes at the static composer placeholders. Provider tabs and automatic terminal controls now guard absent status, terminal-pool, and selected-project state before comparing paths or reading nested pool fields. The exact signed bundle was reloaded through Electron CDP with no active project: Codex controls populated, Claude selected on click, all Claude model and effort choices appeared, and the renderer recorded zero exceptions. See [[packaged-renderer-startup]].

> [!important]
> Localhost and desktop CC Relay now share one disk-backed Launchpad catalog without sharing their task queues. Pinned paths, provider limits, and the active project live in the per-user `relay-config.sqlite`; existing localhost projects migrate automatically even if an empty desktop database initialized the shared file first. Task rows, history, plans, artifacts, pause state, and terminal ownership remain isolated so two live schedulers cannot dispatch the same work. See [[shared-project-configuration]] and [[project-workspaces]].

> [!important]
> Packaged Electron startup no longer competes for fixed ports 4768 and 4769. The desktop process asks the operating system for available loopback ports for both its HTTP UI and shared Codex proxy, waits on an explicit server readiness promise, and loads the actual bound HTTP URL. Standalone `npm start` keeps the stable 4768 and 4769 endpoints. Electron lifecycle, server bind, window load, renderer exit, and shutdown events append to the desktop data root's `relay-diagnostics.jsonl`. See [[diagnostics]] and [[desktop-updates]].

> [!important]
> Disposable Plan council scheduling now follows the displayed provider limits inside its own project. Task 364 was incorrectly held while Agreau showed Codex 1 of 3 and Claude 0 of 1 because a legacy project-drain check ran before pool capacity. A current council may share the project with disposable Execute or breakdown work when the combined one-Codex and one-Claude reservation fits. It still owns the one global council slot, so another council or Turbo parent waits. Legacy persistent councils retain their drain barrier. Restart CC Relay after active work finishes, then retry task 364. See [[plan-council-capacity-scheduling-review]], [[parallel-project-queues]], and [[disposable-terminal-pools]].

> [!important]
> Tasks 364 and 370 proved that a disposable terminal can bind and save a provider ID before its first turn creates durable conversation state. Their first Claude prompts wrote no transcript, then retry launched `--resume` and failed with **No conversation found**. Task 364's unused Codex reviewer also has no rollout. Manual retry now initializes the same empty Claude UUID with `--session-id` and replaces an empty Codex reviewer with a fresh thread. Present or unreadable provider state keeps the fail-closed resume path, and Continue session never resets missing context. Restart the local backend after active work finishes, then retry both tasks. The desktop app built during this fix has only the Claude half and must be quit and rebuilt once more before desktop validation. See [[disposable-retry-conversation-initialization]], [[disposable-terminal-pools]], and [[plan-council]].

> [!important]
> Claude and Codex input questions now request native attention on macOS. CC Relay re-resolves the exact live process, TTY, one-tab Terminal.app window, centers it on its current display without resizing, restores and fronts it, and plays one alert. Claude uses its existing `claude/input-required` pause; Codex listens for both tool questions and MCP elicitation without changing fallback replies. Native work is best effort and never blocks provider monitoring. Restart CC Relay only after current running tasks finish. See [[terminal-input-attention]] and [[terminal-input-attention-review]].

> [!important]
> **Continue session** now preserves one task as one conversation. A finished disposable task reserves a free provider slot, relaunches its saved Claude or Codex conversation, and runs the follow-up under the source task ID. A live retained session still starts immediately. No continuation creates a task or changes Task Activity selection. The upper **Prompts** disclosure lists the original request and every accepted follow-up independently of the 500-event console window. Restart CC Relay before validating the backend path. See [[same-task-session-continuation]], [[task-history]], and [[disposable-terminal-pools]].

> [!note]
> The native Electron application now uses the Crowie logo from `build/icon.png` for development Dock display and packaged macOS and Windows icons. The top-left in-app brand mark and browser tab both use the matching Crowie artwork from `public/favicon.svg`. Existing app bundles retain Electron branding until they are rebuilt and reopened. The July 28 macOS app, ZIP, and DMG were rebuilt and verified to contain the same Crowie `icon.icns`. See [[desktop-updates]] and [[interface-layout]].

> [!important]
> Task 341 proved that a resumed Plan council revision can paste successfully but still remain unsent in Claude Code 2.1.220. An empty recovery `do script` reported success without moving the widget, while one transient busy sample on the next retry permanently suppressed recovery and produced a false **Input needed** state. The submit action is now nonempty and busy remains liveness only. Task 15 later tightened the contract again: only the exact complete delivered prompt proves submission, and **Input needed** requires a current `AskUserQuestion`. Rebuild and relaunch the packaged app before validating the fix. See [[claude-continuation-compaction-recovery-review]], [[claude-resumed-council-submit-review]], and [[claude-terminal-submit-review]].

> [!important]
> Automatic terminal tasks now have a remembered **Keep task terminals open** switch. Retained exact launches survive the task outcome and CC Relay shutdown, leave active pool capacity immediately, and stay available for a live same-window Continue or Retry. Automatic retries close intermediate attempts and retain only the final session. If the window was closed manually, Continue falls back to the existing resume launch. See [[retained-terminal-sessions]], [[disposable-terminal-pools]], and [[automatic-retry-safety]].

> [!important]
> CC Relay now detects Codex and Claude CLI installation independently and disables only providers confirmed missing. Signed-out CLIs remain installed and selectable, while pending or transiently failed probes stay neutral and retry automatically. A selected missing provider falls back to the installed alternative, and later Codex installation or sign-in starts the shared app-server automatically. See [[provider-installation-detection]], [[disposable-terminal-pools]], and [[task-add-reliability]].

> [!important]
> Disposable Codex continuation now binds through the exact new launch reservation even when an older client still reports the same saved conversation. Native recovery cannot steal a terminal while its launch is binding or resurrect an intentionally closed conversation from a draining proxy connection. A rejected or timed-out resume is closed exactly once and never retried automatically, so **Continue session** cannot fan out into repeated terminals. Restart CC Relay before manually retrying an affected continuation. See [[codex-disposable-resume-review]], [[disposable-terminal-pools]], and [[automatic-retry-safety]].

> [!important]
> macOS terminal cleanup now enumerates the freshly verified exact TTY with `ps -t <tty> -o pid=` and SIGKILLs exactly those identifiers with `kill -9`. On Darwin 25 the `-t` filter of `pgrep` and `pkill` matches nothing, so the previous `pkill` call killed no processes, the `pgrep` drain counted its empty results as success, and task 320 recorded a completed close whose live session was re-bound three seconds later. The same `ps` snapshot now drives the drain gate: two consecutive empty observations before the exact window closes, and a TTY that does not drain within two seconds stays open and retains ownership. Never reintroduce `pgrep -t` or `pkill -t` here. See [[terminal-close-review]].

> [!important]
> Claude sub-agent activity is now legible in the task console. An `Agent` tool call renders as a distinct **Sub-agent** signal carrying the agent name, its type, and a running, in background, or finished state instead of a generic connected-tool row. A backgrounded launch returns in milliseconds while the agent keeps working, so the real completion arrives later as a `queue-operation` task notification; CC Relay parses that into a `claude/agent-finished` event and resolves the launch by tool use id, deduplicating the identical enqueue and remove copies of one notification. The console counts live sub-agents beside its other signal counts; that count cannot go negative and clears when the turn ends. The record-level `toolUseResult` is authoritative for the backgrounded flag, so a synchronous agent whose own report quotes Claude's stock launch phrase is never filed as a live background agent. See [[claude-terminal-visibility]].

> [!important]
> Current queue submissions use per-project disposable terminal pools. The left composer panel sets maximum Codex and Claude instances from 1 through 8. A fresh task has no preselected session: CC Relay launches its required terminals only when capacity is available, binds each exact native launch, runs the task, and closes that launch at every terminal outcome. Finished direct tasks retain their saved conversation ID, so **Continue session** can relaunch Claude with `--resume` or Codex with `codex resume` under the same task ID. Existing persistent task rows retain legacy routing for compatibility. See [[disposable-terminal-pools]], [[project-workspaces]], and [[task-history]].

> [!important]
> A waiting automatic Execute task can now switch between Claude and Codex from **Edit**. The editor validates the destination model and effort. A provider change keeps the task, position, prompt, and images but clears provider-specific conversation identity and starts fresh. Legacy persistent tasks and workflow-owned Plan council, Turbo, and breakdown tasks cannot switch. Advertised as `capabilities.queuedTaskProviderSwitch`. See [[queued-provider-switching]].

> [!important]
> Execute Plan council now saves one durable Markdown file per completed stage: `draft.md`, `review.md`, and the canonical `plan.md`, all in the task's own `<project-root>/.data/tasks/<id>/`. `plan.json` remains the primary checkpoint, and a stage whose record field is empty, missing, or corrupt resumes from its file instead of paying for the stage twice. A record that kept the text but lost its file backfills it on the next resume. A changed brief discards both, so a stale draft can never be resumed. See [[plan-council]].

> [!important]
> Execute Plan council now saves its final Markdown under the source workspace at `<project-root>/.data/tasks/<id>/plan.md`, derived from the task's persisted `repo_path`. Internal `plan.json` checkpoints stay in CC Relay's data directory. Opening an older completed council migrates its final-only artifact and removes the former CC Relay-local copy. CC Relay does not edit the target project's `.gitignore`. See [[plan-council]] and [[project-workspaces]].

> [!important]
> Writable Codex Execute turns now reset both `thread/resume` and `turn/start` to explicit full access. Codex app-server persists a turn sandbox policy into subsequent turns, so the former omission allowed a read-only Plan council or Turbo stage to poison every later Execute task on that session even though CC Relay logged `readOnly: false`. Tasks 283 and 291 reproduced this on the Documi CC Relay. Planning remains explicitly read-only. Restart CC Relay to load the fix. See [[codex-sandbox-isolation]].

> [!important]
> Unsent work targeting a busy Claude terminal now stays **queued** instead of becoming falsely **running**. A synchronous dispatch guard reserves the session while preserving edit, cancel, reorder, and same-workspace Claude reassignment. The task starts only when the selected session is idle or idle routing moves it to another free Claude CC Relay. Task 284 proved why: `documi-ai-73` had a live background review agent and an existing terminal draft, so typing was unsafe, but the old scheduler still showed Live. Restart CC Relay to load the scheduler and `capabilities.queuedClaudeAssignment`. See [[claude-busy-dispatch]] and [[parallel-project-queues]].

> [!important]
> Adding a task is now local-validation-only and never blocks on a provider CLI. `ClaudeRuntimeStatus.current()` and the Codex probe are cache reads refreshed in the background with bounded async probes; they were `execFileSync` with no timeout, which blocked the whole event loop on every Claude, Plan council, and Turbo submission. Claude session discovery keeps its **last known good** list on a transient failure instead of caching an empty one, which is what used to make live sessions vanish and reject the add. The add path reads warm caches and falls back to last-known-good, then to the workspace from that session's previous task; it rejects only a session CC Relay has never seen. Claude auth blocks an add only on a completed signed-out probe, never on a pending or errored one. Restart CC Relay to load it. See [[task-add-reliability]].

> [!important]
> Idle-CC Relay routing now happens at **dispatch**, not in the browser before posting. The client posts immediately with `preferIdleTerminal`; the server keeps the selected session when it is free and otherwise moves the task to a free idle session of the same provider in the same workspace, never crossing a workspace. Persisted as `prefer_idle_terminal`, advertised as `capabilities.dispatchIdleRouting`. Guard rail: `schedule()` runs `runNext()` and `planAhead()` in one tick and `planAhead()` depends on state `runner.run()` writes synchronously, so routing is gated behind a synchronous `shouldRouteIdle()` check. An unconditional `await` before `runner.run()` silently disables Turbo forward planning. See [[parallel-project-queues]].

> [!note]
> `ClaudeRunner` keys plan stages per owner. It previously held one global slot and its `cancel()` ignored its argument, so a Plan council stage timeout stopped whichever Claude stage was newest. Plan council itself stays deliberately globally exclusive through its single-task fields and `sharedExclusiveAvailable`. Current disposable councils can still share their own project with disposable single-session work when provider capacity fits. See [[parallel-project-queues]].

> [!important]
> A completed Execute Plan council promotes implementation as visible step **04** directly after the council stages. Task Activity also provides a primary **Execute plan** shortcut that scrolls and focuses this handoff. The user chooses Codex or Claude, and CC Relay creates a linked disposable Execute task in the source project without changing or automatically running the reviewed plan. See [[plan-council]] and [[interface-layout]].

> [!important]
> A terminal-driven Claude Execute task now stays running when the interactive session becomes idle without a final transcript record. That state can mean `AskUserQuestion` is waiting in Terminal.app and Claude may not flush the question record until after the answer. CC Relay emits **Input needed**, keeps the exact task and session reserved, resumes mirroring after the terminal answer, and still stops on cancellation, terminal closure, or the 45-minute inactivity ceiling. That ceiling now measures continuous inactivity instead of total turn time, so a session that keeps working never fails on duration alone (task 320) while an unanswered prompt still releases its task after a full idle window. Task 270 exposed the former four-poll false failure. See [[claude-terminal-input]] and [[claude-terminal-visibility]].

> [!important]
> Direct Claude Execute runs the turn **inside** the interactive terminal on macOS when CC Relay owns an exactly resolvable single-tab Terminal.app window for the session. Before typing a configured task, CC Relay verifies the live session id, pid, workspace, window, and tty, stops only that Claude pid, and restores the same UUID in the same tab with the pinned Claude binary plus the selected `--model` and `--effort`. It waits for the replacement pid to register idle, re-verifies the terminal, types a bracketed-paste prompt through `osascript`, and mirrors the session `.jsonl` transcript into Task Activity. If no busy or transcript evidence appears after 1.5 seconds, CC Relay re-verifies again and sends at most one separate Return. Every ambiguous relaunch or post-injection failure is non-retryable, so CC Relay never repeats a launch or prompt automatically. Three real Terminal.app turns on July 25 proved fresh, resumed, and 281-line visible submission with Opus at max effort. Non-darwin and unowned direct sessions keep the headless path. A current macOS Plan council now requires this terminal path instead of falling back. See [[claude-terminal-visibility]], [[claude-terminal-settings-review]], [[claude-terminal-submit-review]], and [[diagnostics]].

> [!warning]
> Terminal cleanup hazard, learned the hard way (July 24, 2026): macOS recycles tty names, so a tty captured earlier can point at a different session later. Never kill, close, or send to a terminal by a stale tty name; verify live session identity (session id, pid, and cwd) at action time. A spike cleanup that violated this killed an unrelated Claude session. See [[claude-terminal-visibility]].

> [!note]
> **August 12 licensing correction: CC Relay is source-available under PolyForm Noncommercial 1.0.0.** The brief MIT state is superseded for newly offered versions, while copies already received under MIT retain those rights. Package metadata, public documentation, and the release process use the PolyForm contract. See [[licensing]] and [[open-source-releases]].

> [!note]
> The Planner is a per-project saved plan library reached from the composer heading. Its AI breakdown enqueues an ordinary `mode: 'breakdown'` queue task on a chosen live session, parses the structured output tolerantly, and stores review-before-queue proposals on the plan. `breakdownUpdateForTask` is a reconciler (self-heals `failed -> running -> complete`, never clobbers user edits). Backend advertises `capabilities.planner`; an older running backend shows **Restart CC Relay to use the Planner**. See [[planner]].

> [!important]
> Planner v2 turns the Planner into an orchestrator. The breakdown contract now returns `{id, title, prompt, dependsOn}` and stores **resolved internal proposal ids** in `dependsOn`, never the model's labels; unknown refs, self-refs, and cycle-closing edges are pruned deterministically with a note on the breakdown row. A **plan run** (`POST /api/plans/:id/run`, `/run/stop`) is a reconciler hooked to the queue `changed` listener, not a second scheduler: a step whose dependencies are complete becomes an ordinary `mode: 'execute'` task through `queue.enqueue`, carrying `preferIdleTerminal` so independent steps fan out across idle same-workspace sessions. Each step's submission id is a deterministic hash of plan+run+proposal, which is what makes re-entry (enqueue emits `changed` synchronously) impossible to double-enqueue. `blocked` and a `failed` run are derived every pass, never latched, so the ordinary task retry is the un-block mechanism; `stopped` is the one latched status. Boot order is `queue.start()` then `planRuns.reconcileAll()`. Advertised as `capabilities.plannerV2`. See [[planner]].

> [!warning]
> Guard-before-await is a real bug shape in `src/server.mjs`, not a theoretical one. A route that validates, then awaits the request body, a live session, or the model list, and only then writes, can be cleared twice by two overlapping submissions (second tab, double dispatch). Planner v2 found it on `POST /api/plans/:id/run` (would have minted two task sets for one plan) and on both breakdown routes. The fix is to re-check synchronously immediately before the write, ideally inside the module that owns the invariant so it defends itself: `planRuns.startConflict()` runs again inside `start()`, and `requireNoBreakdownInProgress` runs again right before `createPlanBreakdown`. A guard carrying `statusCode` on the error reaches the client with the right code through the generic handler. See [[planner]].

> [!warning]
> Deleting a queued Planner breakdown task used to be a **silent permanent plan lockout**: the breakdown row stayed `pending` forever, so every planner route refused work until the plan was deleted. Deletion is still allowed and now marks the row `failed`, and the parallel Codex batch route rejects any non-`execute` mode instead of deleting a breakdown, council, or Turbo task out from under its owner. See [[planner]].

> [!warning]
> `mode: 'breakdown'` is **no longer globally exclusive**. `TaskQueue.isSingleSessionTask` replaced `isDirectExecutionTask` at all five scheduling and reservation sites, so a breakdown serializes only on its own session. The load-bearing half is `reservedThreadIds()`: a running breakdown now reserves its own session, and without that, dropping exclusivity would let a second task start on the session it is using. `planAhead()` had to learn the same reservation, because Turbo look-ahead starts a real turn on its planner session and previously only avoided Turbo's own threads. Turbo and legacy persistent council barriers are pinned by `test/breakdown-scheduling.test.mjs`; current disposable council capacity sharing is pinned separately. See [[planner]] and [[parallel-project-queues]].

> [!note]
> `escapeHtml` (now `public/escape-html.js`) is a pure helper that also escapes `"` and `'`, closing an attribute-injection XSS path (Finding 19). Use it for every attribute interpolation. A Content-Security-Policy for the local UI remains a tracked backlog item. See [[diagnostics]].

> [!note]
> The launchpad now treats pinned projects as selectable workspace cards. See [[project-workspaces]].

> [!note]
> One Launchpad is always selected whenever pinned projects exist. Activating it again keeps it selected, stale selection recovery chooses an available project, and the final pinned project cannot be removed. There is no **All Projects** state. See [[project-workspaces]].

> [!note]
> Launchpad cards are project selectors and live status surfaces, not provider launch surfaces. They contain no Codex or Claude buttons. Each card leads with **Running**, **Waiting**, **Restart needed**, **Attention**, or **Idle**, followed by task detail. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> The Launchpad desktop band is 44px high with its heading, project list, and actions on one row. Each 176px by 30px card keeps its folder name and current state on that row, and the rail scrolls horizontally when needed. Color hashing resolves collisions across visible projects, so up to eight automatically colored pinned projects use distinct palette colors; the matching global running-task card shares the resolved project identity. See [[compact-interface-density]], [[project-workspaces]], and [[interface-layout]].

> [!note]
> Project identity is deliberately stronger across the Launchpad and global running-task feed. Each Launchpad card has a solid accent initial, colored project name, mixed-color outline, and soft identity wash; selection strengthens the complete outline and wash. Running-task cards reuse the same accent for their wash, outline, task number, dot, and separately colored project name, while the CC Relay name stays neutral. Neither surface uses a full-height accent edge or gradient. All six accents retain at least 4.5:1 text contrast on the strongest tint and exclude Claude coral. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Project-card unpin is a dedicated final grid column at the far-right edge. Keep it outside the name sub-grid; nesting it inside `.project-chip-head` visibly places the close control in the middle. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Task records persist in SQLite. The selected Launchpad project always bounds the visible queue and history; switching projects immediately swaps task cards, counts, and statistics. See [[task-history]].

> [!note]
> Launchpads own independent queue positions, reorder validation, priority and retry ordering, pause state, selected execution terminal, and in-memory composer drafts including prompt text and reference images. Queue and History are always bounded by the selected Launchpad. See [[project-workspaces]] and [[task-history]].

> [!important]
> Project queue isolation is backend behavior and cannot hot-reload with renderer assets. The current backend advertises `capabilities.projectQueueIsolation`; when it is absent, a waiting project blocked by work elsewhere says **Restart CC Relay for separate project queues**. Task 184 on July 20, 2026 exposed a July 17 backend still running the former global barrier. See [[project-queue-isolation-review]].

> [!note]
> Signed packaged macOS and installed Windows builds check GitHub's stable latest release after startup and every five minutes, download it in the background, and install it after a graceful restart or normal quit. Windows portable shows the exact release as a manual download. Development remains ineligible. See [[desktop-updates]].

> [!important]
> `electron-updater` 6.8.9 must be default-imported from the ESM Electron entry point because its CommonJS `autoUpdater` export is a runtime getter that Electron cannot discover as a named export. Also run only one electron-builder process per checkout: overlapping builds mutate the same `dist/mac-arm64` bundle and can fail with `ENOTEMPTY` or a missing app during signing. See [[desktop-updates]] and [[desktop-packaging-review]].

> [!note]
> The task panel has a read-only date ledger with day, Monday-based week, and month navigation plus total, completed, success-rate, runtime, and activity statistics. It always includes every CC Relay in the selected project. See [[task-history]].

> Successful composer submission always returns to **Queue**, selects the new task, and opens its Task Activity details. See [[task-history]].

> [!note]
> Each Launchpad now remembers its selected Task Activity task for the current browser session. Switching projects restores the prior selection only after validating that the task belongs to the incoming project's exact path; stale or deleted selections remain empty. See [[project-workspaces]] and [[task-history]].

> [!important]
> Composer submission is idempotent. The browser locks before asynchronous idle routing, retains one UUID for an unchanged intent through ambiguous failures, and the backend requires and uniquely persists that UUID. Repeated delivery returns the original task instead of creating another row. Restart CC Relay to load the database migration and server guard. See [[task-history]] and [[duplicate-submission-review]].

> [!note]
> Repeated Enter while the composer already shows **Adding task** is a quiet no-op. The disabled button during submission is progress, not evidence that the selected CC Relay disconnected. The screenshot attached to task 274 captured a second Enter replacing progress with a false missing-terminal error. The earlier pictured prompt never reached the API, while the report task itself was accepted immediately on the same CC Relay. See [[task-history]].

> [!note]
> Queue, History, and Standup always include every CC Relay in the selected project. The obsolete **All Relays** queue-header button, **This CC Relay** alternative, and renderer scope state were removed. Selecting an execution terminal never narrows task visibility. See [[task-history]].

> [!note]
> Task queues follow the selected Launchpad project and always use the complete project view. Workspace columns are user-resizable, and launch/send diagnostics are persisted locally. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> The header center is a global horizontally scrollable feed containing only currently running tasks across every project. Each card shows project, CC Relay, duration, prompt, and the latest actual Codex or Claude response; selecting it opens that task in its project. Queue and History remain project-scoped. See [[interface-layout]] and [[project-workspaces]].

> [!note]
> The July 28 density pass keeps the header running feed as a compact three-tier meta, prompt, and response grid while shrinking the desktop header to 58px. The Launchpad is a 44px workspace rail with one 30px project-card row. At 900px and below the list moves to a second row. Composer spacing and lifecycle copy were reduced without removing controls. See [[compact-interface-density]] and [[interface-layout]].

> [!note]
> Terminal output now uses the refined execution-ledger hierarchy documented in [[interface-layout]].

> [!note]
> The right-side Task Activity terminal defaults to **All**, including messages, commands, tools, and streamed reasoning summaries. See [[interface-layout]].

> Task Activity now shows Codex reasoning output usage as **thinking tokens**, uses a compressed task header, and has a persisted draggable horizontal split for terminal height. See [[interface-layout]].

> [!note]
> Direct Codex and Claude Task Activity views include a compact **Continue session** dock. A running Codex task updates its exact active turn through `turn/steer`; a running interactive Claude task queues the message through exact terminal steering; and a finished task starts the next turn in the same saved conversation and task ID. None of these paths creates queue work or changes selection. Busy, offline, unsupported headless, and full-capacity states reject submission, and older backends without the matching capability show **Restart required** instead of falling back to a normal task. See [[claude-live-steering-review]], [[same-task-session-continuation]], [[task-history]], [[interface-layout]], and [[project-workspaces]].

> [!note]
> Continue session accepts PNG, JPEG, and WebP images through **Add images** or clipboard paste. Finished Codex and Claude turns receive only the new images, running Codex sends them through exact-turn steering, and older backends without `taskFollowUpAttachments` keep the image control disabled. See [[task-history]] and [[interface-layout]].

> [!note]
> The follow-up image action is now an intentionally faint icon beside Send. Its grid accounts for the generated terminal caret, so the textarea retains the available width and Send stays on the same row. Empty image metadata is hidden. See [[interface-layout]].

> [!note]
> Live terminal polling preserves the nested scroll position of expanded command output. Output follows appended lines only when its own scroller was already at the bottom. See [[interface-layout]].

> [!note]
> Expanded command output uses an explicit opaque `#0c0e17` surface so the app-wide light `pre` styling can never produce a white block inside Task Activity. See [[interface-layout]].

> [!warning]
> The current renderer can freeze during live activity because each SSE or polling refresh rebuilds an unbounded task list, rebuilds the selected task event stream, and performs layout measurements around those replacements. `loadSnapshot()` also rebuilds the task list twice when a task is selected. An Eyeo ad-filtering extension can amplify the DOM-mutation cost, while synchronous Claude CLI status checks add a separate five-second backend pause. See [[renderer-performance]].

> [!note]
> Direct execution keeps the compact effort slider. Model and effort are retained independently for every Codex and Claude CC Relay terminal, and slider indices are mapped to exact supported effort strings at submission. Explicit choices seed newly discovered terminals for that provider. See [[interface-layout]].

> [!note]
> Fresh and newly selected models now default to `high` effort whenever the model supports it, across Codex and Claude. Models without `high` retain a valid provider fallback, while persisted tasks and unsent user choices remain unchanged. See [[interface-layout]].

> [!important]
> A newly bound disposable Claude task no longer overwrites a fresh provider-level effort choice during the two-second task refresh. Provider and terminal settings now use monotonic `default`, `task`, and `user` provenance independently, and slider input repaints its presentation without resetting the native range control. This fixes the effort selector appearing to need repeated selection. See [[interface-layout]] and [[disposable-terminal-pools]].

> [!note]
> Direct submission snapshots effort before idle-CC Relay discovery, then remembers the server-accepted model and effort on the actual destination terminal. This keeps the composer at the task's accepted effort after enqueue, including when idle routing changes Relays. See [[interface-layout]].

> [!note]
> Per-terminal effort state distinguishes provisional defaults, persisted task values, and unsent user choices. Task history replaces only provisional defaults; polling never replaces a user choice. This fixes the startup race where task 171 showed `xhigh` while its CC Relay slider showed `low`. See [[interface-layout]].

> [!note]
> Current direct execution Model and Effort controls render below the automatic pool controls and belong to the selected provider in the active project. A legacy backend renders them below its CC Relay picker. See [[interface-layout]].

> [!note]
> **Run in parallel** is a legacy persistent-task action that bundles selected waiting tasks into one numbered Codex command sent to the selected Codex terminal. Disposable work uses project limits or Turbo instead. See [[task-history]].

> [!note]
> Forward-planning Turbo now uses one fresh read-only planner followed by one different fresh executor for each prompt. The complete graph goes to that single executor, which may use internal sub-agents. The numeric setting controls concurrent planned prompts across the queue, and the project maximum must fit that many execution lanes plus one planning lane. See [[turbo-execution]] and [[disposable-terminal-pools]].

> [!note]
> Turbo queue cards show **Forward plan**, **Planning ahead**, **Plan ready**, or **Executor running** alongside the canonical queue status. A fresh planner can prepare queued Turbo work whenever project Codex capacity is free, even before another Turbo parent runs. Planning does not change queue position or start execution early. See [[turbo-execution]].

> [!note]
> Current automatic Turbo cards show two explicit stages, Planning and Execution, with their model, effort, fresh-session contract, and queue concurrency. The detail graph keeps checked, loading, blocked, and failed tickets, all attributed to the one executor conversation. See [[turbo-execution]] and [[interface-layout]].

> [!note]
> Turbo dispatch tickets use uniform outlines without colored left borders. The running spinner keeps a continuous phase across live graph rerenders so polling cannot make it appear frozen. See [[interface-layout]].

> [!note]
> Turbo dispatch tickets use the final `.turbo-graph-*` layout exclusively. Broad legacy article and direct-child span selectors break the compact state, copy, and CC Relay ownership grid and must not be restored. See [[interface-layout]].

> [!note]
> An active Turbo graph with no packages displays **Planning dependency graph** with an indeterminate accessible animation and skeleton tickets instead of `0 / 0 complete`. The task marker remains **Planning graph** until execution actually begins. See [[turbo-execution]] and [[interface-layout]].

> [!note]
> Turbo Plan council matches the standalone council card design and lets the user choose **Codex first** or **Claude first**. The first provider authors the graph and the second validates it before the single executor starts. See [[turbo-plan-council]], [[turbo-execution]], and [[interface-layout]].

> [!important]
> Council capability does not imply Claude authentication. CC Relay distinguishes an installed but signed-out Claude CLI from an old backend, preserves `loggedIn: false` JSON even when `claude auth status --json` exits with code 1, and rechecks authentication while running. Use `claude auth login`; Council enables automatically after sign-in without another restart. See [[diagnostics]].

> [!important]
> Execute Plan council is a checkpointed Claude author, Codex reviewer, Claude revision state machine. Failures never retry automatically. Manual resume preserves completed stages, each active stage emits heartbeats, and the final deliverable is one canonical `<project-root>/.data/tasks/<id>/plan.md`. See [[plan-council]] and [[diagnostics]].

> [!note]
> A completed Execute Plan council can be queued on any selected Codex or Claude CC Relay in the same workspace. The linked Execute task receives the original request, final reviewed plan, canonical file path, and copied reference images. Planning completion never starts implementation automatically. See [[plan-council]] and [[task-history]].

> [!note]
> The completed-plan panel keeps the project-local `plan.md` path visible and offers Codex or Claude execution through the project's disposable pool. An older backend uses the opened-CC Relay selector. Task 194 was canonicalized to final-only `plan.md` with no duplicate `result.md`. See [[plan-council]] and [[plan-council-review]].

> [!note]
> Both optional Plan council entry cards use the same shared component, primary label, compact neutral review shell, and interaction states in Execute and Forward-planning Turbo. Turbo adds only its help disclosure and workflow-specific supporting sentence. See [[interface-layout]].

> [!note]
> Execute and Turbo Plan council now share the complete refined surface: neutral rounded shell, single checked-state focus treatment, provider-accented route nodes, rounded settings, and a central arrow handoff. Disabled routes are hidden consistently. Execute retains only its revision and readiness details; Turbo retains only order selection and help. See [[interface-layout]].

> [!note]
> Ctrl+Enter is labeled **Run now** and prioritizes a new submission inside the active project without bypassing provider limits or interrupting active work. The selected-CC Relay and idle-routing behavior remains only for legacy persistent submissions. See [[task-history]].

> [!note]
> Newly launched Codex terminals can accept their first CC Relay task even before Codex has persisted a rollout. CC Relay falls through from the expected `thread/resume` missing-rollout error to `turn/start`. See [[project-workspaces]].

> [!note]
> After that first `turn/start`, CC Relay resumes the fresh thread again to subscribe to live output. This keeps the first task's Task Activity stream populated instead of relying only on final-result polling. See [[project-workspaces]].

> [!note]
> Fresh-thread subscription now retries both missing and temporarily empty rollouts without showing a Terminal warning. Polling remains the completion fallback. See [[project-workspaces]] and [[diagnostics]].

> [!note]
> Queue recovery and dispatch start only after CC Relay successfully binds port 4768. A duplicate server start now exits on `EADDRINUSE` without interrupting active work or orphaning the next task as running. See [[diagnostics]].

> [!note]
> The **Connect another Codex terminal** disclosure now stays open across silent terminal polling. The populated-terminal render path must preserve the user's disclosure state. See [[project-workspaces]].

> [!note]
> Queue and terminal state refresh automatically. The interface intentionally has no manual Refresh buttons, and connection copy should describe automatic discovery. See [[interface-layout]].

> [!note]
> Connected Codex terminals are still numbered for legacy history and manually launched interactive sessions. Current disposable tasks cannot be assigned or dropped onto one of them. See [[task-history]] and [[interface-layout]].

> [!note]
> Legacy idle-terminal routing gives a newly launched CC Relay up to three seconds to connect when the selected CC Relay is busy. Current disposable routing instead reserves project capacity and binds the exact task-owned launch. See [[task-history]].

> [!note]
> CC Relay numbers and names are persisted per Codex thread and remain unchanged when terminals reconnect, disconnect, or are reordered. See [[task-history]].

> [!note]
> While automatic Turbo executes, queued direct Codex and Claude work can use free provider slots. Claude no longer waits behind Codex Turbo when its own project limit has capacity. Several ready Turbo parents may each run one executor up to the configured queue concurrency, while Plan council and legacy exclusive workflows retain their barriers. See [[turbo-execution]] and [[task-history]].

> [!note]
> Direct Codex tasks run concurrently across distinct CC Relay terminals while remaining sequential per terminal. Current disposable Plan councils share unused provider capacity even inside their own project. Automatic Turbo is queue-concurrent and owns one executor terminal per parent; legacy persistent workflow barriers remain. See [[project-workspaces]], [[task-history]], and [[plan-council-capacity-scheduling-review]].

> [!note]
> Direct Claude tasks now execute concurrently on distinct Claude session IDs and remain sequential within each session. The idle CC Relay preference routes Claude submissions to an unassigned idle Claude session in the same workspace when the backend advertises `parallelClaudeExecution`. Direct Codex and Claude work can run beside a disposable Plan council only while the combined provider limits fit. Restart CC Relay to load scheduler changes. See [[task-history]], [[project-workspaces]], and [[parallel-claude-review]].

> [!note]
> CC Relay pins one exact `claude` binary at startup (`src/claude-binary.mjs`) instead of trusting bare `PATH` order, which selected an outdated binary and silently returned no live Claude sessions when CC Relay was launched from Finder or the dock. The resolver probes every candidate with `--version` and picks the highest version; discovery, execution, runtime status, and the launched terminal command all use the pinned absolute path. Watch `claude.binary.resolved` and `claude.binary.fallback`. Restart CC Relay to load the resolver. See [[claude-terminal-visibility]] and [[diagnostics]].

> [!note]
> Cross-project direct execution has no CC Relay project-count limit. Generated coverage runs one Codex and one Claude task simultaneously across twelve projects, with twelve serving only as a practical test size. An older backend that queues Claude behind another project's session shows a targeted restart warning. See [[project-workspaces]] and [[parallel-claude-review]].

> [!note]
> Fresh disposable Execute tasks intentionally have no assigned session and always start a new conversation in a new terminal. Retries and explicit continuations relaunch and resume the saved conversation. Legacy persistent Execute tasks retain assigned-session and idle-routing behavior. See [[task-history]], [[project-workspaces]], and [[disposable-terminal-pools]].

> [!note]
> A freshly launched Claude terminal can be discovered before its first transcript exists. Direct execution now handles that exact resume failure by starting the first task with the same session UUID after verifying the live interactive process and workspace. Expected probe stderr is suppressed; stale, background-only, cross-workspace, and cancelled sessions never start the fallback. Discovery still deduplicates repeated IDs and prefers the interactive terminal. See [[project-workspaces]], [[diagnostics]], and [[claude-fresh-session-review]].

> [!note]
> Current Execute Plan council requires one Claude slot and one Codex slot in the selected project. CC Relay can reserve them beside disposable single-session work when both provider limits fit, launches and binds both exact terminals automatically, runs the three-stage read-only route, and closes them at the terminal outcome. Older backends retain explicit terminal assignment or the isolated CLI route. See [[plan-council]], [[diagnostics]], [[interface-layout]], and [[disposable-terminal-pools]].

> [!note]
> Composer routing follows the visibly selected workflow and provider. The only workflow tabs are Execute and Forward-planning Turbo. Plan council is an explicit per-prompt option inside both, and inconsistent visual and internal selection is rejected. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> Execute Plan council is explicitly off by default. Its two-provider route appears only after the user enables the per-prompt switch, and the server rejects internal plan submissions without that opt-in. The old standalone workflow tab has been removed. See [[task-history]] and [[interface-layout]].

> [!note]
> Execute Plan council selects Codex for its review CC Relay but does not lock the provider tabs. Choosing Claude turns the council option off and switches to direct Claude execution. See [[task-history]] and [[interface-layout]].

> [!note]
> Terminal Settings must not introduce a nested form inside `#task-form`. Its panel uses an explicit dialog close action so the prompt, image picker, and submit button remain owned by the task form. See [[diagnostics]].

> [!note]
> Project cards and numbered CC Relay cards now expose live task activity, including running prompts, waiting counts, Turbo roles, attention-needed outcomes, and idle readiness. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Numbered CC Relay selector cards have stable per-number accent colors. Task cards remain neutral and show ownership through their CC Relay name only; activity badges sit beneath the provider icon at the lower left without adding card height. See [[interface-layout]].

> [!note]
> The selected CC Relay selector always uses a blue border, subtle blue background, and blue radio mark while retaining its per-number title color. See [[interface-layout]].

> [!note]
> Task cards use the reference footer: one divider, execution and workspace metadata on the left, and status dot, duration, and compact timestamp on the right. See [[interface-layout]].

> [!note]
> A task can contain up to 99 reference images while retaining the 5 MB per-image and 20 MB combined limits. See [[interface-layout]].

> [!note]
> Codex and Claude terminal launches share one window grid. Bounds are reapplied after CLI startup so Claude cannot resize itself out of the selected cell. See [[interface-layout]].

> [!note]
> Terminal launch is now a compact button with adjacent settings. The modal owns the launch command, grid controls, and a persisted option that opens only the new terminal window minimized. Diagnostics are not exposed in this dialog. See [[interface-layout]] and [[diagnostics]].

> [!note]
> Current Direct Execute shows Codex and Claude provider tabs plus the selected project's maximum and active instance counts. It does not require a live-session picker. Fresh work opens a new provider terminal only when a queue slot is available, then closes that exact owned terminal when the task ends. Legacy backends retain the live-session picker and manual launch buttons. See [[disposable-terminal-pools]], [[interface-layout]], and [[project-workspaces]].

> [!note]
> Native Codex launches reserve the selected workspace for the next proxy client, and the proxy applies it to `thread/start.cwd`. Shell `cd` and Codex `--cd` are insufficient with Codex CLI 0.144.5, while workspace metadata in the WebSocket URL is rejected by that CLI. See [[project-workspaces]].

> [!note]
> Closing CC Relay now waits for queued work to stop, then closes only native terminal windows or process trees launched by that CC Relay process before the backend and Electron app exit. Normal quit and update installation share this exact-ID cleanup path. See [[project-workspaces]], [[desktop-updates]], and [[diagnostics]].

> [!note]
> Current queued work closes its exact task-owned native launch automatically at the terminal outcome. The guarded selected-CC Relay **Close** action remains a legacy compatibility control for manually launched terminals with exact native identity. See [[disposable-terminal-pools]], [[project-workspaces]], [[interface-layout]], and [[diagnostics]].

> [!note]
> On a current backend, the composer replaces the selected-terminal controls with per-project Codex and Claude maximum instance controls. **Close selected terminal** appears only in the legacy compatibility UI. See [[disposable-terminal-pools]], [[terminal-close-review]], and [[interface-layout]].

> [!important]
> macOS terminal Close must terminate every process on the exact verified one-tab TTY before closing its exact Terminal.app window. Closing the window first triggers Terminal.app's running-process confirmation and does not complete automatically. Explicit Close and CC Relay shutdown share this sequence. See [[terminal-close-review]].

> [!note]
> Codex terminals still connect to the fixed public proxy on `4769`, while the browser uses HTTP port `4768`. CC Relay now gives its private Codex app-server an operating-system-assigned port, connects only to the endpoint advertised by its newly spawned child, and waits for the public proxy before opening a native terminal. This prevents orphaned internal port owners from causing terminal connection failures. See [[diagnostics]] and [[project-workspaces]].

> [!note]
> If a newly launched Codex terminal does not connect within the bounded launch wait, CC Relay now reports that it could not open a Codex CC Relay and conditionally points to a required Codex update visible in the terminal. See [[diagnostics]].

> [!note]
> Task badges and footer dots have distinct final-cascade colors for running, queued, complete, failed or interrupted, and cancelled states. See [[interface-layout]].

> [!note]
> Orange is reserved for Claude identity. Generic running state is purple across task cards, CC Relay badges, project activity, header activity, task events, and planning stages. CC Relay 4 now uses sky blue instead of orange, and the stylesheet no longer exposes legacy amber tokens. See [[interface-layout]].

> [!note]
> The Queue view orders running work first, queued work by manual queue position, and terminal outcomes newest first. Historical queue positions must not sort completed tasks. See [[task-history]].

> [!note]
> Queued task cards now match execution order from top to bottom: the oldest or manually promoted task is at the top, and a normal new task is appended at the bottom. **Run now** remains the explicit Ctrl+Enter priority exception. See [[task-history]].

> [!note]
> Waiting tasks can now edit their request from Task Activity. Saving preserves task identity, queue position, routing, execution settings, and images; a task that already started or entered active Turbo preparation rejects the edit. See [[task-history]].

> [!note]
> Queue reordering starts from the card grip and uses one immutable global-plus-visible snapshot. Only visible tasks replace their original global slots; a stale `expectedTaskIds` request is rejected atomically and refreshed. Assignment drops onto CC Relay cards remain separate. See [[task-history]].

> [!note]
> Task Activity now provides **Copy** for Prompt, Result, Claude draft, Codex review, and Final revised plan. Prompt and Result keep Copy directly available beside **View** even when their disclosures are collapsed, and copying does not toggle the disclosure. Plan outputs copy their stored raw Markdown, pending outputs stay disabled, and task selection clears stale copy payloads. See [[interface-layout]] and [[plan-council]].

> [!note]
> Direct Codex and Claude response text in Task Activity now uses a stronger 650 weight. Commands, reasoning, and protocol messages remain regular weight. See [[interface-layout]].

> [!warning]
> A disconnected Codex terminal is a non-retryable failure. All remaining direct and Turbo automatic retry chains stop after three retries, then wait for manual action. Task 216 proved why both the runner classification and queue-level cap are required. See [[automatic-retry-safety]] and [[diagnostics]].

> [!note]
> A visual polish pass finished the green to blue accent migration in the app chrome. Residual green hover, selected-tint, and empty-state values are neutralized to the cool blue and neutral system, the `--blue` and `--muted` token gaps are closed (restoring the parallel batch bar stripe and checkbox accents), app-chrome controls share one quiet transition, and the primary action gets a single soft lift. Residual green hovers were edited in place, not appended, to preserve the selected-on-hover accent. The dark terminal ledger is unchanged. See [[interface-layout]].

> [!note]
> Task Activity Result now renders escaped Markdown instead of showing source punctuation in a plain-text block. Its preview is punctuation-free, Copy still returns raw source Markdown, and the Result body has a larger 12.5px, 320px reading surface without changing the compact Prompt disclosure. See [[interface-layout]] and [[diagnostics]].

#relay #hot
