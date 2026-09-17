import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeSessionReference, replayHistory } from '../src/history.mjs';

test('history streams bounded pages from native replay without sending a prompt', async () => {
  const methods = [], closed = [], updates = [
    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'user context' } },
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'PRIVATE_THOUGHT' } },
    { sessionUpdate: 'tool_call_update', toolCallId: 'replay-1', rawOutput: { text: 'x'.repeat(10000) } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'final reply' } },
  ];
  const clientFactory = ({ onUpdate }) => ({
    initialize: async () => ({ agentCapabilities: { loadSession: true } }),
    request: async (method) => { methods.push(method); updates.forEach((update) => onUpdate({ sessionId: 'session-1', update })); return {}; },
    close: async () => { closed.push(true); },
  });
  const full = await replayHistory({ cwd: '/tmp', session_id: 'session-1', limit: 20000, clientFactory });
  const a = await replayHistory({ cwd: '/tmp', session_id: 'session-1', limit: 137, clientFactory });
  const b = await replayHistory({ cwd: '/tmp', session_id: 'session-1', offset: a.next_offset, limit: 20000, clientFactory });
  assert.equal(a.text.length, 137); assert.equal(a.has_more, true);
  assert.equal(a.text + b.text, full.text);
  assert.equal(full.replayed_events, 3); assert.ok(!full.text.includes('PRIVATE_THOUGHT'));
  assert.deepEqual(methods, ['session/load', 'session/load', 'session/load']);
  assert.equal(closed.length, 3);
});

test('native file references require an existing matching session and obey Cursor config root', () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-native-reference-'));
  const previous = process.env.CURSOR_CONFIG_DIR;
  process.env.CURSOR_CONFIG_DIR = root;
  try {
    const task = { cwd: '/tmp/project', session_id: 'fixture-session' };
    assert.equal(nativeSessionReference(task).files_verified, false);
    const dir = join(root, 'acp-sessions', task.session_id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ cwd: task.cwd }));
    writeFileSync(join(dir, 'store.db'), 'fixture');
    assert.equal(nativeSessionReference(task).directory, dir);
    assert.equal(nativeSessionReference({ ...task, cwd: '/different' }).files_verified, false);
    assert.equal(nativeSessionReference({ ...task, session_id: '../escape' }).files_verified, false);
  } finally {
    if (previous === undefined) delete process.env.CURSOR_CONFIG_DIR; else process.env.CURSOR_CONFIG_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('cancelling a history read closes its owned ACP client', async () => {
  const controller = new AbortController(); let reject, wasClosed = false;
  const clientFactory = () => ({ initialize: () => new Promise((_, r) => { reject = r; }),
    close: async () => { wasClosed = true; reject?.(new Error('connection closed')); } });
  const reading = replayHistory({ cwd: '/tmp', session_id: 'session-1', clientFactory, signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, /closed|cancelled/); assert.equal(wasClosed, true);
});

for (const phase of ['initialize', 'session/load']) {
  test(`history deadline bounds a stalled ${phase} even without host cancellation`, { timeout: 2000 }, async () => {
    let closed = 0;
    const methods = [];
    const clientFactory = () => ({
      initialize: () => phase === 'initialize' ? new Promise(() => {}) : Promise.resolve({}),
      request: (method) => { methods.push(method); return new Promise(() => {}); },
      // Even a client that does not reject its pending operation on close must
      // not keep the read's public promise and manager guard pending forever.
      close: async () => { closed++; },
    });
    await assert.rejects(replayHistory({ cwd: '/tmp', session_id: 'session-1', clientFactory, timeout_ms: 30 }), /timed out/);
    assert.equal(closed, 1);
    assert.deepEqual(methods, phase === 'initialize' ? [] : ['session/load']);
  });
}

test('history cancellation settles even when initialization does not reject on close', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let finishInitialize, closed = 0, loads = 0;
  const reading = replayHistory({ cwd: '/tmp', session_id: 'session-1', signal: controller.signal,
    clientFactory: () => ({
      initialize: () => new Promise((resolve) => { finishInitialize = resolve; }),
      request: async () => { loads++; },
      close: async () => { closed++; },
    }),
  });
  const rejected = assert.rejects(reading, /cancelled/);
  controller.abort();
  await rejected;
  finishInitialize({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  assert.equal(loads, 0); // A late initialization must not start replay after cancellation.
});

test('an already cancelled history call creates no client', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(replayHistory({ cwd: '/tmp', session_id: 'session-1', signal: controller.signal,
    clientFactory: () => { assert.fail('should not spawn'); },
  }), /cancelled/);
});

test('history shares one deadline across initialization and replay', { timeout: 2000 }, async () => {
  const delay = () => new Promise((resolve) => setTimeout(resolve, 60));
  let closed = false;
  await assert.rejects(replayHistory({ cwd: '/tmp', session_id: 'session-1', timeout_ms: 100,
    clientFactory: () => ({
      initialize: async () => { await delay(); return {}; },
      request: delay,
      close: async () => { closed = true; },
    }),
  }), /timed out/);
  assert.equal(closed, true);
});
