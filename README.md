# Cursourcing

**Your Codex just hired Cursor.**

Cursourcing = Cursor + outsourcing.

Codex plans and coordinates work using the model you selected. When a subtask has a clear goal, scope, and acceptance criteria, it can hand execution to Cursor CLI using **Grok 4.6 / xhigh / fast** over ACP, handle questions, and review the result.

Invoking the skill brings this collaboration option into the task. Codex decides when Cursor is useful as the work develops.

## Try it

Requires Node.js 22+ and a logged-in Cursor CLI (`agent login`). The shipped `dist/server.mjs` contains its npm dependencies; installing the plugin does not require `npm install`.

Install from the [Cogine AI marketplace](https://github.com/cogine-ai/marketplace):

```sh
codex plugin marketplace add cogine-ai/marketplace
codex plugin add cursourcing@cogine-ai
```

Start a new Codex task, open a project, and try:

> Use $cursourcing to plan this task, use Cursor where helpful, and review the results.

The full skill identifier is `$cursourcing:cursourcing`. This release targets Codex.

The skill is normally discoverable and leaves Codex's native collaboration tools available. Its task brief is supplied by Codex and passed through unchanged. No Hooks are installed.

## Behavior

- `cwd` is explicit and reaches both the CLI process and ACP `session/new` / `session/load`.
- Startup returns a task ID; initialization, execution and input requests remain observable.
- Separate tasks run concurrently. Each task owns one Cursor process and conversation. Follow-up turns within that conversation run sequentially.
- Cursor runs with workspace trust and its sandbox enabled. Tool permission requests are returned to Codex for a response; the bridge does not auto-approve them.
- Model configuration is checked against the requested values. An unavailable model fails initialization instead of silently selecting another model.
- The assistant report, tool events and stop reason are recorded separately from Codex's review. `idle` is not an acceptance verdict.
- `resume` loads history and configuration. It does not automatically replay an interrupted prompt or undo file changes.
- Tasks live as long as the MCP server. Closing that server interrupts active tasks and releases its owned processes. This version is not an independent background daemon and does not automatically wake an idle Codex task.
- One runtime owns a live conversation. Another runtime can read its records, but cannot take over a live owner. Crash recovery may briefly wait for the filesystem lease to expire.

## Integration

Codex is the MCP client. This plugin is an MCP server and an ACP client. Cursor CLI is the ACP server:

```text
Codex → MCP → cursourcing → ACP → agent acp
```

Cursor's `agent mcp` commands manage tools consumed by Cursor; they do not expose its agent as a local MCP server. A standalone MCP client can connect to this plugin for development or work in an existing Codex task whose tool inventory has not refreshed. Keep that client connected while tasks run. The normal installed path is Codex calling the plugin directly.

The `.codex-plugin/plugin.json` manifest uses relative `cwd` and executable arguments in `.mcp.json`. Its legacy loader does not expand the newer Agent Plugins format's `${PLUGIN_ROOT}` placeholder.

## Local records and configuration

Cursor already stores ACP conversations. On the tested CLI version the default location is `~/.cursor/acp-sessions/<sessionId>/`, containing `meta.json` and `store.db` (SQLite may also use WAL/SHM companion files). The actual root respects `CURSOR_CONFIG_DIR` or `XDG_CONFIG_HOME`. This layout is an observed implementation detail; the plugin returns file paths only after checking that the session metadata matches the task directory.

`session/new` returns a random session ID; it cannot be derived from the prompt or directory. Cursor also advertises `session/list` with a `cwd` filter. The plugin saves the exact returned ID and directory for recovery.

Default results contain compact progress/key events, pending requests, the latest assistant reply, and `native_session` references. New tasks keep only metadata, a 64 KiB latest-reply cache and a 256 KiB compact activity journal under `~/.local/state/cursourcing`. Raw tool inputs/outputs are not duplicated in this journal. Truncation and dropped event cursors are explicit. Existing legacy records are preserved; records across distinct tasks still accumulate.

Use `read_task` with `include_output: true` to page through the cached reply. Use `read_history` for detailed earlier messages and tool results from an idle task. It loads Cursor's saved conversation through ACP and returns a bounded JSONL text window; it sends no model prompt and writes no transcript copy. Each page reloads the conversation, so it has startup/IO cost and offsets are valid only while the conversation is unchanged. It returns the history Cursor can replay, not the original wire stream or a guarantee that every command's entire output was retained.

Authentication responses and environment variables are not recorded. Native Cursor conversations remain managed by Cursor; the bridge does not remove them or impose a second full-history retention policy.

Optional environment variables: `CURSOURCING_BINARY` selects a CLI executable; `CURSOURCING_STATE_DIR` selects an isolated state directory. The default executable is `~/.local/bin/agent` when present, otherwise `cursor-agent` on PATH.

Upgrading from the `codex-cursor` personal preview: when its state directory already exists, Cursourcing continues using `~/.local/state/codex-cursor` so saved tasks remain discoverable. The previous `CODEX_CURSOR_BINARY` and `CODEX_CURSOR_STATE_DIR` settings remain supported; the new names take precedence. Existing task records and native Cursor sessions are preserved. Install Cursourcing first, then remove the old plugin to avoid running two copies.

## Development and verification

```sh
npm ci
npm run build
npm test
npm run test:live
```

`test:live` uses the installed Cursor account and creates temporary workspaces. It checks parallel tasks, a file edit, cancellation, and cross-process session recovery through the real MCP interface. It cleans up its own processes/workspaces and prints a verification report. It does not test automatic Codex routing decisions or every Cursor extension.

Automated tests cover the MCP entrypoint, concurrent tasks, requests, cancellation, recovery, compact storage, native-history replay, and preview configuration compatibility. Live reports may contain local workspace paths and session identifiers; keep them locally rather than publishing them.

The source of truth is [cogine-ai/cursourcing](https://github.com/cogine-ai/cursourcing). The marketplace carries a release snapshot with the bundled runtime and skill, so users do not need npm dependencies or a build step.

After building, export that snapshot with `node scripts/export-plugin.mjs <destination>`. Dependency license texts ship in `dist/THIRD_PARTY_NOTICES.md`.

Runtime design references: T3 Code `CursorAdapter.ts`, `AcpSessionRuntime.ts`, and `ProviderService.ts` at commit `5ea6439816470288d3f2b6b43635fea41fbbb101`, plus [Cursor's ACP documentation](https://cursor.com/docs/cli/acp). The bridge is an independent implementation; no T3 source was copied.
