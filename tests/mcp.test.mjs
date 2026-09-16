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
    const result = await idle(one, task.task_id); assert.equal(result.output.text, 'ACK');
    assert.equal(result.task.cwd, realpathSync(cwd));
    await one.close();
    const two = await connect();
    await call(two, 'resume', { task_id: task.task_id }); await idle(two, task.task_id);
    await call(two, 'send_message', { task_id: task.task_id, prompt: 'MOCK:recall', request_id: 'recall' });
    assert.equal((await idle(two, task.task_id)).output.text, 'MCP_TOKEN');
  } finally {
    await Promise.all(clients.map((client) => client.close())); rmSync(root, { recursive: true, force: true });
  }
});
