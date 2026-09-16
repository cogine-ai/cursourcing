import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TaskManager } from './tasks.mjs';

const manager = new TaskManager();
const server = new McpServer({ name: 'cursourcing', version: '0.1.3' });
const id = z.string().min(8).max(80), prompt = z.string().min(1).max(300000);
const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
function tool(name, description, inputSchema, fn, readOnly = false) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } },
  async (args, extra) => {
    try { return result(await fn(args, extra)); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
}
tool('start_task', 'Delegate a bounded coding or analysis task to Cursor Grok 4.6 xhigh fast. Returns a task ID immediately, including while initializing. Supply the current Codex workspace explicitly. Task text is passed through unchanged. Use wait/read_task to collect results; independent tasks can run concurrently.', {
  cwd: z.string().describe('Absolute working directory or worktree path'), prompt,
  mode: z.enum(['agent', 'ask', 'plan']).default('agent'),
  permissions: z.enum(['default', 'full-access']).default('default').describe('default keeps Cursor sandbox and approvals. full-access launches with --force --sandbox disabled; select only when the user has authorized unrestricted execution for this delegated work. This does not import Codex permissions; Cursor deny rules and team policies still apply.'),
  request_id: z.string().min(1).max(200).optional().describe('Stable unique key for this delegation; reuse on uncertain retries to avoid duplicate execution'),
}, (a) => manager.start(a));
tool('read_task', 'Read compact status, key events, pending requests, latest reply and native Cursor session references. idle/end_turn is not an acceptance verdict. Set include_output to page the cached reply; read_history retrieves earlier messages and detailed tool results from Cursor.', {
  task_id: id, after_cursor: z.number().int().nonnegative().default(0),
  max_events: z.number().int().min(1).max(100).default(10),
  include_output: z.boolean().default(false),
  output_offset: z.number().int().nonnegative().default(0), max_output_chars: z.number().int().min(1).max(50000).default(8000),
}, ({ task_id, ...a }) => manager.read(task_id, a), true);
tool('wait', 'Wait for a turn to end, fail, stop, or need a response. Ordinary progress does not wake this wait. Returns status, pending requests and an unread completed reply, without event pages. Pass each next_cursor in after_cursors to avoid repeating completed results. Use read_task only when you need progress or more output. Timeout or cancellation of this wait leaves the tasks running.', {
  task_ids: z.array(id).min(1).max(16), after_cursors: z.record(z.string(), z.number().int().nonnegative()).default({}),
  timeout_ms: z.number().int().min(0).max(60000).default(30000),
}, ({ task_ids, ...a }, extra) => manager.wait(task_ids, { ...a, signal: extra.signal }), true);
tool('send_message', 'Continue an idle Cursor conversation with new context or follow-up work. A busy session must finish or be cancelled first; independent work can use another task. Returns before execution completes.', {
  task_id: id, prompt, request_id: z.string().min(1).max(200).optional(),
}, (a) => manager.send(a.task_id, a.prompt, a.request_id));
tool('respond', 'Answer a live Cursor client request using its request_id and the ACP response object. Permission requests use {outcome:{outcome:"selected",optionId:"..."}} or {outcome:{outcome:"cancelled"}}. Choose from the returned options under the existing user authorization. Question/plan responses follow the advertised Cursor extension protocol.', {
  task_id: id, request_id: z.string(), response: z.record(z.string(), z.unknown()),
}, (a) => manager.respond(a.task_id, a.request_id, a.response));
tool('cancel', 'Stop a running task, retaining its output and file changes. Cancels only the selected Cursor task. It does not roll back files.', { task_id: id }, (a) => manager.cancel(a.task_id));
tool('resume', 'Reload a saved Cursor conversation in its original cwd and requested model configuration. Returns while initialization is running. It does not replay unfinished instructions; after it becomes idle, send_message can continue the work.', { task_id: id }, (a) => manager.resume(a.task_id));
tool('list_tasks', 'Find saved Cursor tasks and their statuses, optionally within a workspace. Records describe bridge activity only, not native Codex subagents.', { cwd: z.string().optional() }, (a) => ({ tasks: manager.list(a.cwd) }), true);
tool('read_history', 'Read an idle task’s native Cursor conversation through ACP replay, without sending a model prompt or copying its transcript to disk. Returns a bounded JSONL character window of messages and tool results. Each page reloads history; reuse offsets only while the conversation is unchanged. Startup/authentication may take time.', {
  task_id: id, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100000).default(16000),
}, ({ task_id, ...a }, extra) => manager.history(task_id, { ...a, signal: extra.signal }), true);

const transport = new StdioServerTransport();
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  await manager.close(); await server.close();
}
process.once('SIGTERM', () => shutdown().then(() => process.exit(0)));
process.once('SIGINT', () => shutdown().then(() => process.exit(0)));
process.stdin.once('end', () => shutdown().then(() => process.exit(0)));
await server.connect(transport);
