import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AcpClient } from './acp.mjs';

// A verified convenience reference for the observed Cursor CLI layout, not its public API.
// Recovery uses the returned ACP session ID + cwd, never the database's internal schema.
export function nativeSessionReference(task) {
  const reference = { session_id: task.session_id, cwd: task.cwd, history_method: 'session/load', files_verified: false };
  if (!task.session_id || !/^[a-zA-Z0-9_-]{1,160}$/.test(task.session_id)) return reference;
  const config = process.env.CURSOR_CONFIG_DIR?.trim() ||
    (process.env.XDG_CONFIG_HOME?.trim() ? join(process.env.XDG_CONFIG_HOME, 'cursor') : join(homedir(), '.cursor'));
  const directory = resolve(task.cwd, config, 'acp-sessions', task.session_id);
  const metadata = join(directory, 'meta.json'), database = join(directory, 'store.db');
  try {
    const meta = JSON.parse(readFileSync(metadata, 'utf8'));
    if (typeof meta.cwd === 'string' && resolve(meta.cwd) === resolve(task.cwd) && existsSync(database)) {
      Object.assign(reference, { files_verified: true, directory, metadata_path: metadata, database_path: database });
    }
  } catch { /* The current CLI may use a different layout. ACP remains the source of truth. */ }
  return reference;
}

// Stream a requested character window from ACP replay. No transcript copy or prompt is created.
// Each page reloads history, so offsets should be reused only while the conversation is unchanged.
export async function replayHistory({ cwd, session_id, offset = 0, limit = 16000,
  clientFactory = (args) => new AcpClient(args), signal }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000) {
    throw new Error('History offset must be nonnegative and limit must be between 1 and 100000');
  }
  if (signal?.aborted) throw new Error('History read cancelled');
  let client, closing, text = '', total = 0, events = 0;
  const accept = new Set(['user_message_chunk', 'agent_message_chunk', 'tool_call', 'tool_call_update', 'plan']);
  const close = () => closing ??= Promise.resolve(client.close());
  const abort = () => { void close(); };
  client = clientFactory({ cwd, onExit: () => {}, onRequest: (request) => {
    client.respondError(request.id, 'History inspection does not execute tools or approve requests');
  }, onUpdate: (params) => {
    if (params.sessionId && params.sessionId !== session_id) return;
    const update = params.update;
    if (!update || !accept.has(update.sessionUpdate)) return;
    // User/assistant text and tool history only; private thought streams are not exported.
    const line = `${JSON.stringify({ index: ++events, update })}\n`;
    const start = Math.max(0, offset - total), end = Math.min(line.length, offset + limit - total);
    if (end > start) text += line.slice(start, end);
    total += line.length;
  } });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const initialized = await client.initialize();
    if (signal?.aborted) throw new Error('History read cancelled');
    if (initialized?.agentCapabilities?.loadSession === false) throw new Error('Cursor does not support session history loading');
    await client.request('session/load', { sessionId: session_id, cwd, mcpServers: [] });
    if (signal?.aborted) throw new Error('History read cancelled');
    return { source: 'cursor-acp-replay', session_id, cwd, format: 'jsonl', text,
      offset, next_offset: Math.min(offset + text.length, total), total_chars: total,
      has_more: offset + text.length < total, replayed_events: events,
      history_scope: 'User and assistant messages, tool calls and tool results replayed by Cursor. Not a byte-for-byte protocol log.' };
  } finally {
    signal?.removeEventListener('abort', abort);
    await close();
  }
}
