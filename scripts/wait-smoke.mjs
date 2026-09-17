// Real elapsed-time MCP check, using a local fixture and no model/API calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = mkdtempSync(join(tmpdir(), 'cursourcing-wait-smoke-'));
const cwd = join(root, 'project'); mkdirSync(cwd);
const config = JSON.parse(readFileSync('.mcp.json', 'utf8')).mcpServers.cursourcing;
const timeout = config.tool_timeout_sec * 1000;
const client = new Client({ name: 'wait-smoke', version: '1' });
const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: resolve(config.cwd),
  env: { ...process.env, CURSOURCING_BINARY: resolve('tests/fake-agent.mjs'), CURSOURCING_STATE_DIR: join(root, 'state') }, stderr: 'pipe' });
transport.stderr.on('data', () => {});
const call = async (name, args, options = {}) => {
  const reply = await client.callTool({ name, arguments: args }, undefined, { timeout, ...options });
  assert.ok(!reply.isError, JSON.stringify(reply)); return reply.structuredContent;
};
try {
  await client.connect(transport);
  assert.ok(timeout > 120000);
  const task = await call('start_task', { cwd, prompt: 'MOCK:hold' });
  const started = Date.now();
  const result = await call('wait', { task_ids: [task.task_id] });
  const elapsed_ms = Date.now() - started;
  assert.equal(result.timed_out, true);
  assert.equal(result.tasks[0].task.state, 'running');
  assert.ok(elapsed_ms >= 119500 && elapsed_ms < timeout, `elapsed ${elapsed_ms}`);
  const controller = new AbortController();
  const aborted = call('wait', { task_ids: [task.task_id] }, { signal: controller.signal });
  const rejected = assert.rejects(aborted); controller.abort(); await rejected;
  assert.equal((await call('read_task', { task_id: task.task_id })).task.state, 'running');
  const next = call('wait', { task_ids: [task.task_id] });
  const stopStarted = Date.now();
  await call('cancel', { task_id: task.task_id });
  const stopped = await next;
  assert.equal(stopped.timed_out, false); assert.equal(stopped.tasks[0].task.state, 'cancelled');
  assert.ok(Date.now() - stopStarted < 5000);
  const permission = await call('start_task', { cwd, prompt: 'MOCK:permission' });
  const inputStarted = Date.now();
  const pending = await call('wait', { task_ids: [permission.task_id] });
  assert.equal(pending.tasks[0].task.state, 'awaiting_input');
  assert.ok(Date.now() - inputStarted < 5000);
  const request = pending.tasks[0].task.pending_requests[0];
  await call('respond', { task_id: permission.task_id, request_id: request.request_id,
    response: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });
  const completion = await call('wait', { task_ids: [permission.task_id],
    after_cursors: { [permission.task_id]: pending.tasks[0].next_cursor } });
  assert.equal(completion.tasks[0].task.state, 'idle');
  console.log(JSON.stringify({ passed: true, elapsed_ms, mcp_timeout_ms: timeout,
    cancelled_wait_keeps_execution: true, cancellation_and_input_return_early: true, completion: true }));
} finally { await client.close(); rmSync(root, { recursive: true, force: true }); }
