---
name: cursourcing
description: Delegate implementation, investigation, or debugging to Cursor CLI while Codex sets constraints and verifies delivery. Use when the user wants to use Cursor capacity or reduce Codex work through delegation, with resumable sessions and explicit task boundaries.
---

# Cursourcing

Use Cursor to complete a coherent work unit and return evidence. When saving Codex usage is the goal, minimize the combined cost of handoff, coordination, and acceptance; using more Cursor capacity is not itself a success criterion.

Cursor owns the unit's necessary investigation, local design decisions, implementation, and self-checks. Codex supplies known constraints, resolves decisions outside that scope, and verifies delivery. A unit can also be an investigation that returns findings and evidence. Do not solve the same unit again while Cursor is working. Continue genuinely independent work, or wait when none is needed.

Match the handoff to the task and the user's priorities. Direct execution and other collaboration tools remain useful when their overhead and expected result fit better.

## Hand off work

Call `start_task` with the absolute directory of the current Codex task (including its worktree) and the objective, known context, constraints, and acceptance criteria. Cursor does not inherit this conversation. Include known entry points without first repeating the investigation. Ask for a concise handoff: outcome, relevant files, checks actually run with their results, and unresolved gaps. This skill guides Codex; give Cursor the task brief and relevant project instructions, not these coordinator instructions. The bridge passes the brief unchanged.

Cursor uses Grok 4.6 with xhigh effort and fast enabled. `agent` supports execution; `ask` is read-only. Startup returns compact status while initialization continues. A stable `request_id` makes an uncertain retry return the same task instead of duplicating execution.

Choose execution permissions at handoff. When the current Codex task explicitly has full access without approval prompts and that authorization covers the delegated work, use `permissions: "full-access"` to avoid repeating routine approvals in Cursor. It maps to Cursor's `--force --sandbox disabled`. Otherwise omit it for the existing sandboxed mode. The plugin cannot infer the active Codex permission policy; do not infer it from a global config file. Cursor's explicit deny rules and organization controls still apply, and any remaining requests are returned normally. This choice is saved for follow-ups and recovery; history-only reads keep their existing permissions.

## Follow execution

- Use `wait` for delivery, failure, stopping, or required input; ordinary progress stays local. Feed each `next_cursor` into `after_cursors` so seen completions do not wake later waits. Unresolved requests and lost runtimes remain actionable. A wait timeout leaves execution running and needs no new investigation.
- When using timed exec/wait wrappers, give the outer call more time than the inner wait and avoid repeated short polling. Follow the [host waiting examples](references/waiting.md) for those wrappers and single-view result handling.
- Independent tasks can run in separate Cursor sessions concurrently. Choose working directories that make sense for concurrent file changes. The bridge does not create worktrees automatically.
- `wait` includes the completed reply. Concentrate review after delivery: inspect actual changes and run risk-relevant independent checks. A worker's report and `idle` / `end_turn` are not acceptance verdicts. Investigate further when evidence is missing, checks fail, or a concrete new risk appears; give specific corrections in the same session. Stop when the acceptance criteria are satisfied.
- Use `read_task` only for needed progress, events, native session references, or more output; do not automatically read after every wait. Page the cached reply with `include_output: true` and output offsets. Event cursors are separate from output offsets; start event reads at zero for earlier retained activity. For earlier messages or detailed tool results, use `read_history` on an idle task. Replay sends no prompt; restart history offsets after another turn. Truncation and cursor gaps are explicit.

## Continue, answer, recover

Use `send_message` to continue an idle session. During a running turn, collect its result first or cancel it before starting a replacement turn. Use `respond` for a pending permission, question, or plan request, guided by the returned request and the existing user authorization. New user decisions can be brought back to the user. For response shapes, consult [ACP request responses](references/responses.md) when needed.

`cancel` stops execution and retains existing file changes. `list_tasks` finds earlier tasks. `resume` reloads a saved conversation using its original directory and requested model configuration; it does not resubmit the previous task. When recovery reaches `idle`, inspect the existing result and use `send_message` for the next step.

The bridge lives with its MCP process; exiting interrupts active tasks. It cannot independently wake an ended Codex turn. Use the returned native session ID when needed, never one guessed from a path. Records describe Cursor activity, not Codex's native subagents.
