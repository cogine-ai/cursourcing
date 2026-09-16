import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskManager } from '../src/tasks.mjs';
import { AcpClient } from '../src/acp.mjs';
import { Store } from '../src/store.mjs';

test('history inspection blocks new turns and shutdown drains its owned client', { timeout: 7000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-history-lifecycle-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const factory = (args) => new AcpClient({ ...args, command: process.execPath, args: [resolve('tests/fake-agent.mjs')] });
  const manager = new TaskManager({ store: new Store(join(root, 'state')), clientFactory: factory });
  let historyStarted, rejectHistory, closed = false;
  const started = new Promise((resolve) => { historyStarted = resolve; });
  try {
    const task = await manager.start({ cwd, prompt: 'MOCK:remember:HISTORY' });
    let cursor = 0;
    for (let i = 0; i < 50; i++) {
      const { tasks: [result] } = await manager.wait([task.task_id], { after_cursors: { [task.task_id]: cursor }, timeout_ms: 200 });
      cursor = result.next_cursor;
      if (result.task.state === 'idle') break;
    }
    assert.equal(manager.snapshot(task.task_id).state, 'idle');
    manager.clientFactory = () => ({ initialize: async () => ({ agentCapabilities: { loadSession: true } }),
      request: () => { historyStarted(); return new Promise((_, reject) => { rejectHistory = reject; }); },
      close: async () => { closed = true; rejectHistory?.(new Error('History connection closed')); } });
    const reading = manager.history(task.task_id, { offset: 0, limit: 1000 });
    const rejected = assert.rejects(reading, /closed|cancel/i);
    await started;
    assert.throws(() => manager.send(task.task_id, 'MOCK:recall'), /history|busy/i);
    await manager.close();
    await rejected;
    assert.equal(closed, true);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});
