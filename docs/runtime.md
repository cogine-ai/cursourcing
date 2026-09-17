# How Cursourcing works

[Back to the README](../README.md)

## Behavior

- `cwd` is explicit and reaches both the CLI process and ACP `session/new` / `session/load`.
- Startup returns a task ID; initialization, execution and input requests remain observable.
- Separate tasks run concurrently. Each task owns one Cursor process and conversation. Follow-up turns within that conversation run sequentially.
- In-process state changes notify local waits after the turn's promise settles; filesystem watching also observes other runtimes. Completion does not have to wait for an OS file notification or the next timeout check. Ordinary progress still does not end a wait.
- `wait` returns for an ended turn, failure, interruption, cancellation, or pending request, not ordinary tool/progress events. Its compact default includes status and unread completed replies without event pages or native paths. Pass `next_cursor` into `after_cursors` to acknowledge completed results; unresolved requests and a lost runtime remain actionable. Timeouts return small status records without stopping execution. The default is 50 seconds, with a 60-second maximum. For timed outer wrappers, allow more time than the inner wait; increasing the inner timeout alone does not prevent extra host/model round trips. See [host waiting examples](../skills/cursourcing/references/waiting.md).
- The `default` permission mode launches `agent --trust --sandbox enabled acp`, without `--force`. `start_task` can explicitly select `permissions: "full-access"`, mapping to `agent --trust --force --sandbox disabled acp` for work already authorized to run unrestricted. The selection is saved for follow-ups and `resume`; old tasks default to the original sandboxed mode. This maps a permission choice, not Codex's full permission policy. It does not change global configuration or add `--approve-mcps`. Cursor's explicit deny rules and organization controls remain in force. Any remaining permission, question or plan requests are returned to Codex; the bridge does not auto-answer them. History-only reads use the original sandboxed mode.
- Model configuration is checked against the requested values. An unavailable model fails initialization instead of silently selecting another model.
- The assistant report, tool events and stop reason are recorded separately from Codex's review. `idle` is not an acceptance verdict. Known standalone Cursor transport diagnostics returned with `end_turn` become `failed` with `error_code: "cursor_transport_error"`; the reply, session, and file changes are retained without automatic retry. This narrow classifier excludes prose, quoted diagnostics, incomplete/truncated replies, and unknown error formats; it is not a general correctness check.
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

## Compact results and 0.2 migration

`start_task` and `wait` now default to `detail: "compact"`. A start returns task identity,
state, and requested configuration while initialization continues; it does not claim
that configuration is already active. An unread ended turn includes the effective
configuration when available, its reply, and output pagination/truncation fields.
Pending requests retain their complete response options. Running or acknowledged
results return `output: {text: ""}` without repeating fixed metadata or intermediate prose.

Clients that read `cwd`, `session_id`, `log_path`, `native_session`, or other snapshot
fields directly from start/wait should use `detail: "full"` or request `read_task`
when those details are actually needed. The full view preserves the previous shape;
existing saved tasks, permissions, cursors, and recovery remain compatible. Other
tools keep their existing return shapes. This change to the default view is why
the version advances to 0.2.0.

MCP exposes both text `content` and `structuredContent` for client compatibility.
A code-execution caller should emit one view, preferably `structuredContent` with
a `content` fallback, instead of serializing the entire envelope. The plugin cannot
control the host's wrapper timeout or automatically continue an ended model turn.

## Local records and configuration

Cursor already stores ACP conversations. On the tested CLI version the default location is `~/.cursor/acp-sessions/<sessionId>/`, containing `meta.json` and `store.db` (SQLite may also use WAL/SHM companion files). The actual root respects `CURSOR_CONFIG_DIR` or `XDG_CONFIG_HOME`. This layout is an observed implementation detail; the plugin returns file paths only after checking that the session metadata matches the task directory.

`session/new` returns a random session ID; it cannot be derived from the prompt or directory. Cursor also advertises `session/list` with a `cwd` filter. The plugin saves the exact returned ID and directory for recovery.

`read_task` contains compact progress/key events, pending requests, the latest assistant reply, and `native_session` references. Ordinary events stay available here even though `wait` skips them. Wait cursors advance to the snapshot's latest event; use a separate read cursor (or start at zero) to inspect earlier retained events. New tasks keep only metadata, a 64 KiB latest-reply cache and a 256 KiB compact activity journal under `~/.local/state/cursourcing`. Raw tool inputs/outputs are not duplicated in this journal. Truncation and dropped event cursors are explicit. Existing legacy records are preserved; records across distinct tasks still accumulate.

Use `read_task` with `include_output: true` to page through the cached reply. Use `read_history` for detailed earlier messages and tool results from an idle task. It loads Cursor's saved conversation through ACP and returns a bounded JSONL text window; it sends no model prompt and writes no transcript copy. Each page reloads the conversation, so it has startup/IO cost and offsets are valid only while the conversation is unchanged. It returns the history Cursor can replay, not the original wire stream or a guarantee that every command's entire output was retained.

History is an optional diagnostic, not a routine acceptance check. Review the
delivery, actual artifacts and relevant checks first. `read_history.timeout_ms`
defaults to 50,000 (range 1–50,000); one budget covers replay-client startup,
authentication and loading together. It does not reset for each ACP request.
Allow additional time for ownership acquisition and process cleanup; choose a
shorter budget for hosts with shorter tool-call deadlines. Timeout, host
cancellation, `cancel`, and shutdown close the separate replay client before
releasing the history guard. The task's existing execution client, saved
conversation and cached reply are preserved, so follow-up turns can continue.
The bridge does not automatically retry history or replay a model prompt.

Authentication responses and environment variables are not recorded. Native Cursor conversations remain managed by Cursor; the bridge does not remove them or impose a second full-history retention policy.

Optional environment variables: `CURSOURCING_BINARY` selects a CLI executable; `CURSOURCING_STATE_DIR` selects an isolated state directory. The default executable is `~/.local/bin/agent` when present, otherwise `cursor-agent` on PATH.

Upgrading from the `codex-cursor` personal preview: when its state directory already exists, Cursourcing continues using `~/.local/state/codex-cursor` so saved tasks remain discoverable. The previous `CODEX_CURSOR_BINARY` and `CODEX_CURSOR_STATE_DIR` settings remain supported; the new names take precedence. Existing task records and native Cursor sessions are preserved. Install Cursourcing first, then remove the old plugin to avoid running two copies.
