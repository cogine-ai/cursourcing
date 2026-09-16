import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { transportFailure } from '../src/transport-failure.mjs';
import { TaskManager } from '../src/tasks.mjs';
import { Store } from '../src/store.mjs';
import { AcpClient } from '../src/acp.mjs';

const diagnostic = 'Error: RetriableError: WritableIterable is closed';
test('only complete standalone transport diagnostics are classified as failures', () => {
  for (const message of [diagnostic, 'Error: ConnectError: [unavailable] closed',
    'Error: ConnectError: [aborted] disconnected', 'Error: ConnectError: [deadline_exceeded] timed out',
    'Something went wrong communicating with the server. Please try again.']) {
    assert.equal(transportFailure({ text: message }), message);
    assert.equal(transportFailure({ text: `\r\n${message}\r\n    at send (cli.js:1:2)\r\n` }), message);
  }
  for (const text of [`Explaining a failure:\n${diagnostic}`, `${diagnostic}\nRecovered successfully.`,
    `> ${diagnostic}`, `    ${diagnostic}`, `\x60\x60\x60text\n${diagnostic}\n\x60\x60\x60`,
    'Error: ConnectError: [unauthenticated] log in', 'Error: ConnectError: [permission_denied] denied',
    'Error: RetriableError: [internal] Failed to run step, exceeded max retries',
    'Error: HTTP 500 in the application being debugged', '', `${diagnostic}\n${'x'.repeat(9000)}`]) {
    assert.equal(transportFailure({ text }), null, text.slice(0, 100));
  }
  assert.equal(transportFailure({ text: diagnostic, truncated: true }), null);
  assert.equal(transportFailure({ text: diagnostic, total_chars: 20000 }), null);
});

test('last chunks before end_turn are classified; the session can continue without automatic replay', { timeout: 6000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-transport-test-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  const manager = new TaskManager({ store: new Store(join(root, 'state')),
    clientFactory: (args) => new AcpClient({ ...args, command: process.execPath, args: [resolve('tests/fake-agent.mjs')] }) });
  try {
    const task = await manager.start({ cwd, prompt: `MOCK:chunks:${JSON.stringify([...diagnostic])}` });
    const failed = (await manager.wait([task.task_id], { timeout_ms: 2000, detail: 'compact' })).tasks[0];
    assert.equal(failed.task.state, 'failed');
    assert.equal(failed.task.stop_reason, 'end_turn');
    assert.equal(failed.task.error_code, 'cursor_transport_error');
    assert.equal(failed.output.text, diagnostic);
    const session = manager.snapshot(task.task_id).session_id;
    assert.equal(manager.snapshot(task.task_id).run_id, 1);
    assert.equal(manager.read(task.task_id).events.at(-1).error_code, 'cursor_transport_error');

    manager.send(task.task_id, 'Recovered successfully.', 'explicit-follow-up');
    const done = (await manager.wait([task.task_id], { after_cursors: { [task.task_id]: failed.next_cursor },
      timeout_ms: 2000, detail: 'compact' })).tasks[0];
    assert.equal(done.task.state, 'idle');
    assert.equal(done.task.error_code, undefined);
    assert.equal(done.output.text, 'Recovered successfully.');
    assert.equal(manager.snapshot(task.task_id).session_id, session);
    assert.equal(done.task.run_id, 2);

    // The bounded cache can retain only the diagnostic tail of a long, normal answer.
    const clipped = await manager.start({ cwd,
      prompt: `MOCK:chunks:${JSON.stringify(['An explanation: '.repeat(6000), `\n${diagnostic}`])}` });
    const normal = (await manager.wait([clipped.task_id], { timeout_ms: 2000, detail: 'compact' })).tasks[0];
    assert.equal(normal.task.state, 'idle');
    assert.equal(normal.output.truncated, true);
    assert.equal(normal.output.next_offset, 8000);
    assert.ok(normal.output.total_chars > normal.output.next_offset);
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }); }
});
