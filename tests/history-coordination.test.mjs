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

for (const ending of ['deadline', 'cancel', 'host cancellation']) {
  test(`history ${ending} drains replay before allowing same-session follow-up`, { timeout: 7000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-history-recovery-'));
    const cwd = join(root, 'project'); mkdirSync(cwd);
    const factory = (args) => new AcpClient({ ...args, command: process.execPath, args: [resolve('tests/fake-agent.mjs')] });
    const manager = new TaskManager({ store: new Store(join(root, 'state')), clientFactory: factory });
    const idle = async (id) => {
      let cursor = 0;
      for (let i = 0; i < 50; i++) {
        const { tasks: [result] } = await manager.wait([id], { after_cursors: { [id]: cursor }, timeout_ms: 200 });
        cursor = result.next_cursor;
        if (result.task.state === 'idle') return;
      }
      assert.fail('Task did not become idle');
    };
    let startReplay, startClose, finishClose;
    const replayStarted = new Promise((resolve) => { startReplay = resolve; });
    const closing = new Promise((resolve) => { startClose = resolve; });
    const drained = new Promise((resolve) => { finishClose = resolve; });
    try {
      const task = await manager.start({ cwd, prompt: 'MOCK:remember:HISTORY' });
      const other = await manager.start({ cwd, prompt: 'MOCK:remember:OTHER' });
      await idle(task.task_id); await idle(other.task_id);
      const before = manager.read(task.task_id, { include_output: true });
      manager.clientFactory = () => ({
        initialize: async () => ({}),
        request: () => { startReplay(); return new Promise(() => {}); },
        close: async () => { startClose(); await drained; },
      });
      const controller = new AbortController();
      const reading = manager.history(task.task_id, { timeout_ms: ending === 'deadline' ? 30 : 2000, signal: controller.signal });
      const rejected = assert.rejects(reading, ending === 'deadline' ? /timed out/ : /cancelled/);
      await replayStarted;
      let cancelling;
      if (ending === 'cancel') cancelling = manager.cancel(task.task_id);
      if (ending === 'host cancellation') controller.abort();
      await closing;
      assert.throws(() => manager.send(task.task_id, 'MOCK:recall'), /history/i);
      await assert.rejects(manager.resume(task.task_id), /history/i);
      await assert.rejects(manager.history(task.task_id), /busy/i);
      // Only the history client's session is guarded; other tasks can continue.
      manager.send(other.task_id, 'MOCK:recall'); await idle(other.task_id);
      assert.equal(manager.read(other.task_id, { include_output: true }).output.text, 'OTHER');
      finishClose(); await rejected; await cancelling;
      const after = manager.read(task.task_id, { include_output: true });
      assert.equal(after.output.text, before.output.text);
      assert.equal(after.task.session_id, before.task.session_id);
      assert.equal(after.task.state, 'idle');
      manager.clientFactory = factory;
      const retried = await manager.history(task.task_id);
      assert.match(retried.text, /OLD_REPLAY/);
      manager.send(task.task_id, 'MOCK:recall'); await idle(task.task_id);
      assert.equal(manager.read(task.task_id, { include_output: true }).output.text, 'HISTORY');
      assert.equal(manager.snapshot(task.task_id).session_id, before.task.session_id);
    } finally { finishClose(); await manager.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
