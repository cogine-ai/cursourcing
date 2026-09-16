import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, chmodSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('bundled MCP server exposes tools and recovers a session across server restarts', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-mcp-test-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const binary = resolve('tests/fake-agent.mjs'); chmodSync(binary, 0o755);
  const clients = [];
  const connect = async () => {
    const client = new Client({ name: 'integration-test', version: '1' });
    // Match this manifest format's host-relative cwd handling; no PLUGIN_ROOT substitution.
    const config = JSON.parse(readFileSync('.mcp.json', 'utf8')).mcpServers.cursourcing;
    const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: resolve(config.cwd),
      env: { ...process.env, CURSOURCING_STATE_DIR: join(root, 'state'), CURSOURCING_BINARY: binary }, stderr: 'pipe' });
    transport.stderr.on('data', () => {});
    await client.connect(transport); clients.push(client); return client;
  };
  const call = async (client, name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  };
  const idle = async (client, id) => {
    let cursor = 0;
    for (let i = 0; i < 100; i++) {
      const value = await call(client, 'wait', { task_ids: [id], after_cursors: { [id]: cursor }, timeout_ms: 1000 });
      const task = value.tasks[0]; cursor = task.next_cursor;
      if (task.task.state === 'idle') return task;
      assert.ok(!['failed', 'interrupted'].includes(task.task.state), JSON.stringify(task));
    }
    throw new Error('Task did not become idle');
  };
  try {
    const one = await connect();
    const tools = await one.listTools();
    assert.equal(tools.tools.length, 9);
    assert.ok(tools.tools.some((t) => t.name === 'read_history'));
    const task = await call(one, 'start_task', { cwd, prompt: 'MOCK:remember:MCP_TOKEN', mode: 'ask', request_id: 'integration' });
    assert.equal(task.cwd, undefined);
    assert.equal(task.requested_config.mode, 'ask');
    const same = await call(one, 'start_task', { cwd, prompt: 'MOCK:remember:MCP_TOKEN', mode: 'ask', request_id: 'integration', detail: 'full' });
    assert.equal(same.task_id, task.task_id);
    assert.equal(same.deduplicated, true); // A different view never starts another execution.
    assert.equal(same.cwd, realpathSync(cwd));
    const result = await idle(one, task.task_id); assert.equal(result.output.text, 'ACK');
    assert.equal(result.task.effective_config.mode, 'ask');
    assert.equal((await call(one, 'read_task', { task_id: task.task_id })).task.cwd, realpathSync(cwd));
    await one.close();
    const two = await connect();
    await call(two, 'resume', { task_id: task.task_id }); await idle(two, task.task_id);
    await call(two, 'send_message', { task_id: task.task_id, prompt: 'MOCK:recall', request_id: 'recall' });
    assert.equal((await idle(two, task.task_id)).output.text, 'MCP_TOKEN');
    const noisy = await call(two, 'start_task', { cwd, prompt: 'MOCK:progress', permissions: 'full-access' });
    const quiet = await call(two, 'wait', { task_ids: [noisy.task_id], timeout_ms: 2000 });
    assert.equal(quiet.timed_out, false);
    assert.equal(quiet.tasks[0].task.permissions, 'full-access');
    assert.equal(quiet.tasks[0].task.state, 'idle');
    assert.equal(quiet.tasks[0].output.text, 'FINAL_REPORT');
    assert.equal(quiet.tasks[0].events, undefined);
    const seen = await call(two, 'wait', { task_ids: [noisy.task_id],
      after_cursors: { [noisy.task_id]: quiet.tasks[0].next_cursor }, timeout_ms: 20 });
    assert.equal(seen.timed_out, true);
    assert.equal(seen.tasks[0].output.text, '');
    assert.equal(seen.tasks[0].task.effective_config, undefined);
    const held = await call(two, 'start_task', { cwd, prompt: 'MOCK:progress-hold' });
    const compact = await call(two, 'wait', { task_ids: [held.task_id], timeout_ms: 50 });
    const full = await call(two, 'wait', { task_ids: [held.task_id], timeout_ms: 0, detail: 'full' });
    assert.equal(compact.timed_out, true);
    assert.equal(compact.tasks[0].task.state, 'running');
    assert.equal(compact.tasks[0].task.progress, undefined);
    assert.equal(compact.tasks[0].task.log_path, undefined);
    assert.equal(compact.tasks[0].output.path, undefined);
    assert.equal(full.tasks[0].task.cwd, realpathSync(cwd));
    assert.ok(full.tasks[0].task.log_path);
    const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
    assert.ok(bytes(compact) < bytes(full) * 0.4);
    await call(two, 'cancel', { task_id: held.task_id });

    const blocked = await call(two, 'start_task', { cwd, prompt: 'MOCK:permission' });
    const pending = await call(two, 'wait', { task_ids: [blocked.task_id], timeout_ms: 2000 });
    const request = pending.tasks[0].task.pending_requests[0];
    assert.equal(request.params.options[0].optionId, 'allow-once');
    const pendingAgain = await call(two, 'wait', { task_ids: [blocked.task_id],
      after_cursors: { [blocked.task_id]: pending.tasks[0].next_cursor }, timeout_ms: 0 });
    assert.equal(pendingAgain.timed_out, false);
    assert.equal(pendingAgain.tasks[0].task.pending_requests[0].request_id, request.request_id);
    await call(two, 'respond', { task_id: blocked.task_id, request_id: request.request_id,
      response: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });
    assert.match((await idle(two, blocked.task_id)).output.text, /allow-once/);

    const failed = await call(two, 'start_task', { cwd, prompt: 'Error: ConnectError: [unavailable] transport closed' });
    const failure = await call(two, 'wait', { task_ids: [failed.task_id], timeout_ms: 2000 });
    assert.equal(failure.tasks[0].task.state, 'failed');
    assert.equal(failure.tasks[0].task.error_code, 'cursor_transport_error');
    assert.match(failure.tasks[0].output.text, /transport closed/);
  } finally {
    await Promise.all(clients.map((client) => client.close())); rmSync(root, { recursive: true, force: true });
  }
});
