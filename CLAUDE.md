# CC Relay contributor guidance

CC Relay is a dependency-light local orchestrator for subscription-authenticated Codex and Claude Code sessions. It runs as a loopback Node.js app or an Electron desktop app.

## Start here

Before changing behavior:

1. Read `README.md` and the relevant files in `wiki/`.
2. Inspect existing tests for the affected contract.
3. Run the focused tests while developing.
4. Run `npm test`, `npm run release:check`, and `git diff --check` before finishing.

The project is currently validated only on macOS. Windows and Linux code must remain portable, but simulated tests are not proof of complete platform support.

## Core safety rules

- Preserve exact project, task, provider, conversation, process, TTY, and native-window ownership.
- Never target or close a terminal from a stale identifier alone.
- Fail closed when terminal identity or prompt-delivery evidence is ambiguous.
- Keep the HTTP server and provider proxy on loopback.
- Keep provider credentials inside the installed CLIs.
- Treat prompts, transcripts, tool results, paths, and provider output as untrusted data.
- Never commit `.data`, SQLite files, diagnostics, transcripts, credentials, private keys, or signing material.
- Never use Claude, Anthropic, Codex, OpenAI, or another assistant as a commit author, committer, co-author, signer, or generated-by identity. Never add assistant session trailers.
- Use synthetic identities and paths in new fixtures.
- Do not add project environment variables without an explicit product decision.

## Queue and workflow invariants

- Current tasks use project-scoped disposable provider capacity.
- Direct work requires one slot for its provider.
- Plan council reserves one Codex and one Claude slot atomically.
- Turbo reserves its planner and worker fleet before execution.
- One saved conversation can have only one queued or running owner.
- Cancellation, retry, continuation, and shutdown must release only the resources owned by that exact task.
- Existing persistent task rows keep their legacy behavior unless a migration explicitly changes it.

## Frontend boundaries

The renderer intentionally uses plain HTML, CSS, and JavaScript in `public/`. Do not add a framework or bundler without a strong functional reason.

- Preserve keyboard access and visible focus.
- Escape all model-controlled or task-controlled values before HTML interpolation.
- Keep live refreshes from stealing focus, clearing text selection, or resetting scroll position.
- Update light and dark themes together.
- Test relevant desktop and compact breakpoints for visible changes.

## Persistent engineering context

The Obsidian-style `wiki/` is the project's living engineering memory. Update the relevant page when a lasting behavior, invariant, release rule, or non-obvious failure mode changes. Use YAML frontmatter, `[[wikilinks]]`, callouts, and tags.

## Releases

Do not edit versions or `CHANGELOG.md` in an ordinary feature change. Maintainers use `npm run deploy` from a clean `main` branch. The command owns package version updates, AI-generated release notes, verification, the release commit, the annotated tag, and the atomic GitHub push.
