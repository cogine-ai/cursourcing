import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskManager } from '../src/tasks.mjs';
import { Store } from '../src/store.mjs';
import { AcpClient } from '../src/acp.mjs';

const fixture = resolve('tests/fake-agent.mjs');
function harness(t) {
  const root = mkdtempSync(join(tmpdir(), 'cursor-runtime-test-'));
  const cwd = join(root, 'workspace'); mkdirSync(cwd);
  const state = join(root, 'state'); const managers = [], launches = [];
  const create = () => {
    const manager = new TaskManager({ store: new Store(state),
      clientFactory: (args) => {
        launches.push(args.permissions);
        return new AcpClient({ ...args, command: process.execPath, args: [fixture] });
      } });
    managers.push(manager); return manager;
  };
  t.after(async () => { await Promise.all(managers.map((m) => m.close())); rmSync(root, { recursive: true, force: true }); });
  return { manager: create(), create, cwd, state, launches };
}
async function until(manager, id, state) {
  let cursor = 0;
  for (let i = 0; i < 100; i++) {
    const { tasks } = await manager.wait([id], { after_cursors: { [id]: cursor }, timeout_ms: 500 });
    const task = tasks[0]; cursor = task.next_cursor;
    if (task.task.state === state) return task;
    if (['failed', 'interrupted'].includes(task.task.state)) throw new Error(JSON.stringify(task));
  }
  throw new Error(`Did not reach ${state}`);
}

test('passes absolute cwd through process + ACP and returns before execution ends', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  await assert.rejects(manager.start({ cwd: '.', prompt: 'x' }), /absolute/);
  const started = await manager.start({ cwd, prompt: 'MOCK:cwd' });
  assert.equal(started.state, 'initializing');
  const result = await until(manager, started.task_id, 'idle');
  assert.deepEqual(JSON.parse(result.output.text), { processCwd: realpathSync(cwd), acpCwd: realpathSync(cwd) });
  assert.equal(result.task.effective_config.effort, 'xhigh');
});

test('separate sessions run concurrently and cancelling a wait leaves both running', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const [a, b] = await Promise.all([manager.start({ cwd, prompt: 'MOCK:hold' }), manager.start({ cwd, prompt: 'MOCK:hold' })]);
  await Promise.all([until(manager, a.task_id, 'running'), until(manager, b.task_id, 'running')]);
  assert.notEqual(manager.snapshot(a.task_id).session_id, manager.snapshot(b.task_id).session_id);
  const after_cursors = Object.fromEntries([a, b].map((task) => [task.task_id, manager.snapshot(task.task_id).event_cursor]));
  const timed = await manager.wait([a.task_id, b.task_id], { after_cursors, timeout_ms: 0 });
  assert.equal(timed.timed_out, true);
  const controller = new AbortController();
  const waiting = manager.wait([a.task_id], { after_cursors, signal: controller.signal });
  controller.abort(); await assert.rejects(waiting, /continue running/);
  assert.equal(manager.snapshot(a.task_id).state, 'running');
  await manager.cancel(a.task_id);
  assert.equal(manager.snapshot(a.task_id).state, 'cancelled');
  assert.equal(manager.snapshot(b.task_id).state, 'running');
  await manager.cancel(b.task_id);
});

test('request keys deduplicate starts and detect incompatible retries', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const input = { cwd, prompt: 'MOCK:hold', request_id: 'one-operation' };
  const first = await manager.start(input), again = await manager.start(input);
  assert.equal(first.task_id, again.task_id); assert.equal(again.deduplicated, true);
  await assert.rejects(manager.start({ ...input, prompt: 'different' }), /different task/);
  await until(manager, first.task_id, 'running'); await manager.cancel(first.task_id);
});

test('permission request is visible and execution resumes only after an answer', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const task = await manager.start({ cwd, prompt: 'MOCK:permission' });
  const pending = await until(manager, task.task_id, 'awaiting_input');
  const request = pending.task.pending_requests[0];
  assert.throws(() => manager.respond(task.task_id, request.request_id, { outcome: { outcome: 'selected', optionId: 'invented' } }), /advertised/);
  manager.respond(task.task_id, request.request_id, { outcome: { outcome: 'selected', optionId: 'allow-once' } });
  const result = await until(manager, task.task_id, 'idle');
  assert.match(result.output.text, /allow-once/); assert.equal(result.task.pending_requests.length, 0);
});

test('restart reloads history, filters replay, and does not rerun the previous task', { timeout: 6000 }, async (t) => {
  const { manager, create, cwd } = harness(t);
  const task = await manager.start({ cwd, prompt: 'MOCK:remember:ALPHA' });
  await until(manager, task.task_id, 'idle');
  const before = manager.snapshot(task.task_id);
  await manager.close();
  const replacement = create(); await replacement.resume(task.task_id);
  const loaded = await until(replacement, task.task_id, 'idle');
  assert.equal(loaded.task.session_id, before.session_id);
  assert.equal(loaded.task.run_id, before.run_id);
  assert.equal(loaded.output.text, 'ACK');
  replacement.send(task.task_id, 'MOCK:recall', 'recall-key');
  const result = await until(replacement, task.task_id, 'idle');
  assert.equal(result.output.text, 'ALPHA');
  assert.equal(replacement.send(task.task_id, 'MOCK:recall', 'recall-key').deduplicated, true);
});

test('live owner cannot be taken over by another runtime', { timeout: 6000 }, async (t) => {
  const { manager, create, cwd } = harness(t);
  const task = await manager.start({ cwd, prompt: 'MOCK:hold' });
  await until(manager, task.task_id, 'running');
  const other = create();
  await assert.rejects(other.resume(task.task_id), /another live/);
  assert.equal(other.snapshot(task.task_id).state, 'running');
  await manager.cancel(task.task_id);
});

test('unexpected exit becomes interrupted and non-success stop reasons are not accepted', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const task = await manager.start({ cwd, prompt: 'MOCK:exit' });
  let last;
  for (let i = 0; i < 30; i++) {
    last = (await manager.wait([task.task_id], { after_cursors: { [task.task_id]: last?.next_cursor ?? 0 }, timeout_ms: 200 })).tasks[0];
    if (['interrupted', 'failed'].includes(last.task.state)) break;
  }
  assert.ok(['interrupted', 'failed'].includes(last.task.state));
  const refused = await manager.start({ cwd, prompt: 'MOCK:refuse' });
  let cursor = 0;
  for (let i = 0; i < 30; i++) {
    last = (await manager.wait([refused.task_id], { after_cursors: { [refused.task_id]: cursor }, timeout_ms: 200 })).tasks[0]; cursor = last.next_cursor;
    if (last.task.state === 'failed') break;
  }
  assert.equal(last.task.stop_reason, 'refusal'); assert.equal(last.task.state, 'failed');
});

test('immediate cancellation and missing executable do not leave pending work', { timeout: 7000 }, async (t) => {
  const { manager, cwd, state } = harness(t);
  const task = await manager.start({ cwd, prompt: 'MOCK:hold' });
  await manager.cancel(task.task_id);
  assert.ok(['cancelled', 'interrupted'].includes(manager.snapshot(task.task_id).state));
  const broken = new TaskManager({ store: new Store(join(state, 'broken')), clientFactory: (a) => new AcpClient({ ...a, command: '/no/such/executable' }) });
  const missing = await broken.start({ cwd, prompt: 'x' });
  let last;
  for (let i = 0; i < 30; i++) {
    last = (await broken.wait([missing.task_id], { after_cursors: { [missing.task_id]: last?.next_cursor ?? 0 }, timeout_ms: 200 })).tasks[0];
    if (last.task.state === 'failed') break;
  }
  assert.equal(last.task.state, 'failed');
  await broken.close();
});

test('wait skips progress pages and delivers the completed report in one response', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const started = await manager.start({ cwd, prompt: 'MOCK:progress' });
  const result = await manager.wait([started.task_id], { timeout_ms: 2000 });
  const item = result.tasks[0];
  assert.equal(result.timed_out, false);
  assert.equal(item.task.state, 'idle');
  assert.equal(item.output.text, 'FINAL_REPORT');
  assert.equal(item.next_cursor, item.task.event_cursor);
  assert.equal(item.events, undefined);
  const progress = manager.read(started.task_id, { after_cursor: 0, max_events: 100 });
  assert.equal(progress.events.filter((e) => e.type === 'tool').length, 26);
});

test('progress remains readable while a quiet wait times out without stopping execution', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const started = await manager.start({ cwd, prompt: 'MOCK:progress-hold' });
  await until(manager, started.task_id, 'running');
  const result = await manager.wait([started.task_id], { timeout_ms: 30 });
  assert.equal(result.timed_out, true);
  assert.equal(result.tasks[0].task.state, 'running');
  assert.equal(result.tasks[0].output.text, '');
  assert.equal(result.tasks[0].events, undefined);
  const progress = manager.read(started.task_id, { max_events: 100, include_output: true });
  assert.equal(progress.output.text, 'Still working');
  assert.equal(progress.events.filter((e) => e.type === 'tool').length, 25);
});

test('seen completion does not wake a multi-task wait; cancellation and new turns still do', { timeout: 6000 }, async (t) => {
  const { manager, cwd } = harness(t);
  const [a, b] = await Promise.all([
    manager.start({ cwd, prompt: 'MOCK:progress' }), manager.start({ cwd, prompt: 'MOCK:hold' }),
  ]);
  const done = await until(manager, a.task_id, 'idle');
  await until(manager, b.task_id, 'running');
  const after_cursors = { [a.task_id]: done.next_cursor, [b.task_id]: manager.snapshot(b.task_id).event_cursor };
  const quiet = await manager.wait([a.task_id, b.task_id], { after_cursors, timeout_ms: 30 });
  assert.equal(quiet.timed_out, true);
  assert.equal(quiet.tasks[0].output.text, '');
  await manager.cancel(b.task_id);
  const cancelled = await manager.wait([a.task_id, b.task_id], { after_cursors, timeout_ms: 2000 });
  assert.equal(cancelled.timed_out, false);
  assert.equal(cancelled.tasks[1].task.state, 'cancelled');
  manager.send(a.task_id, 'MOCK:permission', 'second-turn');
  const pending = await manager.wait([a.task_id], { after_cursors, timeout_ms: 2000 });
  assert.equal(pending.tasks[0].task.state, 'awaiting_input');
  const again = await manager.wait([a.task_id], {
    after_cursors: { [a.task_id]: pending.tasks[0].next_cursor }, timeout_ms: 2000,
  });
  assert.equal(again.timed_out, false);
  const request = again.tasks[0].task.pending_requests[0];
  manager.respond(a.task_id, request.request_id, { outcome: { outcome: 'selected', optionId: 'allow-once' } });
  const resumed = await manager.wait([a.task_id], {
    after_cursors: { [a.task_id]: again.tasks[0].next_cursor }, timeout_ms: 2000,
  });
  assert.equal(resumed.tasks[0].task.state, 'idle');
  assert.match(resumed.tasks[0].output.text, /allow-once/);
});

test('a missing runtime owner remains visible even when its last event was already read', async (t) => {
  const { manager, cwd } = harness(t);
  const task = { task_id: 'task-orphaned-wait', cwd, state: 'running', run_id: 1, event_cursor: 1, pending_requests: [] };
  manager.store.create(task);
  const result = await manager.wait([task.task_id], { after_cursors: { [task.task_id]: 1 }, timeout_ms: 100 });
  assert.equal(result.timed_out, false);
  assert.equal(result.tasks[0].task.state, 'interrupted');
  assert.match(result.tasks[0].task.error, /runtime stopped/);
});

test('execution permissions persist on resume, isolate retries, and do not widen history reads', { timeout: 6000 }, async (t) => {
  const { manager, create, cwd, launches } = harness(t);
  const input = { cwd, prompt: 'MOCK:remember:PERMISSIONS', request_id: 'permission-mode', permissions: 'full-access' };
  const started = await manager.start(input);
  await until(manager, started.task_id, 'idle');
  assert.equal(launches.at(-1), 'full-access');
  assert.equal((await manager.start(input)).deduplicated, true);
  await assert.rejects(manager.start({ ...input, permissions: 'default' }), /different task/);
  await manager.history(started.task_id);
  assert.equal(launches.at(-1), undefined);
  await manager.close();
  const replacement = create();
  await replacement.resume(started.task_id);
  await until(replacement, started.task_id, 'idle');
  assert.equal(launches.at(-1), 'full-access');
  assert.equal(replacement.snapshot(started.task_id).permissions, 'full-access');
  replacement.send(started.task_id, 'MOCK:recall', 'permissions-followup');
  assert.equal((await until(replacement, started.task_id, 'idle')).output.text, 'PERMISSIONS');

  const old = await replacement.start({ cwd, prompt: 'MOCK:remember:OLD' });
  await until(replacement, old.task_id, 'idle');
  const record = replacement.store.load(old.task_id);
  delete record.permissions; replacement.store.save(record);
  await replacement.close();
  const legacy = create(); await legacy.resume(old.task_id);
  await until(legacy, old.task_id, 'idle');
  assert.equal(launches.at(-1), 'default');
});
