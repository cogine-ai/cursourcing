# Waiting through a timed host wrapper

Use the host's available tool names and limits. These examples use Codex's
`functions.exec` and `functions.wait`; other hosts may have different wrappers.
No wrapper change makes an ended Codex turn automatically resume.

## Collect a result

Use the executable pattern in [the skill](../SKILL.md#follow-execution). Resolve
the tool name from the current inventory by its Cursourcing name; matching every
description containing "cursor" also collects unrelated pagination tools.
Initialize `lastCursor` to zero, then
use each task's returned `next_cursor`. Keep the outer budget longer than the
inner wait plus transport overhead. The inner wait defaults to and is capped at
120 seconds; `.mcp.json` sets `tool_timeout_sec: 150`. Hosts configured manually
must also allow more than 120 seconds (150 seconds is the suggested MCP deadline).
An outer yield budget of 150 seconds can avoid intermediate yields where host
limits and progress-update requirements permit; it is not a timeout guarantee.

A host yield means the original call is still pending. Continue its cell rather
than opening a second wait. A short outer yield is not a hard MCP timeout: keep
the same pending call and use the host's continuation mechanism. If the host has
a shorter hard tool deadline, explicitly lower the inner timeout with headroom
(for example 50 seconds inside a 60-second deadline). The plugin cannot set the
host's outer yield budget or override requirements to respond to the user.

When the plugin actually returns `timed_out: true`, execution is still running.
Carry forward each task's `next_cursor` and wait again if results are needed;
ordinary timeouts do not require reading code, inspecting history, or restarting
Cursor. Continue to handle user steering and real permission/question requests.

## Result detail

`start_task` and `wait` default to `detail: "compact"`. Running timeouts omit
fixed metadata and intermediate prose. A newly ended turn includes its unread
reply and the verified configuration when available. Pending requests are never
removed by compaction. An acknowledged reply is not repeated.

Failures and interruptions include a small `recovery` object: whether a session
exists, whether it can be reloaded, and a reason when it cannot. This avoids
probing `resume` just to discover that no session was created. A connected session
does not need reloading. Recovery eligibility is not a recommendation to retry
the underlying failure; a new execution still requires a meaningful task decision.

Use `read_task` for needed detail, or `detail: "full"` on start/wait for clients
that require the previous snapshot fields. Cached output exposes `next_offset`,
`total_chars`, and `truncated`; read further when the summary is incomplete.
Never truncate a blocking request just to fit a small output budget.

Emit `result.structuredContent ?? result.content`, not the entire MCP envelope:
the two fields describe the same result. `read_task` returns metadata and events
as well as cached output, so use it for a specific gap rather than routine
progress narration. After delivery, follow the skill's acceptance phase; a
small correction does not by itself require another Cursor turn.

The runtime and skill reduce avoidable content and coordination. Remaining
timeouts still require the host to continue the call; a true completion callback
needs host support and a separately defined task lifetime.
