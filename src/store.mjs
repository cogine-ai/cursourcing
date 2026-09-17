import * as fs from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';

const JOURNAL_LIMIT = 256 * 1024;
const REPLY_LIMIT = 64 * 1024;
const STRING_LIMIT = 2000;
const LOCATION_LIMIT = 10;
const EVENT_FIELDS = [
  'seq', 'at', 'run_id', 'type', 'state', 'error', 'error_code', 'stop_reason', 'phase', 'pid',
  'request_id', 'method', 'session_id', 'effective_config', 'requested_config',
  'tool_call_id', 'title', 'status', 'kind', 'locations', 'cwd', 'prompt_fingerprint',
  'failure_phase', 'cleanup_status', 'cleanup_error',
];

export function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function workspace(cwd) {
  if (!isAbsolute(cwd)) throw new Error('cwd must be the absolute working directory of the Codex task');
  const path = fs.realpathSync(cwd);
  if (!fs.statSync(path).isDirectory()) throw new Error('cwd must be a directory');
  return path;
}
function isV2(task) {
  return Number(task?.storage_version) === 2;
}
function clipString(value) {
  return typeof value === 'string' && value.length > STRING_LIMIT ? value.slice(0, STRING_LIMIT) : value;
}
function clipValue(value) {
  if (typeof value === 'string') return clipString(value);
  if (Array.isArray(value)) return value.map(clipValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clipValue(item);
    return out;
  }
  return value;
}
function parseDetail(detail) {
  if (detail && typeof detail === 'object') return detail;
  if (typeof detail === 'string') {
    try {
      const parsed = JSON.parse(detail);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch { return undefined; }
  }
  return undefined;
}
function suffixUtf8(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return { text: buf.subarray(start).toString('utf8'), truncated: true };
}
export function compactEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const detail = parseDetail(event.detail);
  const src = { ...detail, ...event };
  if (src.prompt_fingerprint == null && src.fingerprint != null) src.prompt_fingerprint = src.fingerprint;
  if (src.tool_call_id == null && src.toolCallId != null) src.tool_call_id = src.toolCallId;
  const out = {};
  for (const key of EVENT_FIELDS) {
    if (src[key] === undefined) continue;
    if (key === 'locations') {
      if (Array.isArray(src.locations)) out.locations = src.locations.slice(0, LOCATION_LIMIT).map((location) =>
        Object.fromEntries(['path', 'uri', 'line', 'lineNumber'].filter((key) => location?.[key] !== undefined)
          .map((key) => [key, clipString(location[key])])));
      continue;
    }
    out[key] = clipValue(src[key]);
  }
  return out;
}

export function defaultStateRoot(env = process.env, home = homedir()) {
  if (env.CURSOURCING_STATE_DIR) return env.CURSOURCING_STATE_DIR;
  if (env.CODEX_CURSOR_STATE_DIR) return env.CODEX_CURSOR_STATE_DIR;
  const legacy = join(home, '.local/state/codex-cursor');
  return fs.existsSync(legacy) ? legacy : join(home, '.local/state/cursourcing');
}

export class Store {
  constructor(root = defaultStateRoot()) {
    this.root = resolve(root); fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.releases = new Map();
  }
  dir(id) {
    if (!/^[a-z0-9-]{8,80}$/.test(id)) throw new Error('Invalid task ID');
    return join(this.root, id);
  }
  load(id) { return JSON.parse(fs.readFileSync(join(this.dir(id), 'task.json'), 'utf8')); }
  writeAtomic(path, content) {
    const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, path);
  }
  save(task) {
    task.updated_at = new Date().toISOString();
    this.writeAtomic(join(this.dir(task.task_id), 'task.json'), JSON.stringify(task, null, 2));
  }
  journalPath(task) {
    return join(this.dir(task.task_id), isV2(task) ? 'activity.jsonl' : 'events.jsonl');
  }
  create(task) {
    if (task.storage_version == null) task.storage_version = 2;
    try { fs.mkdirSync(this.dir(task.task_id), { mode: 0o700 }); }
    catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    this.save(task);
    fs.writeFileSync(this.journalPath(task), '', { mode: 0o600 });
    return true;
  }
  async acquire(id, instance) {
    const file = join(this.dir(id), 'owner.json');
    if (this.releases.has(id)) return;
    const owner = this.owner(id);
    if (owner && owner.instance !== instance && alive(owner.pid)) {
      throw new Error('This task is owned by another live plugin runtime. Read its status there before resuming.');
    }
    // The lock library can round its first mtime up by a second. Allow retries
    // beyond stale + that precision margin when recovering a dead owner.
    const release = await lockfile.lock(this.dir(id), { stale: 10000, update: 2000,
      retries: { retries: 6, minTimeout: 1000, maxTimeout: 2500 } });
    this.releases.set(id, release);
    const task = this.load(id);
    const journal = this.journalPath(task);
    if (isV2(task) && fs.existsSync(journal)) {
      const bytes = fs.readFileSync(journal);
      if (bytes.length && bytes.at(-1) !== 10) this.writeAtomic(journal, bytes.subarray(0, bytes.lastIndexOf(10) + 1));
    }
    const lastSeq = this.readJournal(task).at(-1)?.seq ?? 0;
    if (lastSeq > task.event_cursor) { task.event_cursor = lastSeq; this.save(task); }
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, instance }), { mode: 0o600 });
  }
  async release(id, instance) {
    const file = join(this.dir(id), 'owner.json');
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).instance === instance) fs.unlinkSync(file); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const release = this.releases.get(id);
    if (release) { this.releases.delete(id); await release(); }
  }
  owner(id) {
    try { return JSON.parse(fs.readFileSync(join(this.dir(id), 'owner.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  append(task, type, data = {}) {
    const event = compactEvent({
      seq: ++task.event_cursor, at: new Date().toISOString(), run_id: task.run_id, type, ...data,
    });
    const path = this.journalPath(task);
    fs.appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    if (isV2(task)) this.enforceJournalLimit(task);
    this.save(task);
    return event;
  }
  enforceJournalLimit(task) {
    const path = this.journalPath(task);
    if (!fs.existsSync(path) || fs.statSync(path).size <= JOURNAL_LIMIT) return;
    const lines = fs.readFileSync(path, 'utf8').split('\n');
    if (lines.at(-1) === '') lines.pop();
    while (lines.length && Buffer.byteLength(`${lines.join('\n')}\n`, 'utf8') > JOURNAL_LIMIT) lines.shift();
    this.writeAtomic(path, lines.length ? `${lines.join('\n')}\n` : '');
  }
  readJournal(task) {
    const path = this.journalPath(task);
    if (!fs.existsSync(path)) return [];
    const events = [];
    for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue;
      try { events.push(compactEvent(JSON.parse(line))); } catch { /* skip corrupt */ }
    }
    return events;
  }
  eventPage(id, after = 0, limit = 50) {
    const task = this.load(id);
    const retained = this.readJournal(task);
    const oldest_cursor = retained[0]?.seq ?? task.event_cursor + 1;
    const events = [];
    for (const event of retained) {
      if (event.seq > after) events.push(event);
      if (events.length >= limit) break;
    }
    return { events, oldest_cursor, events_truncated: after < oldest_cursor - 1 };
  }
  events(id, after = 0, limit = 50) {
    return this.eventPage(id, after, limit).events;
  }
  list() {
    return fs.readdirSync(this.root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => {
      try { return [this.load(e.name)]; } catch { return []; }
    });
  }
  appendOutput(task, text) {
    const path = this.outputPath(task);
    if (!isV2(task)) {
      fs.appendFileSync(path, text, { mode: 0o600 });
      return;
    }
    const current = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
    const { text: clipped, truncated } = suffixUtf8(current + text, REPLY_LIMIT);
    this.writeAtomic(path, clipped);
    if (truncated && !task.output_truncated) {
      task.output_truncated = true;
      this.save(task);
    }
  }
  resetOutput(task) {
    this.writeAtomic(this.outputPath(task), '');
    if (isV2(task) && task.output_truncated) {
      task.output_truncated = false;
      this.save(task);
    }
  }
  outputPath(task) {
    return join(this.dir(task.task_id), isV2(task) ? 'result.md' : `run-${task.run_id}.md`);
  }
  output(task, offset = 0, limit = 20000) {
    const path = this.outputPath(task);
    const text = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
    return {
      text: text.slice(offset, offset + limit),
      next_offset: Math.min(offset + limit, text.length),
      total_chars: text.length,
      path,
      truncated: !!task.output_truncated,
    };
  }
}
