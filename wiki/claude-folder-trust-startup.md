---
name: Claude Folder Trust Startup
description: How Relay safely clears Claude Code's first-use workspace trust prompt before session discovery and task delivery.
type: architecture
tags:
  - relay
  - claude
  - terminal
  - launchpad
  - recovery
---

# Claude Folder Trust Startup

> [!important]
> A new Claude Code workspace can stop at its folder trust prompt before the session appears in
> `claude agents --json`. Relay now recognizes that exact prompt on the exact Terminal.app window
> it just launched, chooses **Yes, I trust this folder**, and then gives Claude a fresh session
> binding window. Unknown, changed, unreadable, or non-owned screens receive no input.

## Why tasks failed

Claude Code can show a first-use safety dialog before drawing its composer:

```text
Accessing workspace:

Quick safety check: Is this a project you created or one you trust?
Claude Code'll be able to read, edit, and execute files here.

❯ 1. Yes, I trust this folder
  2. No, continue without these permissions
  3. No, exit

Enter to confirm · Esc to cancel
```

Older Claude Code builds used a two-option form whose second option was `No, exit`. The interactive
session is not discoverable while either form is open. This means executor-only handling is too
late: [[claude-terminal-visibility|session discovery]] can time out before a task obtains an
executor.

## Scope and authority

A Relay launch already carries an explicit project selected in Launchpad. `validateProjectPath()`
resolves that project to one real directory, the native launch command changes into that exact
directory, and Relay starts Claude there for unattended provider work. Confirming the recognized
trust prompt for that task-owned launch stays inside the selected workspace and the authority the
operator already gave the task.

Relay does not edit Claude's configuration file, seed trust globally, add an environment variable,
or trust an adopted terminal. Claude records its normal preference only after its own prompt
receives option 1.

## Pre-discovery launch flow

`TerminalLaunchCoordinator.launchNow()` owns the gap before session discovery:

1. It asks `ProjectLauncher` to inspect only the fresh, unbound, single-tab Claude launch created
   by this Relay process on macOS.
2. `src/claude-folder-trust.mjs` requires the heading, safety question, file-access warning, exact
   legacy or current option map, selected-row pointer, and confirmation footer. Composer chrome is
   a negative signal, so a transcript that quotes the full dialog above a live composer does not
   match.
3. The key sender receives the complete classified screen snapshot. In one JXA operation it reads
   the same tab again, compares the full contents byte for byte, and sends explicit option `1` only
   if nothing changed. A changed screen receives no key and is inspected again on a later poll.
4. A successful action is latched on the native launch, so repeated or concurrent resolver calls
   cannot send a second option key. An ambiguous Apple Event failure is also latched and never
   retried automatically.
5. After acceptance, the coordinator resets the full binding deadline because Claude starts
   registration only after this dialog closes. Normal two-observation binding then proves the
   expected conversation and workspace.

This logic is macOS-specific because the project is validated with Terminal.app. Other platforms
retain their existing execution paths.

## Executor fallback

`ClaudeTerminalExecutor` uses the same strict classifier for a prompt that appears after a session
is already known, during an exact-session relaunch, or unexpectedly after a task paste. It approves
option 1 at most once per turn and re-reads the screen before continuing. If the dialog swallowed a
paste, the guarded submit loop requires a readable empty composer, then re-injects the exact prompt
at most once. See [[claude-resume-picker-guard]] for the shared screen and paste invariants.

## Failure behavior

- A screen without every known trust-dialog signal receives no trust key.
- A complete quoted dialog above a detected composer is treated as composer history, not a live
  prompt.
- A screen change between classification and action sends no key.
- A successful or ambiguous pre-discovery trust action is never repeated for the same native
  launch.
- A prompt that remains visible after the executor's one explicit approval fails without a second
  key and without pasting the task prompt.
- If trust succeeds but Claude never registers, binding times out with a specific operator-facing
  explanation.

Diagnostics include `terminal.launch.claude_folder_trust_detected`,
`terminal.launch.claude_folder_trust_accepted`,
`terminal.launch.claude_folder_trust_not_sent`, and
`terminal.binding.claude_folder_trust_accepted`.

## Files and verification

- `src/claude-folder-trust.mjs`
- `src/project-launcher.mjs`
- `src/terminal-launch-coordinator.mjs`
- `src/claude-terminal-executor.mjs`
- `test/project-launcher.test.mjs`
- `test/terminal-launch-coordinator.test.mjs`
- `test/claude-terminal-executor.test.mjs`

Restart Relay after installing this change so new Claude launches use the startup resolver.

#relay #claude #terminal #recovery
