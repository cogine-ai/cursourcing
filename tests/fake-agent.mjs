#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

let session, active, permission, timer;
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const reply = (id, result = {}) => send({ id, result });
const save = () => writeFileSync(join(process.cwd(), `.fake-${session.id}.json`), JSON.stringify(session));
const config = () => Object.entries(session.config).map(([id, currentValue]) => ({ id, currentValue, type: 'select' }));
function text(value) {
  send({ method: 'session/update', params: { sessionId: session.id,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } } } });
}
function finish(value, stopReason = 'end_turn') {
  if (value) text(value);
  if (active !== undefined) reply(active, { stopReason });
  active = undefined;
}
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line), p = m.params ?? {};
  if (!m.method) {
    if (m.id === permission) { permission = null; finish(JSON.stringify(m.result ?? m.error)); }
    return;
  }
  if (m.method === 'initialize') return reply(m.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
  if (m.method === 'authenticate') return reply(m.id);
  if (m.method === 'session/new') {
    session = { id: randomUUID(), config: { model: 'grok-4.6', effort: 'xhigh', fast: 'true', mode: 'agent' }, cwd: p.cwd };
    save(); return reply(m.id, { sessionId: session.id, configOptions: config() });
  }
  if (m.method === 'session/load') {
    session = JSON.parse(readFileSync(join(process.cwd(), `.fake-${p.sessionId}.json`), 'utf8'));
    if (session.holdHistory) return; // Simulate a replay that never answers its ACP request.
    text('OLD_REPLAY_SHOULD_NOT_APPEAR');
    return reply(m.id, { configOptions: config() });
  }
  if (m.method === 'session/set_config_option') {
    session.config[p.configId] = p.value; save(); return reply(m.id, { configOptions: config() });
  }
  if (m.method === 'session/cancel') { clearTimeout(timer); finish('', 'cancelled'); return; }
  if (m.method === 'session/prompt') {
    active = m.id;
    const prompt = p.prompt.map((part) => part.text ?? '').join('');
    if (prompt === 'MOCK:history-hold') { session.holdHistory = true; save(); return finish('HISTORY_READY'); }
    if (prompt === 'MOCK:history-release') { delete session.holdHistory; save(); return finish('HISTORY_RELEASED'); }
    if (prompt === 'MOCK:hold') return;
    if (prompt === 'MOCK:progress' || prompt === 'MOCK:progress-hold') {
      for (let i = 0; i < 25; i++) {
        send({ method: 'session/update', params: { sessionId: session.id, update: {
          sessionUpdate: 'tool_call_update', toolCallId: `progress-${i}`, title: `Read fixture ${i}`, status: 'completed',
        } } });
      }
      text('Still working');
      if (prompt === 'MOCK:progress') timer = setTimeout(() => {
        send({ method: 'session/update', params: { sessionId: session.id, update: {
          sessionUpdate: 'tool_call_update', toolCallId: 'last-tool', title: 'Finish fixture', status: 'completed',
        } } });
        finish('FINAL_REPORT');
      }, 50);
      return;
    }
    if (prompt === 'MOCK:exit') return process.exit(7);
    if (prompt === 'MOCK:refuse') return finish('Cannot comply', 'refusal');
    if (prompt.startsWith('MOCK:chunks:')) {
      for (const chunk of JSON.parse(prompt.slice('MOCK:chunks:'.length))) text(chunk);
      return finish('');
    }
    if (prompt === 'MOCK:compact') {
      text('Earlier progress that should not become the final reply');
      send({ method: 'session/update', params: { sessionId: session.id, update: {
        sessionUpdate: 'tool_call_update', toolCallId: 'large-tool', title: 'Read large fixture', status: 'completed',
        rawOutput: { text: 'RAW_TOOL_SECRET'.repeat(100000) }, content: [{ type: 'text', text: 'RAW_TOOL_SECRET' }],
      } } });
      return finish('FINAL_REPORT');
    }
    if (prompt === 'MOCK:permission') {
      permission = 'permission-1';
      send({ id: permission, method: 'session/request_permission', params: { sessionId: session.id,
        toolCall: { toolCallId: 'tool-1', title: 'Write fixture', kind: 'edit' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] } });
      return;
    }
    if (prompt.startsWith('MOCK:remember:')) { session.token = prompt.slice(14); save(); return finish('ACK'); }
    if (prompt === 'MOCK:recall') return finish(session.token ?? 'MISSING');
    if (prompt === 'MOCK:cwd') return finish(JSON.stringify({ processCwd: process.cwd(), acpCwd: session.cwd }));
    if (prompt.startsWith('MOCK:delay:')) {
      timer = setTimeout(() => finish('DELAYED_DONE'), Number(prompt.slice(11))); return;
    }
    return finish(prompt);
  }
  send({ id: m.id, error: { code: -32601, message: 'Not implemented by fixture' } });
});
process.stdin.on('end', () => process.exit(0));
