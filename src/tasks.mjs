import { randomUUID, createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { AcpClient, ownedProcessAlive } from './acp.mjs';
import { Store, alive, workspace } from './store.mjs';
import { nativeSessionReference, replayHistory } from './history.mjs';
import { compactTask, compactOutput } from './views.mjs';
import { DIAGNOSTIC_LIMIT, transportFailure } from './transport-failure.mjs';

const ACTIVE = new Set(['initializing', 'resuming', 'running', 'awaiting_input', 'cancelling', 'cleaning']);
const DEFAULT_MODEL = { model: 'grok-4.6', effort: 'xhigh', fast: 'true' };
const errorText = (e) => e instanceof Error ? e.message : String(e);
const digest = (text) => createHash('sha256').update(text).digest('hex');

export class TaskManager {
  constructor({ store = new Store(), clientFactory = (args) => new AcpClient(args), watchFactory = watch } = {}) {
    this.store = store; this.clientFactory = clientFactory; this.watchFactory = watchFactory;
    this.waiters = new Map();
    this.instance = randomUUID(); this.contexts = new Map(); this.histories = new Map(); this.closed = false;
  }
  event(ctx, type, data = {}) { return this.store.append(ctx.task, type, data); }
  state(ctx, state, extra = {}) {
    Object.assign(ctx.task, { state }, extra);
    this.event(ctx, 'state', { state, ...extra });
    // Let the turn's promise settle (including busy=false) before delivering its state.
    // Local waits should not depend on filesystem notification latency.
    setImmediate(() => { for (const notify of this.waiters.get(ctx.task.task_id) ?? []) notify(); });
  }
  paths(task) {
    return { native_session: nativeSessionReference(task),
      log_path: this.store.journalPath(task), output_path: this.store.outputPath(task) };
  }
  snapshot(id, { include_paths = true } = {}) {
    const record = this.store.load(id), owner = this.store.owner(id);
    const ownerAlive = !!owner && alive(owner.pid);
    const { initial_prompt, last_message_prompt, fingerprint, last_message_fingerprint, ...task } = record;
    if (ACTIVE.has(task.state) && !ownerAlive) {
      task.state = 'interrupted'; task.pending_requests = [];
      task.error = 'The owning plugin runtime stopped. Resume loads history; it does not replay the previous prompt.';
    }
    return { ...task, owner_alive: ownerAlive, owned_here: owner?.instance === this.instance,
      ...(['failed', 'interrupted', 'cancelled', 'cleaning'].includes(task.state)
        ? { recovery: this.recovery(task, owner) } : {}),
      ...(include_paths ? this.paths(record) : {}) };
  }
  orphanBlock(task, owner = this.store.owner(task.task_id)) {
    if (owner && alive(owner.pid)) return null;
    // Persisted references are only probed, never signalled by a replacement runtime.
    // PID/group reuse can conservatively block recovery; it must not kill an unrelated process.
    const references = [task.execution_process, task.cleanup_process].filter(Boolean);
    if (references.some(ownedProcessAlive)) return 'previous_execution_running';
    if (task.execution_pending) return 'previous_execution_unknown';
    if (Object.hasOwn(task, 'execution_process')) return null;
    // Older records did not persist execution references. Recover evidence from their
    // journal when possible; an unaccounted-for active legacy task is not safe to replay.
    const pid = this.store.readJournal(task).findLast((event) => event.type === 'initializing' && event.pid)?.pid;
    if (pid) return ownedProcessAlive({ pid, process_group: process.platform !== 'win32' }) || alive(pid)
      ? 'previous_execution_running' : null;
    return ACTIVE.has(task.state) || task.state === 'interrupted' ? 'previous_execution_unknown' : null;
  }
  recovery(task, owner) {
    const session_available = !!task.session_id;
    let reason;
    if (['pending', 'blocked'].includes(task.cleanup_status) &&
        (this.contexts.get(task.task_id)?.busy || !task.cleanup_process || ownedProcessAlive(task.cleanup_process))) {
      reason = 'cleanup_incomplete';
    } else reason = this.orphanBlock(task, owner);
    if (!reason && !session_available) reason = 'no_session';
    if (!reason && owner && owner.instance !== this.instance && alive(owner.pid)) reason = 'owned_by_other_runtime';
    const client = this.contexts.get(task.task_id)?.client;
    if (!reason && client && !client.closed && !client.exited) reason = 'session_connected';
    return { session_available, can_resume: !reason, ...(reason ? { reason } : {}) };
  }
  async context(task) {
    if (this.closed) throw new Error('Plugin runtime is shutting down');
    await this.store.acquire(task.task_id, this.instance);
    if (this.closed) {
      await this.store.release(task.task_id, this.instance);
      throw new Error('Plugin runtime is shutting down');
    }
    if (this.contexts.has(task.task_id)) return this.contexts.get(task.task_id);
    Object.assign(task, this.store.load(task.task_id));
    // Ownership acquisition can wait for a stale lease. Recheck the fresh record
    // before creating a client; another runtime may have changed it during that wait.
    try {
      this.assertCleanupSafe(task.task_id);
      if (this.orphanBlock(task, null)) throw new Error('Previous Cursor execution is not confirmed stopped; recovery is blocked.');
    } catch (error) {
      await this.store.release(task.task_id, this.instance); throw error;
    }
    const ctx = { task, client: null, loading: true, busy: false, pending: new Map(), cancelled: false };
    this.contexts.set(task.task_id, ctx); return ctx;
  }
  launch(ctx, action) {
    ctx.busy = true;
    ctx.work = Promise.resolve().then(action).catch(async (error) => {
      ctx.pending.clear();
      this.state(ctx, 'cleaning', { error: errorText(error), pending_requests: [],
        failure_phase: ctx.loading ? 'initialization' : 'execution', cleanup_status: 'pending',
        cleanup_process: ctx.client?.processReference?.() ?? null });
      await this.cleanup(ctx);
      ctx.busy = false;
      this.state(ctx, this.closed || ctx.cancelled ? 'interrupted' : 'failed');
    }).finally(() => { ctx.busy = false; });
  }
  cleanup(ctx, { force = false } = {}) {
    if (!ctx.client) {
      if (ctx.task.cleanup_status === 'pending') ctx.task.cleanup_status = 'complete';
      return Promise.resolve();
    }
    if (ctx.cleanupPromise) {
      if (force) ctx.client.close({ force: true });
      return ctx.cleanupPromise;
    }
    ctx.cleanupPromise = Promise.resolve().then(() => ctx.client.close({ force })).then((result) => {
      if (result?.stopped === false) {
        Object.assign(ctx.task, { cleanup_status: 'blocked', cleanup_error: result.error,
          cleanup_process: result.process ?? ctx.task.cleanup_process });
      } else {
        ctx.client = null;
        Object.assign(ctx.task, { execution_process: null, execution_pending: false });
        // Closing the execution client cannot confirm a failed replay client's stop.
        if (!(ctx.task.failure_phase === 'history' && ctx.task.cleanup_status === 'blocked')) {
          Object.assign(ctx.task, { cleanup_status: 'complete', cleanup_error: null, cleanup_process: null });
        }
      }
    }, (error) => {
      Object.assign(ctx.task, { cleanup_status: 'blocked', cleanup_error: errorText(error) });
    }).finally(() => this.store.save(ctx.task));
    return ctx.cleanupPromise;
  }
  assertCleanupSafe(id) {
    const task = this.store.load(id);
    if (['pending', 'blocked'].includes(task.cleanup_status)) {
      const owner = this.store.owner(id);
      if (owner && owner.instance !== this.instance && alive(owner.pid)) {
        throw new Error('Cursor cleanup is owned by another live plugin runtime. Wait for it to finish.');
      }
      if (!this.contexts.get(id)?.busy && task.cleanup_process && !ownedProcessAlive(task.cleanup_process)) {
        Object.assign(task, { cleanup_status: 'complete', cleanup_error: null, cleanup_process: null });
        this.store.save(task);
        if (this.contexts.has(id)) Object.assign(this.contexts.get(id).task, task);
      } else {
        throw new Error('Cursor cleanup is not complete. Do not retry or start a replacement in this workspace until the previous process has stopped.');
      }
    }
    const blocked = this.orphanBlock(task);
    if (blocked) throw new Error(blocked === 'previous_execution_running'
      ? 'The previous Cursor process may still be running. Resume, history and replacement work are blocked until it has stopped.'
      : 'The previous Cursor execution cannot be confirmed stopped. Inspect the previous runtime before recovery or replacement work.');
  }
  async start({ cwd, prompt, request_id, mode = 'agent', permissions = 'default' }) {
    cwd = workspace(cwd);
    if (!prompt.trim()) throw new Error('prompt must not be empty');
    if (!['default', 'full-access'].includes(permissions)) throw new Error('permissions must be default or full-access');
    // Keep existing default-mode retry keys compatible with saved tasks.
    const fingerprint = createHash('sha256').update(JSON.stringify({ cwd, prompt, mode,
      ...(permissions === 'default' ? {} : { permissions }) })).digest('hex');
    const id = request_id ? `task-${createHash('sha256').update(`${cwd}\0${request_id}`).digest('hex').slice(0, 32)}` : randomUUID();
    for (const previous of this.store.list()) {
      if (previous.cwd === cwd && previous.task_id !== id) {
        this.assertCleanupSafe(previous.task_id);
      }
    }
    const task = { task_id: id, request_id, fingerprint, cwd, mode, storage_version: 2,
      permissions, requested_config: { ...DEFAULT_MODEL, mode }, state: 'initializing', event_cursor: 0,
      run_id: 1, session_id: null, execution_process: null, execution_pending: false,
      created_at: new Date().toISOString(), pending_requests: [] };
    if (!this.store.create(task)) {
      const existing = this.store.load(id);
      if (existing.fingerprint !== fingerprint) throw new Error('request_id already identifies a different task');
      return { ...this.snapshot(id), deduplicated: true };
    }
    const ctx = await this.context(task);
    this.event(ctx, 'submitted', { prompt_fingerprint: fingerprint, cwd, requested_config: task.requested_config });
    this.launch(ctx, async () => { await this.setup(ctx, false); await this.run(ctx, prompt); });
    return this.snapshot(id);
  }
  async setup(ctx, resume) {
    if (ctx.cancelled || this.closed) throw new Error('Task cancelled before initialization');
    ctx.loading = true;
    ctx.cleanupPromise = null;
    delete ctx.task.failure_phase; delete ctx.task.cleanup_status; delete ctx.task.cleanup_error; delete ctx.task.cleanup_process;
    // Mark the spawn window before launching: a crash before the PID is saved must
    // leave an unknown execution, not an apparently safe task to take over.
    ctx.task.execution_pending = true; this.store.save(ctx.task);
    ctx.client = this.clientFactory({ cwd: ctx.task.cwd, permissions: ctx.task.permissions ?? 'default',
      onUpdate: (params) => this.update(ctx, params),
      onRequest: (request) => this.openRequest(ctx, request),
      onExit: () => {
        if (!this.closed && !ctx.cancelled && !ctx.busy) this.launch(ctx, () => {
          throw new Error('Cursor exited unexpectedly. Resume reloads its conversation without replaying the prompt.');
        });
      },
    });
    ctx.task.execution_process = ctx.client.processReference?.() ?? null;
    ctx.task.execution_pending = !ctx.task.execution_process;
    this.store.save(ctx.task);
    this.event(ctx, 'initializing', { phase: 'authenticate', pid: ctx.client.child.pid });
    await ctx.client.initialize();
    if (ctx.cancelled) throw new Error('Cancelled during initialization');
    this.event(ctx, 'initializing', { phase: resume ? 'load_session' : 'new_session' });
    const params = { cwd: ctx.task.cwd, mcpServers: [] };
    if (resume) params.sessionId = ctx.task.session_id;
    const setup = await ctx.client.request(resume ? 'session/load' : 'session/new', params);
    ctx.task.session_id = resume ? ctx.task.session_id : setup.sessionId;
    if (!ctx.task.session_id) throw new Error('Cursor returned no session ID');
    this.store.save(ctx.task);
    if (ctx.cancelled) throw new Error('Cancelled during session setup');
    const effective = await ctx.client.configure(ctx.task.session_id, setup.configOptions ?? [], ctx.task.requested_config);
    if (ctx.cancelled) throw new Error('Cancelled during configuration');
    ctx.loading = false;
    this.event(ctx, resume ? 'session_restored' : 'session_created', { session_id: ctx.task.session_id, effective_config: effective });
    ctx.task.effective_config = effective; this.store.save(ctx.task);
  }
  update(ctx, params) {
    if (ctx.loading || this.closed) return;
    if (params.sessionId && params.sessionId !== ctx.task.session_id) return;
    if (params._meta?.replay || params._meta?.isReplay || params.update?._meta?.replay) return;
    if (params.extension) {
      this.event(ctx, 'extension', { method: params.extension }); return;
    }
    const u = params.update ?? {}, type = u.sessionUpdate;
    if (type === 'agent_message_chunk' && u.content?.type === 'text') {
      if (ctx.replyNeedsReset) { this.store.resetOutput(ctx.task); ctx.replyNeedsReset = false; }
      this.store.appendOutput(ctx.task, u.content.text);
      ctx.task.progress = (ctx.task.progress ?? '').concat(u.content.text).slice(-300);
      this.store.save(ctx.task);
    } else if (type === 'tool_call' || type === 'tool_call_update') {
      ctx.replyNeedsReset = true;
      if (u.title) ctx.task.progress = u.title.slice(0, 300);
      this.event(ctx, 'tool', { tool_call_id: u.toolCallId, title: u.title, status: u.status, kind: u.kind, locations: u.locations });
    } else if (type === 'plan') {
      this.event(ctx, 'plan', { title: 'Cursor updated its plan' });
    } else if (type === 'config_option_update') {
      ctx.task.effective_config = Object.fromEntries((u.configOptions ?? []).map((o) => [o.id, o.currentValue]));
      this.event(ctx, 'configuration', { effective_config: ctx.task.effective_config });
    }
  }
  openRequest(ctx, request) {
    if (!['session/request_permission', 'cursor/ask_question', 'cursor/create_plan'].includes(request.method)) {
      ctx.client.respondError(request.id, `Unsupported client method: ${request.method}`); return;
    }
    if (ctx.cancelled || this.closed) { ctx.client.respondError(request.id, 'Task cancelled'); return; }
    const id = randomUUID();
    ctx.pending.set(id, request);
    ctx.task.pending_requests = [...ctx.pending].map(([request_id, r]) => ({ request_id, method: r.method, params: r.params }));
    this.state(ctx, 'awaiting_input');
    this.event(ctx, 'input_requested', { request_id: id, method: request.method });
  }
  respond(id, requestId, response) {
    const ctx = this.contexts.get(id), request = ctx?.pending.get(requestId);
    if (!request) throw new Error('No matching live request. Read the current task state; request IDs do not survive a process restart.');
    if (request.method === 'session/request_permission') {
      const outcome = response?.outcome;
      if (outcome?.outcome !== 'cancelled' && !(outcome?.outcome === 'selected' &&
        request.params.options?.some((o) => o.optionId === outcome.optionId))) {
        throw new Error('Return outcome.cancelled or select one of the advertised permission optionIds');
      }
    }
    ctx.client.respond(request.id, response);
    ctx.pending.delete(requestId);
    ctx.task.pending_requests = ctx.task.pending_requests.filter((r) => r.request_id !== requestId);
    this.event(ctx, 'input_answered', { request_id: requestId, method: request.method });
    if (!ctx.pending.size) this.state(ctx, ctx.loading ? 'initializing' : 'running');
    return this.snapshot(id);
  }
  async run(ctx, prompt) {
    if (ctx.cancelled) throw new Error('Task cancelled');
    this.store.resetOutput(ctx.task); ctx.replyNeedsReset = false;
    this.state(ctx, 'running', { error: null, error_code: null, stop_reason: null, progress: null });
    const result = await ctx.client.request('session/prompt', {
      sessionId: ctx.task.session_id, prompt: [{ type: 'text', text: prompt }],
    }, 0);
    // stdout is consumed in order; updates preceding this RPC response are already persisted.
    ctx.pending.clear(); ctx.task.pending_requests = [];
    const reason = result.stopReason;
    const failure = reason === 'end_turn' && transportFailure(this.store.output(ctx.task, 0, DIAGNOSTIC_LIMIT));
    if (failure) {
      this.state(ctx, 'failed', { stop_reason: reason, error_code: 'cursor_transport_error',
        error: `Cursor reported a transport failure: ${failure}` });
      return; // Retain the session and changes; never automatically replay a prompt.
    }
    this.state(ctx, reason === 'end_turn' ? 'idle' : reason === 'cancelled' ? 'cancelled' : 'failed', {
      stop_reason: reason, error: ['end_turn', 'cancelled'].includes(reason) ? null : `Cursor stopped: ${reason}`,
    });
  }
  send(id, prompt, requestId) {
    if (this.histories.has(id)) throw new Error('History is being read. Wait for that read before sending another turn.');
    this.assertCleanupSafe(id);
    const ctx = this.contexts.get(id);
    if (!ctx?.client) throw new Error('Resume this task before sending another message');
    if (requestId && ctx.task.last_message_request_id === requestId) {
      const previous = ctx.task.last_message_fingerprint ?? (ctx.task.last_message_prompt === undefined ? null : digest(ctx.task.last_message_prompt));
      if (previous !== digest(prompt)) throw new Error('Message request_id was reused with different text');
      return { ...this.snapshot(id), deduplicated: true };
    }
    if (ctx.busy) throw new Error('This session is busy. Wait for it, answer its pending request, or cancel before sending a new turn.');
    if (!prompt.trim()) throw new Error('prompt must not be empty');
    ctx.cancelled = false; ctx.task.run_id++;
    ctx.task.last_message_request_id = requestId; ctx.task.last_message_fingerprint = digest(prompt);
    delete ctx.task.last_message_prompt;
    this.state(ctx, 'running', { error: null, error_code: null, stop_reason: null });
    this.event(ctx, 'submitted', { prompt_fingerprint: digest(prompt) });
    this.launch(ctx, () => this.run(ctx, prompt));
    return this.snapshot(id);
  }
  async resume(id) {
    if (this.histories.has(id)) throw new Error('History is being read. Wait before resuming this task.');
    const existing = this.contexts.get(id);
    if (existing?.busy) return this.snapshot(id);
    this.assertCleanupSafe(id);
    if (existing?.busy || (existing?.client && !existing.client.closed && !existing.client.exited)) return this.snapshot(id);
    const task = this.store.load(id);
    if (!task.session_id) throw new Error('No Cursor session was created. Start a new task to retry initialization.');
    workspace(task.cwd);
    const ctx = existing ?? await this.context(task);
    if (ctx.busy) return this.snapshot(id);
    ctx.cancelled = false; ctx.task.pending_requests = [];
    this.state(ctx, 'resuming', { error: null, error_code: null, stop_reason: null });
    this.launch(ctx, async () => { await this.setup(ctx, true); this.state(ctx, 'idle'); });
    return this.snapshot(id);
  }
  async cancel(id) {
    if (this.histories.has(id)) {
      const reading = this.histories.get(id); reading.controller.abort();
      await Promise.allSettled([reading.work]); return this.snapshot(id);
    }
    const ctx = this.contexts.get(id);
    if (!ctx) throw new Error('Task is not owned by this runtime; inspect its state or resume it first');
    if (!ctx.busy) return this.snapshot(id);
    if (ctx.task.state === 'cleaning') { await ctx.work; return this.snapshot(id); }
    ctx.cancelled = true; this.state(ctx, 'cancelling');
    for (const r of ctx.pending.values()) {
      if (r.method === 'session/request_permission') ctx.client.respond(r.id, { outcome: { outcome: 'cancelled' } });
      else ctx.client.respondError(r.id, 'Task cancelled');
    }
    ctx.pending.clear(); ctx.task.pending_requests = []; this.store.save(ctx.task);
    if (ctx.task.session_id && !ctx.loading) {
      try { ctx.client.notify('session/cancel', { sessionId: ctx.task.session_id }); } catch {}
      let timeout;
      await Promise.race([ctx.work, new Promise((resolve) => { timeout = setTimeout(resolve, 4000); })]);
      clearTimeout(timeout);
    }
    if (ctx.busy) { await this.cleanup(ctx); await ctx.work; }
    if (ctx.task.state !== 'cancelled' && !ctx.task.error) this.state(ctx, 'interrupted', { error: 'Execution stopped; Cursor did not confirm cancellation. File changes are retained.' });
    return this.snapshot(id);
  }
  async history(id, { offset = 0, limit = 16000, signal, timeout_ms } = {}) {
    if (this.closed) throw new Error('Plugin runtime is shutting down');
    if (this.contexts.get(id)?.busy || this.histories.has(id)) throw new Error('Task is busy. Read history after execution is idle.');
    this.assertCleanupSafe(id);
    const task = this.store.load(id);
    if (!task.session_id) throw new Error('No Cursor session is available for history');
    const reading = { controller: new AbortController(), work: null };
    this.histories.set(id, reading);
    const abort = () => reading.controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    reading.work = (async () => {
      const ctx = await this.context(task); // Keep the same inter-process ownership lease as execution.
      if (ACTIVE.has(ctx.task.state) && !ctx.busy) {
        this.state(ctx, 'interrupted', { error: 'Previous runtime stopped. Reading history does not restart execution.', pending_requests: [] });
      }
      return replayHistory({ cwd: task.cwd, session_id: task.session_id, offset, limit,
        clientFactory: this.clientFactory, signal: reading.controller.signal, timeout_ms });
    })();
    try { return await reading.work; }
    catch (error) {
      if (error.cleanup) {
        const ctx = this.contexts.get(id);
        this.state(ctx, 'failed', { error: errorText(error), failure_phase: 'history', cleanup_status: 'blocked',
          cleanup_error: error.cleanup.error, cleanup_process: error.cleanup.process });
      }
      throw error;
    }
    finally { this.histories.delete(id); signal?.removeEventListener('abort', abort); }
  }
  read(id, { after_cursor = 0, max_events = 10, output_offset = 0, max_output_chars = 8000,
    include_output = false, suppress_seen_output = false } = {}) {
    const task = this.snapshot(id), page = this.store.eventPage(id, after_cursor, max_events);
    const record = this.store.load(id), events = page.events;
    const output = this.store.output(record, include_output ? output_offset : 0,
      include_output ? max_output_chars : Math.min(8000, max_output_chars));
    if (!include_output && (ACTIVE.has(task.state) || (suppress_seen_output && after_cursor >= task.event_cursor))) {
      output.text = ''; output.next_offset = 0;
    }
    const next = events.at(-1)?.seq ?? (page.events_truncated ? Math.max(after_cursor, page.oldest_cursor - 1) : after_cursor);
    return { task, ...page, next_cursor: next,
      has_more_events: next < task.event_cursor, output };
  }
  async wait(ids, { after_cursors = {}, timeout_ms = 120000, signal, detail = 'full' } = {}) {
    const ready = (task) => task.state === 'awaiting_input' ||
      (!ACTIVE.has(task.state) && (task.event_cursor > (after_cursors[task.task_id] ?? 0) ||
        // A dead owner cannot append an interruption event. Keep that failure visible.
        (task.state === 'interrupted' && !task.owner_alive)));
    let timer, finish;
    const watchers = [], subscriptions = [];
    const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });
    const check = (expired = false) => {
      try {
        const tasks = ids.map((id) => this.snapshot(id, { include_paths: false })), actionable = tasks.some(ready);
        if (!actionable && !expired) return;
        finish.resolve({ timed_out: !actionable, tasks: tasks.map((task) => {
          const after = after_cursors[task.task_id] ?? 0;
          const unread = !ACTIVE.has(task.state) && task.event_cursor > after;
          const output = this.store.output(task, 0, unread ? 8000 : 0);
          return { task: detail === 'full' ? { ...task, ...this.paths(task) } : compactTask(task, { include_config: unread }),
            next_cursor: Math.max(after, task.event_cursor),
            output: detail === 'full' ? output : unread ? compactOutput(output) : { text: '' } };
        }) });
      } catch (error) { finish.reject(error); }
    };
    const abort = () => finish.reject(new Error('Wait cancelled; Cursor tasks continue running'));
    try {
      for (const id of new Set(ids)) {
        let listeners = this.waiters.get(id);
        if (!listeners) this.waiters.set(id, listeners = new Set());
        const notify = () => check();
        listeners.add(notify); subscriptions.push([id, notify]);
        watchers.push(this.watchFactory(this.store.dir(id), notify));
      }
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => check(true), timeout_ms);
      check(); return await done;
    } finally {
      clearTimeout(timer); watchers.forEach((w) => w.close()); signal?.removeEventListener('abort', abort);
      for (const [id, notify] of subscriptions) {
        const listeners = this.waiters.get(id);
        listeners?.delete(notify);
        if (!listeners?.size) this.waiters.delete(id);
      }
    }
  }
  list(cwd) { return this.store.list().filter((t) => !cwd || t.cwd === workspace(cwd)).map((t) => this.snapshot(t.task_id)); }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      const histories = [...this.histories.values()];
      histories.forEach((reading) => reading.controller.abort());
      // Drain execution and replay clients concurrently within the host's exit budget.
      await Promise.all([Promise.allSettled(histories.map((reading) => reading.work)),
        ...[...this.contexts.values()].map(async (ctx) => {
          await this.cleanup(ctx, { force: true }); await ctx.work;
          ctx.pending.clear(); ctx.task.pending_requests = [];
          if (ACTIVE.has(ctx.task.state)) this.state(ctx, 'interrupted', { error: 'Plugin runtime stopped. Resume to reload this conversation.' });
          this.store.save(ctx.task);
        })]);
      for (const ctx of this.contexts.values()) await this.store.release(ctx.task.task_id, this.instance);
    })();
    return this.closePromise;
  }
}
