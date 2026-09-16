import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = mkdtempSync(join(tmpdir(), 'cursourcing-live-'));
const stateDir = join(root, 'state'), clients = [];
const report = { started_at: new Date().toISOString(), cli_version: execFileSync(process.env.CURSOURCING_BINARY ?? process.env.CODEX_CURSOR_BINARY ?? join(process.env.HOME, '.local/bin/agent'), ['--version'], { encoding: 'utf8' }).trim(), checks: {} };
const log = (stage, detail = {}) => console.log(JSON.stringify({ stage, ...detail }));
async function connect() {
  const client = new Client({ name: 'cursourcing-live-test', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/server.mjs')],
    env: { ...process.env, CURSOURCING_STATE_DIR: stateDir }, stderr: 'pipe' });
  transport.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await client.connect(transport); clients.push(client); return client;
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
  if (result.isError) throw new Error(`${name}: ${result.content.map((c) => c.text ?? '').join('')}`);
  return result.structuredContent;
}
async function collect(client, ids) {
  const remaining = new Set(ids), results = new Map(), cursors = {}, states = new Map();
  const deadline = Date.now() + 600000;
  while (remaining.size) {
    if (Date.now() > deadline) throw new Error('Live integration test exceeded its ten-minute deadline');
    const result = await call(client, 'wait', { task_ids: [...remaining], after_cursors: cursors, timeout_ms: 30000 });
    for (const item of result.tasks) {
      const task = item.task, id = task.task_id; cursors[id] = item.next_cursor;
      if (states.get(id) !== task.state) { log('task', { task_id: id, state: task.state }); states.set(id, task.state); }
      if (task.state === 'awaiting_input') {
        for (const request of task.pending_requests) {
          if (request.method !== 'session/request_permission') throw new Error(`Unexpected live request: ${JSON.stringify(request)}`);
          const allow = request.params.options.find((o) => o.kind === 'allow_once' || o.optionId === 'allow-once');
          if (!allow) throw new Error('Cursor offered no one-time permission for the isolated test fixture');
          await call(client, 'respond', { task_id: id, request_id: request.request_id,
            response: { outcome: { outcome: 'selected', optionId: allow.optionId } } });
          report.permission_requests_answered = (report.permission_requests_answered ?? 0) + 1;
        }
      }
      if (['failed', 'interrupted', 'cancelled'].includes(task.state)) throw new Error(`Live task did not complete: ${JSON.stringify(item)}`);
      if (task.state === 'idle') { remaining.delete(id); results.set(id, item); }
    }
  }
  return results;
}
try {
  const code = join(root, 'code'), analysis = join(root, 'analysis'); mkdirSync(code); mkdirSync(analysis);
  writeFileSync(join(code, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(code, 'sum.js'), 'export function sum(a, b) { return a - b; }\n');
  writeFileSync(join(code, 'sum.test.mjs'), "import { strict as assert } from 'node:assert';\nimport { sum } from './sum.js';\nassert.equal(sum(7, 5), 12);\nassert.equal(sum(-2, 3), 1);\n");
  const token = `CEDAR_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
  writeFileSync(join(analysis, 'identity.txt'), token);
  let client = await connect();
  assert.equal((await client.listTools()).tools.length, 9);
  const began = Date.now();
  const [a, b] = await Promise.all([
    call(client, 'start_task', { cwd: code, mode: 'agent', request_id: 'fixture-fix',
      prompt: 'In this temporary fixture, fix sum.js so the existing sum.test.mjs passes. Read the two files, change only sum.js, run node --test sum.test.mjs, and report the change and actual test result. No commit is needed.' }),
    call(client, 'start_task', { cwd: analysis, mode: 'ask', request_id: 'fixture-read',
      prompt: 'Read identity.txt in the working directory. Remember its complete contents for a later question in this conversation. Return the contents exactly. Do not modify any files.' }),
  ]);
  report.checks.async_submission_ms = Date.now() - began;
  assert.ok(report.checks.async_submission_ms < 5000, 'Submitting tasks should not wait for Cursor authentication or execution');
  log('submitted', { elapsed_ms: report.checks.async_submission_ms, task_ids: [a.task_id, b.task_id] });
  const completed = await collect(client, [a.task_id, b.task_id]);
  report.initial_results = Object.fromEntries(completed);
  report.edited_source = readFileSync(join(code, 'sum.js'), 'utf8');
  assert.ok(completed.get(b.task_id).output.text.includes(token));
  report.checks.cwd_read = true;
  execFileSync(process.execPath, ['--test', 'sum.test.mjs'], { cwd: code, stdio: 'pipe' });
  report.checks.file_edit_and_independent_test = true;
  const interval = (id) => {
    const events = readFileSync(completed.get(id).task.log_path, 'utf8').trim().split('\n').map(JSON.parse);
    return [Date.parse(events.find((e) => e.type === 'state' && e.state === 'running').at),
      Date.parse(events.findLast((e) => e.type === 'state' && e.state === 'idle').at)];
  };
  const intervals = [interval(a.task_id), interval(b.task_id)];
  report.checks.concurrent_prompt_overlap_ms = Math.max(0, Math.min(...intervals.map((x) => x[1])) - Math.max(...intervals.map((x) => x[0])));
  assert.ok(report.checks.concurrent_prompt_overlap_ms > 0);
  report.effective_config = completed.get(a.task_id).task.effective_config;
  assert.equal(report.effective_config.model, 'grok-4.6'); assert.equal(report.effective_config.effort, 'xhigh'); assert.equal(report.effective_config.fast, 'true');
  const session = completed.get(b.task_id).task.session_id;
  await client.close(); log('mcp_restarted');
  client = await connect(); await call(client, 'resume', { task_id: b.task_id });
  await collect(client, [b.task_id]);
  await call(client, 'send_message', { task_id: b.task_id, request_id: 'recall-after-restart',
    prompt: 'Without reading any files or using tools, return exactly the complete marker from identity.txt that you read earlier in this conversation.' });
  const recalled = (await collect(client, [b.task_id])).get(b.task_id);
  assert.equal(recalled.task.session_id, session); assert.ok(recalled.output.text.includes(token));
  report.checks.cross_process_session_history = true;
  const cancelled = await call(client, 'start_task', { cwd: analysis, mode: 'ask', prompt: 'Reply only READY.' });
  const cancellation = await call(client, 'cancel', { task_id: cancelled.task_id });
  assert.ok(['cancelled', 'interrupted'].includes(cancellation.state));
  report.checks.cancel_during_initialization = true;
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close()));
  // Keep fixture-only evidence even when an assertion fails, before removing the temporary workspace.
  report.task_evidence = existsSync(stateDir) ? readdirSync(stateDir).flatMap((id) => {
    const metadata = join(stateDir, id, 'task.json');
    if (!existsSync(metadata)) return [];
    const task = JSON.parse(readFileSync(metadata, 'utf8'));
    return [{ task,
      events: readFileSync(join(stateDir, id, task.storage_version === 2 ? 'activity.jsonl' : 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
      outputs: Object.fromEntries(readdirSync(join(stateDir, id)).filter((file) => file === 'result.md' || /^run-\d+\.md$/.test(file))
        .map((file) => [file, readFileSync(join(stateDir, id, file), 'utf8')])) }];
  }) : [];
  report.finished_at = new Date().toISOString();
  mkdirSync('verification', { recursive: true });
  writeFileSync('verification/live-report.json', `${JSON.stringify(report, null, 2)}\n`);
  rmSync(root, { recursive: true, force: true });
  log('verification_report', { passed: report.passed, checks: report.checks, error: report.error,
    report_path: resolve('verification/live-report.json') });
}
