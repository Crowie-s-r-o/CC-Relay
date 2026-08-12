# CC Relay agent guidance

Read `CLAUDE.md` and the relevant pages in `wiki/` before changing behavior. The safety, testing, release, and documentation rules there apply to every coding agent.

## Git attribution

- Never use Claude, Anthropic, Codex, OpenAI, or another assistant as a commit author or committer.
- Never add assistant credit trailers such as `Co-Authored-By`, `Signed-Off-By`, `Generated-By`, or `Assisted-By`.
- Never add `Claude-Session` or `Codex-Session` trailers.
- Keep the maintainer's configured Git identity unchanged. Do not bypass the repository commit hooks.
