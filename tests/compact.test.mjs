import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskManager } from '../src/tasks.mjs';
import { AcpClient } from '../src/acp.mjs';
import { Store } from '../src/store.mjs';

test('large tool results stay out of bridge storage and default replies; completed output is not repeated', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-compact-result-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const manager = new TaskManager({ store: new Store(join(root, 'state')),
    clientFactory: (args) => new AcpClient({ ...args, command: process.execPath, args: [resolve('tests/fake-agent.mjs')] }) });
  try {
    const started = await manager.start({ cwd, prompt: 'MOCK:compact' });
    let cursor = 0, result;
    for (let i = 0; i < 50; i++) {
      result = (await manager.wait([started.task_id], { after_cursors: { [started.task_id]: cursor }, timeout_ms: 200 })).tasks[0];
      cursor = result.next_cursor;
      if (result.task.state === 'idle') break;
      assert.equal(result.output.text, '');
    }
    assert.equal(result.task.state, 'idle'); assert.equal(result.output.text, 'FINAL_REPORT');
    assert.ok(JSON.stringify(result).length < 10000);
    const journal = readFileSync(result.task.log_path, 'utf8');
    assert.ok(!journal.includes('RAW_TOOL_SECRET')); assert.ok(!journal.includes('Earlier progress'));
    const seen = (await manager.wait([started.task_id], { after_cursors: { [started.task_id]: cursor }, timeout_ms: 0 })).tasks[0];
    assert.equal(seen.output.text, '');
    assert.equal(manager.read(started.task_id, { include_output: true, output_offset: 6 }).output.text, 'REPORT');
    const history = await manager.history(started.task_id, { limit: 2000 });
    assert.match(history.text, /OLD_REPLAY_SHOULD_NOT_APPEAR/);
    assert.equal(manager.read(started.task_id).output.text, 'FINAL_REPORT');
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});

test('UTF-8 reply and event journal are bounded, old cursor gaps are explicit, legacy reads preserve original files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-compact-store-'));
  const store = new Store(root);
  try {
    const task = { task_id: 'task-bounded-fixture', cwd: root, event_cursor: 0, run_id: 1 };
    store.create(task);
    store.appendOutput(task, '界'.repeat(40000) + 'FINAL_END');
    assert.ok(statSync(store.outputPath(task)).size <= 65536);
    const output = store.output(task, 0, 100000);
    assert.equal(output.truncated, true); assert.ok(output.text.endsWith('FINAL_END'));
    assert.ok(!output.text.includes('\ufffd'));
    for (let i = 0; i < 500; i++) store.append(task, 'tool', { title: '界'.repeat(600), tool_call_id: String(i), rawOutput: 'omit' });
    assert.ok(statSync(store.journalPath(task)).size <= 262144);
    const page = store.eventPage(task.task_id, 0, 10);
    assert.equal(page.events_truncated, true); assert.ok(page.oldest_cursor > 1);
    assert.equal(store.events(task.task_id, task.event_cursor - 1, 1)[0].seq, task.event_cursor);
    const old = { task_id: 'task-legacy-fixture', cwd: root, event_cursor: 1, run_id: 1 };
    mkdirSync(store.dir(old.task_id)); store.save(old);
    const raw = JSON.stringify({ seq: 1, type: 'tool', detail: JSON.stringify({ rawOutput: 'KEEP_LEGACY_RAW', kind: 'read' }) }) + '\n';
    writeFileSync(store.journalPath(old), raw);
    assert.equal(store.events(old.task_id)[0].kind, 'read');
    assert.ok(!JSON.stringify(store.events(old.task_id)).includes('KEEP_LEGACY_RAW'));
    assert.equal(readFileSync(store.journalPath(old), 'utf8'), raw);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('recovering a partial journal keeps event cursors monotonic after a crash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-journal-recovery-'));
  const store = new Store(root);
  try {
    const task = { task_id: 'task-crash-fixture', cwd: root, event_cursor: 0, run_id: 1 };
    store.create(task); store.append(task, 'state', { state: 'running' });
    task.event_cursor = 0; store.save(task); // Simulate crash after the journal write, before metadata.
    appendFileSync(store.journalPath(task), '{"seq":2');
    await store.acquire(task.task_id, 'fixture-owner');
    const recovered = store.load(task.task_id);
    assert.equal(recovered.event_cursor, 1);
    store.append(recovered, 'state', { state: 'resuming' });
    assert.deepEqual(store.events(task.task_id).map((e) => e.seq), [1, 2]);
    await store.release(task.task_id, 'fixture-owner');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
