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
