import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskManager } from '../src/tasks.mjs';
import { Store } from '../src/store.mjs';

test('local completion and blocking input wake waits even when file notifications are delayed', { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-local-wait-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  let clientArgs, complete, promptStarted, closedWatches = 0;
  const started = new Promise((resolve) => { promptStarted = resolve; });
  const manager = new TaskManager({ store: new Store(join(root, 'state')),
    // Simulate an OS watcher that does not deliver notifications during this task.
    watchFactory: () => ({ close() { closedWatches++; } }),
    clientFactory: (args) => {
      clientArgs = args;
      return { child: { pid: process.pid }, initialize: async () => ({}),
        configure: async () => ({ model: 'grok-4.6', effort: 'xhigh', fast: 'true', mode: 'agent' }),
        request: async (method) => {
          if (method === 'session/new') return { sessionId: 'local-session' };
          if (method === 'session/prompt') return new Promise((resolve) => { complete = resolve; promptStarted(); });
          throw new Error(`Unexpected method: ${method}`);
        },
        respond: () => {}, close: async () => { complete?.({ stopReason: 'cancelled' }); },
      };
    } });
  try {
    const task = await manager.start({ cwd, prompt: 'fixture' });
    await started;
    const controller = new AbortController();
    const aborted = manager.wait([task.task_id], { timeout_ms: 120000, signal: controller.signal });
    const rejection = assert.rejects(aborted, /continue running/);
    controller.abort(); await rejection;
    assert.equal(manager.waiters.size, 0);

    const awaitingInput = manager.wait([task.task_id], { timeout_ms: 120000, detail: 'compact' });
    clientArgs.onRequest({ id: 'permission', method: 'session/request_permission', params: {
      options: [{ optionId: 'allow-once', kind: 'allow_once' }], toolCall: { title: 'Fixture' } } });
    const pending = (await awaitingInput).tasks[0];
    assert.equal(pending.task.state, 'awaiting_input');
    manager.respond(task.task_id, pending.task.pending_requests[0].request_id,
      { outcome: { outcome: 'selected', optionId: 'allow-once' } });

    const result = manager.wait([task.task_id], { timeout_ms: 120000, detail: 'compact',
      after_cursors: { [task.task_id]: pending.next_cursor } });
    clientArgs.onUpdate({ sessionId: 'local-session', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LAST_OUTPUT' } } });
    complete({ stopReason: 'end_turn' });
    const done = (await result).tasks[0];
    assert.equal(done.task.state, 'idle');
    assert.equal(done.output.text, 'LAST_OUTPUT');
    assert.equal(manager.contexts.get(task.task_id).busy, false);
    assert.equal(manager.waiters.size, 0);
    assert.equal(closedWatches, 3);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});
