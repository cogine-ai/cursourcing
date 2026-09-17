import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskManager } from '../src/tasks.mjs';
import { Store } from '../src/store.mjs';
import { AcpClient, ownedProcessAlive } from '../src/acp.mjs';

test('host death cannot transfer a live CLI session or start replacement work',
  { timeout: 25000, skip: process.platform === 'win32' }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-orphan-recovery-'));
    const cwd = join(root, 'project'), state = join(root, 'state'); mkdirSync(cwd);
    const fixture = join(root, 'fake-agent.mjs'), hostPath = join(root, 'host.mjs');
    writeFileSync(fixture, readFileSync(resolve('tests/fake-agent.mjs'), 'utf8')
      .replace('readFileSync, writeFileSync', 'readFileSync, writeFileSync, appendFileSync')
      .replace("process.stdin.on('end', () => process.exit(0));", `
        process.stdin.on('end', () => {});
        setInterval(() => { if (active !== undefined) appendFileSync(join(process.cwd(), '.heartbeat'), 'x'); }, 20);
      `));
    const moduleURL = (path) => JSON.stringify(pathToFileURL(resolve(path)).href);
    writeFileSync(hostPath, `
      import {TaskManager} from ${moduleURL('src/tasks.mjs')};
      import {Store} from ${moduleURL('src/store.mjs')};
      import {AcpClient} from ${moduleURL('src/acp.mjs')};
      import {setTimeout as delay} from 'node:timers/promises';
      const manager = new TaskManager({store:new Store(${JSON.stringify(state)}),
        clientFactory:(a)=>new AcpClient({...a,command:process.execPath,args:[${JSON.stringify(fixture)}]})});
      const task=await manager.start({cwd:${JSON.stringify(cwd)},prompt:'MOCK:hold'});
      while(manager.snapshot(task.task_id).state !== 'running') await delay(10);
      process.stdout.write(JSON.stringify({task_id:task.task_id,session_id:manager.snapshot(task.task_id).session_id,
        process:manager.contexts.get(task.task_id).client.processReference()})+'\\n');
    `);
    let host, old, manager, launches = 0;
    try {
      host = spawn(process.execPath, [hostPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      host.stderr.on('data', () => {});
      const lines = createInterface({ input: host.stdout });
      old = JSON.parse((await once(lines, 'line'))[0]); lines.close();
      const exit = once(host, 'exit'); host.kill('SIGKILL'); await exit;
      assert.equal(ownedProcessAlive(old.process), true);
      manager = new TaskManager({ store: new Store(state), clientFactory: (args) => {
        launches++; return new AcpClient({ ...args, command: process.execPath, args: [fixture] });
      } });
      assert.deepEqual(manager.store.load(old.task_id).execution_process, old.process);
      const status = (await manager.wait([old.task_id], { timeout_ms: 120000, detail: 'compact' })).tasks[0].task;
      assert.equal(status.state, 'interrupted');
      assert.deepEqual(status.recovery, { session_available: true, can_resume: false, reason: 'previous_execution_running' });
      await assert.rejects(manager.resume(old.task_id), /previous Cursor process/);
      await assert.rejects(manager.history(old.task_id), /previous Cursor process/);
      await assert.rejects(manager.start({ cwd, prompt: 'replacement' }), /previous Cursor process/);
      assert.equal(launches, 0);
      await delay(60);
      const heartbeat = readFileSync(join(cwd, '.heartbeat')).length;
      await delay(60);
      assert.ok(readFileSync(join(cwd, '.heartbeat')).length > heartbeat);
      // Stop only the exact fixture process group created above. The plugin never signals it.
      process.kill(-old.process.pid, 'SIGKILL');
      for (let i = 0; ownedProcessAlive(old.process) && i < 100; i++) await delay(20);
      assert.equal(ownedProcessAlive(old.process), false);
      assert.equal(manager.snapshot(old.task_id).recovery.can_resume, true);
      await manager.resume(old.task_id); await manager.contexts.get(old.task_id).work;
      assert.equal(launches, 1); assert.equal(manager.snapshot(old.task_id).state, 'idle');
      assert.equal(manager.snapshot(old.task_id).session_id, old.session_id);
      assert.equal(manager.store.output(manager.store.load(old.task_id)).text, '', 'resume must not replay the original prompt');
      await manager.close();
      assert.equal(manager.store.load(old.task_id).execution_process, null);
    } finally {
      await manager?.close();
      if (host && host.exitCode == null && host.signalCode == null) host.kill('SIGKILL');
      if (old && ownedProcessAlive(old.process)) process.kill(-old.process.pid, 'SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  });

test('uncertain spawn and legacy active records block recovery without signalling or launching', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-unknown-recovery-'));
  mkdirSync(join(root, 'project')); const cwd = realpathSync(join(root, 'project'));
  let launches = 0;
  const manager = new TaskManager({ store: new Store(join(root, 'state')), clientFactory: () => { launches++; throw new Error('must not launch'); } });
  try {
    for (const [suffix, fields] of [
      ['spawn', { execution_process: null, execution_pending: true }], ['legacy', {}],
    ]) {
      const task = { task_id: `task-unknown-${suffix}`, cwd, state: 'running', run_id: 1,
        event_cursor: 0, session_id: 'saved', ...fields };
      manager.store.create(task);
      assert.equal(manager.snapshot(task.task_id).recovery.reason, 'previous_execution_unknown');
      await assert.rejects(manager.resume(task.task_id), /cannot be confirmed stopped/);
      await assert.rejects(manager.history(task.task_id), /cannot be confirmed stopped/);
    }
    await assert.rejects(manager.start({ cwd, prompt: 'replacement' }), /cannot be confirmed stopped/);
    assert.equal(launches, 0);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

test('legacy journal process evidence prevents takeover of a surviving CLI', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-legacy-recovery-'));
  mkdirSync(join(root, 'project')); const cwd = realpathSync(join(root, 'project'));
  const manager = new TaskManager({ store: new Store(join(root, 'state')) });
  try {
    const task = { task_id: 'task-legacy-process', cwd, state: 'running', event_cursor: 0, run_id: 1, session_id: 'legacy-session' };
    manager.store.create(task);
    manager.store.append(task, 'initializing', { pid: process.pid });
    assert.equal(manager.snapshot(task.task_id).recovery.reason, 'previous_execution_running');
    await assert.rejects(manager.resume(task.task_id), /previous Cursor process/);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

test('takeover rechecks execution evidence changed while acquiring ownership', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-recovery-race-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const store = new Store(join(root, 'state'));
  const task = { task_id: 'task-lease-recheck', cwd, state: 'idle', event_cursor: 0, run_id: 1,
    session_id: 'saved-session', execution_process: null, execution_pending: false };
  store.create(task);
  const acquire = store.acquire.bind(store); let launches = 0;
  store.acquire = async (id, instance) => {
    await acquire(id, instance);
    // Emulate a prior runtime having spawned a client after the first safety check.
    store.save({ ...store.load(id), execution_process: { pid: process.pid, process_group: false } });
  };
  const manager = new TaskManager({ store, clientFactory: () => { launches++; throw new Error('must not launch'); } });
  try {
    await assert.rejects(manager.resume(task.task_id), /not confirmed stopped/);
    assert.equal(launches, 0);
    assert.equal(store.owner(task.task_id), null);
    assert.equal(store.releases.size, 0);
    assert.equal(manager.contexts.size, 0);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

test('failure summaries distinguish no session, resumable session and connected session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-recovery-facts-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const managers = [];
  try {
    for (const phase of ['authenticate', 'configure', 'execution']) {
      const manager = new TaskManager({ store: new Store(join(root, phase)), clientFactory: () => ({ child: {},
        initialize: async () => { if (phase === 'authenticate') throw new Error('TLS failed'); },
        request: async (method) => method === 'session/new' ? { sessionId: 'saved-session' } : { stopReason: 'refusal' },
        configure: async () => { if (phase === 'configure') throw new Error('configuration failed'); return {}; },
        close: async () => ({ stopped: true }),
      }) });
      managers.push(manager);
      const { task_id: id } = await manager.start({ cwd, prompt: 'fixture' });
      await manager.contexts.get(id).work;
      const failed = (await manager.wait([id], { timeout_ms: 120000, detail: 'compact' })).tasks[0].task;
      assert.equal(failed.state, 'failed');
      assert.deepEqual(failed.recovery, phase === 'authenticate'
        ? { session_available: false, can_resume: false, reason: 'no_session' }
        : phase === 'configure' ? { session_available: true, can_resume: true }
          : { session_available: true, can_resume: false, reason: 'session_connected' });
      if (phase !== 'execution') assert.equal(failed.failure_phase, 'initialization');
    }
  } finally { await Promise.all(managers.map((m) => m.close())); rmSync(root, { recursive: true, force: true }); }
});
