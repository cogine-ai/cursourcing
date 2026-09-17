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
inner wait plus transport overhead; 60 seconds outside / 50 seconds inside is
a starting point where supported, not a timeout guarantee.

A host yield means the original call is still pending. Continue its cell rather
than opening a second wait. If the host caps waits below those example values,
lower the inner timeout to fit with headroom, or use the host's supported
continuation mechanism. The plugin cannot set the host's outer yield budget.

When the plugin actually returns `timed_out: true`, execution is still running.
Carry forward each task's `next_cursor` and wait again if results are needed;
ordinary timeouts do not require reading code, inspecting history, or restarting
Cursor. Continue to handle user steering and real permission/question requests.

## Result detail

`start_task` and `wait` default to `detail: "compact"`. Running timeouts omit
fixed metadata and intermediate prose. A newly ended turn includes its unread
reply and the verified configuration when available. Pending requests are never
removed by compaction. An acknowledged reply is not repeated.

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
