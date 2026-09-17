import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TaskManager } from './tasks.mjs';
import { compactTask } from './views.mjs';
import { HISTORY_TIMEOUT_MS } from './history.mjs';

const manager = new TaskManager();
const server = new McpServer({ name: 'cursourcing', version: '0.2.3' });
const id = z.string().min(8).max(80), prompt = z.string().min(1).max(300000);
const detail = z.enum(['compact', 'full']).default('compact').describe('Full metadata and paths are opt-in.');
const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
function tool(name, description, inputSchema, fn, readOnly = false) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } },
  async (args, extra) => {
    try { return result(await fn(args, extra)); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
tool('start_task', 'Delegate the first complete result to Cursor Grok 4.6 xhigh fast, including investigation, implementation, self-checks and delivery evidence. Supply the current workspace, objective, constraints and acceptance criteria. Codex then owns acceptance and local corrections. Returns compact status immediately; the prompt is unchanged. Use wait for delivery or blocking input.', {
  cwd: z.string().describe('Absolute working directory or worktree path'), prompt, detail,
  mode: z.enum(['agent', 'ask', 'plan']).default('agent'),
  permissions: z.enum(['default', 'full-access']).default('default').describe('default keeps Cursor sandbox and approvals. full-access launches with --force --sandbox disabled; select only when the user has authorized unrestricted execution for this delegated work. This does not import Codex permissions; Cursor deny rules and team policies still apply.'),
  request_id: z.string().min(1).max(200).optional().describe('Stable unique key for this delegation; reuse on uncertain retries to avoid duplicate execution'),
}, async ({ detail, ...a }) => {
  const task = await manager.start(a);
  return detail === 'full' ? task : compactTask(task, { include_config: true });
});
tool('read_task', 'Read missing information that affects the next action or answers a user progress question: task metadata, events, pending requests or native session references. Prefer wait for delivery; ordinary timeouts do not require a progress read. idle is not acceptance. include_output pages the cached reply; read_history retrieves earlier messages and tool results.', {
  task_id: id, after_cursor: z.number().int().nonnegative().default(0),
  max_events: z.number().int().min(1).max(100).default(10),
  include_output: z.boolean().default(false),
  output_offset: z.number().int().nonnegative().default(0), max_output_chars: z.number().int().min(1).max(50000).default(8000),
}, ({ task_id, ...a }) => manager.read(task_id, a), true);
tool('wait', 'Wait up to 120s for completion, failure, stop or required input; these return immediately and progress stays local. Returns compact status and an unread reply. Pass next_cursor in after_cursors. The MCP deadline must exceed the inner wait (the plugin config uses 150s). For timed host wrappers, allow headroom where supported; if the wrapper yields, continue that pending call rather than starting another plugin wait. Use a shorter inner timeout when the host has a shorter hard deadline. Timeout/cancellation leaves execution running.', {
  task_ids: z.array(id).min(1).max(16), after_cursors: z.record(z.string(), z.number().int().nonnegative()).default({}),
  timeout_ms: z.number().int().min(0).max(120000).default(120000), detail,
}, ({ task_ids, ...a }, extra) => manager.wait(task_ids, { ...a, signal: extra.signal }), true);
tool('send_message', 'Continue an idle Cursor conversation when further delegation is warranted: new investigation, substantial rework, or explicit user direction. Codex handles bounded acceptance corrections directly by default. A busy session must finish or be cancelled first; independent work can use another task. Returns before execution completes.', {
  task_id: id, prompt, request_id: z.string().min(1).max(200).optional(),
}, (a) => manager.send(a.task_id, a.prompt, a.request_id));
tool('respond', 'Answer a live Cursor client request using its request_id and the ACP response object. Permission requests use {outcome:{outcome:"selected",optionId:"..."}} or {outcome:{outcome:"cancelled"}}. Choose from the returned options under the existing user authorization. Question/plan responses follow the advertised Cursor extension protocol.', {
  task_id: id, request_id: z.string(), response: z.record(z.string(), z.unknown()),
}, (a) => manager.respond(a.task_id, a.request_id, a.response));
tool('cancel', 'Stop a running task, retaining its output and file changes. Cancels only the selected Cursor task. It does not roll back files.', { task_id: id }, (a) => manager.cancel(a.task_id));
tool('resume', 'Reload a saved Cursor conversation in its original cwd and requested model configuration. Failed/interrupted status includes recovery eligibility; no session, unconfirmed previous execution or incomplete cleanup prevents recovery. A connected session needs no reload. Returns while initialization is running and does not replay unfinished instructions; after it becomes idle, send_message can continue warranted work.', { task_id: id }, (a) => manager.resume(a.task_id));
tool('list_tasks', 'Find saved Cursor tasks and their statuses, optionally within a workspace. Records describe bridge activity only, not native Codex subagents.', { cwd: z.string().optional() }, (a) => ({ tasks: manager.list(a.cwd) }), true);
tool('read_history', 'Inspect earlier messages or tool results when a specific evidence gap requires them; not a routine delivery check. Prefer the reply from wait, cached read_task output and actual artifacts first. Replays an idle session without prompting the model or copying its transcript to disk. Each page reloads history; offsets require an unchanged conversation. A shared replay deadline closes the read client before releasing the session for follow-ups; errors leave the saved session and cached reply intact.', {
  task_id: id, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100000).default(16000),
  timeout_ms: z.number().int().min(1).max(HISTORY_TIMEOUT_MS).default(HISTORY_TIMEOUT_MS)
    .describe('Budget for startup, authentication and replay together; allow additional time for process cleanup. Lower it for hosts with shorter tool-call deadlines.'),
}, ({ task_id, ...a }, extra) => manager.history(task_id, { ...a, signal: extra.signal }), true);

const transport = new StdioServerTransport();
let shutdownPromise;
function shutdown() {
  return shutdownPromise ??= (async () => { await manager.close(); await server.close(); })();
}
process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
process.stdin.once('end', () => shutdown().then(() => process.exit(0)));
await server.connect(transport);
