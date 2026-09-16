---
name: cursourcing
description: Put available Cursor capacity to work on implementation, investigation, debugging, and validation while Codex coordinates and reviews. Use for tokenmaxxing across Codex and Cursor, with asynchronous delegation, concurrent tasks, and resumable sessions.
---

# Cursourcing

Keep the selected Codex model focused on planning, decisions, and acceptance. Actively look for meaningful work Cursor can take on throughout the task, making use of available Cursor capacity.

Prefer handing useful subtasks to Cursor when it can make progress with a clear objective and relevant context. Investigations, design exploration, implementation, debugging, tests, and review are all useful assignments. Cursor can help discover the solution; an investigation can ask for findings and recommendations before an implementation approach is settled.

Match the handoff to the work. Delegate a coherent chunk, provide enough room for Cursor to solve it, and follow up on the result. Direct execution and other collaboration tools remain useful when they fit the task better.

## Hand off work

Call `start_task` with the absolute working directory of the current Codex task (including its worktree when applicable) and a task brief suited to the work. Cursor does not inherit this conversation: give it the objective, relevant context, real constraints, and the result or evidence you need back. Include known decisions and code entry points when they help. The bridge sends the brief unchanged; it does not add a hidden prompt template.

Cursor uses Grok 4.6 with xhigh effort and fast enabled. `agent` mode supports execution; `ask` is useful for read-only analysis. Startup can take time; `start_task` returns an ID while initialization continues. A stable `request_id` makes an uncertain retry return the same task instead of starting duplicate work.

## Follow execution

- Use `wait` for one or several task IDs. Feed the returned `next_cursor` for each task into the next call's `after_cursors`; read additional event pages when `has_more_events` is true.
- Independent tasks can run in separate Cursor sessions concurrently. Choose working directories that make sense for concurrent file changes. The bridge does not create worktrees automatically.
- `read_task` returns compact status, pending requests, key events, the latest reply, and Cursor session references. `idle` / `end_turn` means a turn ended; review its report and actual changes before accepting the work.
- For more of the cached reply, use `read_task` with `include_output: true` and its output offset. For earlier messages or detailed tool results, use `read_history` on an idle task. It pages through Cursor's native ACP replay without sending a new prompt. History offsets apply to an unchanged conversation; start at zero after another turn.
- Cursor owns the detailed conversation. The bridge keeps a bounded latest-reply cache and compact activity log; truncation and cursor gaps are reported. Returned native paths are verified convenience references. Use the returned `session_id`, not an ID guessed from the directory or prompt.
- A wait timeout only stops waiting. It leaves the Cursor task running.

## Continue, answer, recover

Use `send_message` to continue an idle session. During a running turn, collect its result first or cancel it before starting a replacement turn. Use `respond` for a pending permission, question, or plan request, guided by the returned request and the existing user authorization. New user decisions can be brought back to the user. For response shapes, consult [ACP request responses](references/responses.md) when needed.

`cancel` stops execution and retains existing file changes. `list_tasks` finds earlier tasks. `resume` reloads a saved conversation using its original directory and requested model configuration; it does not resubmit the previous task. When recovery reaches `idle`, inspect the existing result and use `send_message` for the next step.

The bridge lives with its MCP process. If that process exits, active tasks become interrupted and can be recovered later. Task records are local observations of Cursor activity; they do not describe Codex's native subagents.
