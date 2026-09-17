import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AcpClient } from './acp.mjs';

export const HISTORY_TIMEOUT_MS = 50000;

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
  clientFactory = (args) => new AcpClient(args), signal, timeout_ms = HISTORY_TIMEOUT_MS }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000) {
    throw new Error('History offset must be nonnegative and limit must be between 1 and 100000');
  }
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > HISTORY_TIMEOUT_MS) {
    throw new Error(`History timeout must be between 1 and ${HISTORY_TIMEOUT_MS} ms`);
  }
  if (signal?.aborted) throw new Error('History read cancelled');
  let text = '', total = 0, events = 0, stopped;
  const accept = new Set(['user_message_chunk', 'agent_message_chunk', 'tool_call', 'tool_call_update', 'plan']);
  const client = clientFactory({ cwd, onExit: () => {}, onRequest: (request) => {
    client.respondError(request.id, 'History inspection does not execute tools or approve requests');
  }, onUpdate: (params) => {
    if (stopped) return;
    if (params.sessionId && params.sessionId !== session_id) return;
    const update = params.update;
    if (!update || !accept.has(update.sessionUpdate)) return;
    // User/assistant text and tool history only; private thought streams are not exported.
    const line = `${JSON.stringify({ index: ++events, update })}\n`;
    const start = Math.max(0, offset - total), end = Math.min(line.length, offset + limit - total);
    if (end > start) text += line.slice(start, end);
    total += line.length;
  } });
  let rejectStopped;
  const cancelled = new Promise((_, reject) => { rejectStopped = reject; });
  const stop = (error) => {
    if (stopped) return;
    stopped = error; rejectStopped(error);
  };
  const abort = () => stop(new Error('History read cancelled'));
  // One budget covers startup, authentication and replay, rather than allowing
  // each ACP request its own 90 seconds beyond the host's tool-call deadline.
  const timer = setTimeout(() => stop(new Error(
    `History replay timed out after ${timeout_ms} ms. The saved session and cached reply are unchanged; use read_task for the cached reply, or retry read_history only if still needed.`,
  )), timeout_ms);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    await Promise.race([cancelled, (async () => {
      if (stopped) throw stopped;
      const initialized = await client.initialize();
      if (stopped) throw stopped;
      if (initialized?.agentCapabilities?.loadSession === false) throw new Error('Cursor does not support session history loading');
      await client.request('session/load', { sessionId: session_id, cwd, mcpServers: [] });
      if (stopped) throw stopped;
    })()]);
    return { source: 'cursor-acp-replay', session_id, cwd, format: 'jsonl', text,
      offset, next_offset: Math.min(offset + text.length, total), total_chars: total,
      has_more: offset + text.length < total, replayed_events: events,
      history_scope: 'User and assistant messages, tool calls and tool results replayed by Cursor. Not a byte-for-byte protocol log.' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Do not release the manager's history guard while the replay process can
    // still access the session. An unconfirmed stop remains blocked in the store.
    const cleanup = await client.close({ force: signal?.aborted }).catch((error) => ({ stopped: false,
      error: error.message, process: client.processReference?.() ?? null }));
    if (cleanup?.stopped === false) throw Object.assign(new Error(cleanup.error), { cleanup });
  }
}
