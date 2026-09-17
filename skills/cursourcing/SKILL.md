---
name: cursourcing
description: Delegate a complete implementation, investigation, or debugging unit to Cursor CLI, then let Codex accept and finish the result. Use when the user wants to use Cursor capacity or reduce Codex work through delegation, with resumable sessions and explicit task boundaries.
---

# Cursourcing

Use Cursor to complete a coherent work unit and return evidence. When saving Codex usage is the goal, minimize the combined cost of handoff, coordination, and acceptance; using more Cursor capacity is not itself a success criterion.

Use two ownership phases by default: Cursor delivers the first complete result; Codex then owns acceptance and finish work. Cursor handles the unit's necessary investigation, local design decisions, implementation, self-checks and fixes found by those checks. An investigation-only unit returns findings and evidence instead of code. Codex supplies known constraints and handles blocking decisions without repeating the delegated work.

When delegation is optional, choose a unit whose remaining investigation and execution justify the handoff and review. A known, local change may be cheaper to finish directly; substantial investigation can itself be worth delegating. Judge from available context without first solving the task to estimate it. Follow the user's explicit execution choice; do not route solely by task category or file count.

## Delegate the first complete work unit

Call `start_task` with the absolute directory of the current Codex task (including its worktree) and the objective, known context, constraints, and acceptance criteria. Cursor does not inherit this conversation. Include known entry points without first repeating the investigation. Ask for a reviewable result: outcome, changed files or findings, exact check commands and results, evidence locations, and unresolved gaps. Cursor should draft any delivery document the task requires; Codex can add its acceptance findings instead of reconstructing the execution history. Do not require extra reports when the task needs none.

Make the handoff boundary explicit: Cursor owns completion and self-checks of the delegated unit; after its return, Codex owns review and local corrections. Give Cursor the task brief and relevant project instructions, not these coordinator instructions. The bridge passes the brief unchanged.

Cursor uses Grok 4.6 with xhigh effort and fast enabled. `agent` supports execution; `ask` is read-only. Startup returns compact status while initialization continues. A stable `request_id` makes an uncertain retry return the same task instead of duplicating execution.

Choose execution permissions at handoff. When the current Codex task explicitly has full access without approval prompts and that authorization covers the delegated work, use `permissions: "full-access"` to avoid repeating routine approvals in Cursor. It maps to Cursor's `--force --sandbox disabled`. Otherwise omit it for the existing sandboxed mode. The plugin cannot infer the active Codex permission policy; do not infer it from a global config file. Cursor's explicit deny rules and organization controls still apply, and any remaining requests are returned normally. This choice is saved for follow-ups and recovery; history-only reads keep their existing permissions.

## Follow execution

- While Cursor owns the unit, handle blockers or genuinely independent work; otherwise wait. Defer review of its changing source, screenshots, and check results until handoff, unless a concrete decision cannot wait. A timeout alone is not a reason to inspect progress or load implementation context.
- Use `wait` for delivery, failure, stopping, or required input; ordinary progress stays local. Feed each `next_cursor` into `after_cursors` so seen completions do not wake later waits. Unresolved requests and lost runtimes remain actionable. A wait timeout leaves execution running and needs no new investigation.
- For timed wrappers, give the outer call more time than the inner wait. In Codex `functions.exec`, use the following pattern when its limits allow (resolve the actual tool name first):

  ```javascript
  // @exec: {"yield_time_ms": 60000}
  const result = await tools.mcp__cursourcing__wait({
    task_ids: [taskId], after_cursors: { [taskId]: lastCursor }, timeout_ms: 50000,
  });
  text(result.structuredContent ?? result.content);
  ```

  Emit one result view, as above, rather than the whole MCP envelope with duplicate text and structured content. If the wrapper yields a running cell, continue that same cell with a long `functions.wait` (e.g. `yield_time_ms: 60000` where supported). Do not start another plugin wait or repeatedly check at one-second intervals. Adapt to shorter host limits; see [waiting details](references/waiting.md).
- Independent tasks can run in separate Cursor sessions concurrently. Choose working directories that make sense for concurrent file changes. The bridge does not create worktrees automatically.
- Use `read_task` for a specific missing detail, not automatically after every wait. Page the cached reply with `include_output: true` and output offsets. Event cursors are separate from output offsets; start event reads at zero for earlier retained activity. Truncation and cursor gaps are explicit.
- Use `read_history` on an idle task only when earlier messages or tool results are needed to resolve a specific question. It is not a routine acceptance step: each page starts a native replay. After a timeout, use available artifacts/cached output; retry history only if that evidence is still necessary. Replay sends no prompt; restart history offsets after another turn.

## Take over acceptance and finish work

`wait` includes the completed reply. Start with that evidence and the actual changed surface; load additional source or artifacts to answer a concrete acceptance question. A worker's report and `idle` / `end_turn` are not acceptance verdicts. Run independent checks for material risks, expanding review when evidence is missing, checks fail, or a new risk appears.

Once Codex takes over, make bounded corrections directly within the task's authorized scope and recheck the affected criteria and relevant regressions. Do not send routine review findings back to Cursor by default. Delegate again only when new investigation or substantial rework forms a worthwhile complete unit, or the user explicitly requests it; describe that unit and reuse the existing session when appropriate. This is an ownership default, not a one-turn cap or a reason to close a saved session.

Complete relevant writes and builds before checks that consume those artifacts; independent checks may run together. If the artifacts change during a check, revalidate the affected result. Reuse valid evidence for unchanged parts rather than recreating the worker's entire verification workflow. Stop when acceptance is satisfied, and distinguish Cursor's checks from Codex's own checks in the final delivery.

## Continue, answer, recover

Use `send_message` when further delegation is warranted, not as the default response to a local correction. During a running turn, collect its result first or cancel it before starting a replacement turn. Use `respond` for a pending permission, question, or plan request, guided by the returned request and the existing user authorization. New user decisions can be brought back to the user. For response shapes, consult [ACP request responses](references/responses.md) when needed.

`cancel` stops execution and retains existing file changes. `list_tasks` finds earlier tasks. `resume` reloads a saved conversation using its original directory and requested model configuration; it does not resubmit the previous task. When recovery reaches `idle`, inspect the existing result and use `send_message` for the next step.

The bridge lives with its MCP process; exiting interrupts active tasks. It cannot independently wake an ended Codex turn. Use the returned native session ID when needed, never one guessed from a path. Records describe Cursor activity, not Codex's native subagents.
