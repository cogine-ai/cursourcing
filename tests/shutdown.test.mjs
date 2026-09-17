import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ownedProcessAlive } from '../src/acp.mjs';

for (const ending of ['stdin EOF', 'overlapping signals']) {
  test(`host ${ending} drains a TERM-resistant CLI before the host kills MCP`, { timeout: 10000, skip: process.platform === 'win32' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-host-shutdown-'));
    const cwd = join(root, 'project'); mkdirSync(cwd);
    const binary = join(root, 'agent.mjs');
    writeFileSync(binary, readFileSync(resolve('tests/fake-agent.mjs'), 'utf8')
      .replace("process.stdin.on('end', () => process.exit(0));", "process.stdin.on('end', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"), { mode: 0o755 });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server.mjs')],
      env: { ...process.env, CURSOURCING_BINARY: binary, CURSOURCING_STATE_DIR: join(root, 'state') }, stderr: 'pipe' });
    transport.stderr.on('data', () => {});
    const client = new Client({ name: 'shutdown-regression', version: '1' }); let reference;
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'start_task', arguments: { cwd, prompt: 'MOCK:remember:STOP' } });
      const id = result.structuredContent.task_id;
      const done = await client.callTool({ name: 'wait', arguments: { task_ids: [id], timeout_ms: 3000 } });
      assert.equal(done.structuredContent.tasks[0].task.state, 'idle');
      const journal = readFileSync(join(root, 'state', id, 'activity.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      reference = { pid: journal.find((e) => e.type === 'initializing' && e.pid).pid, process_group: true };
      if (ending === 'overlapping signals') {
        process.kill(transport.pid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 50));
        process.kill(transport.pid, 'SIGINT');
      }
      await client.close();
      assert.equal(ownedProcessAlive(reference), false, 'MCP exit must not strand its detached CLI');
      const task = JSON.parse(readFileSync(join(root, 'state', id, 'task.json'), 'utf8'));
      assert.equal(task.cleanup_status, 'complete');
    } finally {
      await client.close();
      if (reference && ownedProcessAlive(reference)) { process.kill(-reference.pid, 'SIGKILL'); await new Promise((r) => setTimeout(r, 100)); }
      rmSync(root, { recursive: true, force: true });
    }
  });
}
