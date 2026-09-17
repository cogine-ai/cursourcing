import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpClient } from '../src/acp.mjs';
import { TaskManager } from '../src/tasks.mjs';
import { Store } from '../src/store.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('failure is actionable only after shared cleanup settles, without losing its cause', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-cleanup-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const cleaning = deferred(), release = deferred(); let launches = 0, closes = 0;
  const manager = new TaskManager({ store: new Store(join(root, 'state')),
    clientFactory: () => { launches++; return {
      child: {}, initialize: async () => ({}),
      request: async () => ({ sessionId: 'config-failure' }),
      configure: async () => { throw new Error('Cursor did not advertise the effort config option'); },
      close: async () => { closes++; cleaning.resolve(); await release.promise; return { stopped: true }; },
    }; } });
  try {
    const task = await manager.start({ cwd, prompt: 'fixture' }); await cleaning.promise;
    const pending = await manager.wait([task.task_id], { timeout_ms: 30, detail: 'compact' });
    assert.equal(pending.timed_out, true);
    assert.equal(pending.tasks[0].task.state, 'cleaning');
    assert.equal(pending.tasks[0].task.failure_phase, 'initialization');
    assert.equal(pending.tasks[0].task.cleanup_status, 'pending');
    assert.equal((await manager.resume(task.task_id)).state, 'cleaning');
    assert.equal(launches, 1);
    const cancellation = manager.cancel(task.task_id);
    release.resolve(); await cancellation;
    const final = (await manager.wait([task.task_id], { timeout_ms: 500 })).tasks[0].task;
    assert.equal(final.cleanup_status, 'complete');
    assert.match(final.error, /effort config option/);
    assert.equal(manager.contexts.get(task.task_id).busy, false);
    assert.equal(closes, 1);
  } finally { release.resolve(); await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

test('close joins one cleanup and terminates owned descendants holding stdio', { timeout: 10000 }, async () => {
  const client = new AcpClient({ cwd: tmpdir(), command: process.execPath,
    args: ['-e', `const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e','setTimeout(()=>{},5200)'],{stdio:['ignore',1,2]});
      process.stdout.write('ready\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));`],
    onUpdate: () => {}, onRequest: () => {} });
  // Wait until the child has spawned its descendant. Non-JSON stdout is fine for this lifecycle fixture.
  await new Promise((resolve) => client.lines.once('line', resolve));
  const started = Date.now(), first = client.close(), second = client.close();
  try {
    assert.strictEqual(second, first, 'concurrent callers must join the same cleanup');
    const result = await first;
    assert.equal(result.stopped, true);
    assert.ok(Date.now() - started < 3500, 'wrapper exit must not leave its descendant holding pipes');
  } finally { await first; }
});

test('unconfirmed cleanup blocks replacement work across runtime restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-blocked-cleanup-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const state = join(root, 'state'); let launches = 0;
  const factory = () => { launches++; return {
    child: {}, initialize: async () => ({}),
    request: async () => ({ sessionId: 'blocked-session' }),
    configure: async () => { throw new Error('configuration unavailable'); },
    // A live reference for a read-only liveness probe; this fake never signals it.
    processReference: () => ({ pid: process.pid, process_group: false }),
    close: async () => ({ stopped: false, process: { pid: process.pid, process_group: false }, error: 'stop unconfirmed' }),
  }; };
  const manager = new TaskManager({ store: new Store(state), clientFactory: factory });
  let next;
  try {
    const { task_id: id } = await manager.start({ cwd, prompt: 'fixture' });
    await manager.contexts.get(id).work;
    const failed = (await manager.wait([id], { timeout_ms: 10, detail: 'compact' })).tasks[0].task;
    assert.equal(failed.state, 'failed'); assert.equal(failed.cleanup_status, 'blocked');
    assert.equal(failed.failure_phase, 'initialization'); assert.match(failed.error, /configuration/);
    assert.deepEqual(failed.recovery, { session_available: true, can_resume: false, reason: 'cleanup_incomplete' });
    assert.throws(() => manager.send(id, 'retry'), /cleanup/);
    await assert.rejects(manager.resume(id), /cleanup/);
    await manager.close();
    next = new TaskManager({ store: new Store(state), clientFactory: factory });
    await assert.rejects(next.resume(id), /cleanup/);
    await assert.rejects(next.history(id), /cleanup/);
    await assert.rejects(next.start({ cwd, prompt: 'replacement' }), /cleanup/);
    assert.equal(launches, 1);
  } finally { await manager.close(); await next?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('cleanup has a total deadline even when termination cannot be confirmed', { timeout: 9000 }, async (t) => {
  const client = new AcpClient({ cwd: tmpdir(), command: process.execPath,
    args: ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],
    onUpdate: () => {}, onRequest: () => {} });
  const originalKill = process.kill;
  const mocked = t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === -client.child.pid) {
      if (signal === 0) return true;
      throw Object.assign(new Error('fixture permission error'), { code: 'EPERM' });
    }
    return originalKill.call(process, pid, signal);
  });
  try {
    const started = Date.now(), result = await client.close();
    assert.equal(result.stopped, false);
    assert.deepEqual(result.process, { pid: client.child.pid, process_group: true });
    assert.ok(Date.now() - started >= 6000);
    assert.ok(Date.now() - started < 7500);
    assert.match(result.error, /not confirmed/);
  } finally { mocked.mock.restore(); }
});

test('history cleanup failure remains guarded when the execution client closes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-history-blocked-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const manager = new TaskManager({ store: new Store(join(root, 'state')),
    clientFactory: () => ({ child: {}, initialize: async () => ({}), configure: async () => ({}),
      request: async (method) => method === 'session/new' ? { sessionId: 'history-session' } : { stopReason: 'end_turn' },
      close: async () => ({ stopped: true }) }) });
  try {
    const { task_id: id } = await manager.start({ cwd, prompt: 'fixture' });
    await manager.contexts.get(id).work;
    manager.clientFactory = () => ({ initialize: async () => ({}), request: async () => ({}),
      close: async () => ({ stopped: false, process: { pid: process.pid, process_group: false }, error: 'replay stop unconfirmed' }) });
    await assert.rejects(manager.history(id), /replay stop unconfirmed/);
    assert.throws(() => manager.send(id, 'follow up'), /cleanup/);
    await manager.close();
    const task = manager.snapshot(id);
    assert.equal(task.failure_phase, 'history'); assert.equal(task.cleanup_status, 'blocked');
    assert.equal(task.cleanup_process.pid, process.pid);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});
