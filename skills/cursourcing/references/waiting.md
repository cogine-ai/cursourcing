# Waiting through a timed host wrapper

Use the host's available tool names and limits. These examples use Codex's
`functions.exec` and `functions.wait`; other hosts may have different wrappers.
No wrapper change makes an ended Codex turn automatically resume.

## Collect a result

Resolve the Cursourcing wait tool from the current inventory. In this example
its name is `mcp__cursourcing__wait`. Keep the outer budget longer than the inner
wait plus transport overhead. Where supported, 60 seconds outside and 50 seconds
inside is a useful starting point, not a timeout guarantee:

```javascript
// @exec: {"yield_time_ms": 60000}
const result = await tools.mcp__cursourcing__wait({
  task_ids: ["<returned task_id>"],
  after_cursors: { "<returned task_id>": 0 }, // Use the last returned next_cursor.
  timeout_ms: 50000,
});
// Emit one view, not both copies of the MCP result.
if (result.structuredContent !== undefined) text(result.structuredContent);
else text(result.content);
```

If exec yields a running cell, continue that same cell with `functions.wait`
and a sufficient budget, for example `yield_time_ms: 60000`. Do not start a second
plugin wait while the first is still pending. Avoid repeated one-second checks.
If the host only permits shorter calls, respect that limit and reuse the pending
cell rather than assuming the long budget was accepted.

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

The runtime and skill reduce avoidable content and coordination. Remaining
timeouts still require the host to continue the call; a true completion callback
needs host support and a separately defined task lifetime.
