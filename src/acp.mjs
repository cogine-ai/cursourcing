import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function cursorBinary() {
  if (process.env.CURSOURCING_BINARY) return process.env.CURSOURCING_BINARY;
  if (process.env.CODEX_CURSOR_BINARY) return process.env.CODEX_CURSOR_BINARY;
  const installed = join(homedir(), '.local/bin/agent');
  return existsSync(installed) ? installed : 'cursor-agent';
}

// Owns one CLI process and one root ACP session. It outlives individual MCP calls.
export function cursorArgs(permissions = 'default') {
  if (permissions === 'full-access') return ['--trust', '--force', '--sandbox', 'disabled', 'acp'];
  if (permissions === 'default') return ['--trust', '--sandbox', 'enabled', 'acp'];
  throw new Error('permissions must be default or full-access');
}

export class AcpClient {
  constructor({ cwd, permissions = 'default', command = cursorBinary(), args = cursorArgs(permissions), onUpdate, onRequest, onExit }) {
    this.pending = new Map(); this.sequence = 0; this.closed = false;
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.onUpdate = onUpdate; this.onRequest = onRequest; this.onExit = onExit;
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); }
      catch { this.fail(new Error('Invalid JSON on Cursor ACP stdout')); return; }
      if (message.method) {
        if (message.id !== undefined) {
          Promise.resolve().then(() => this.onRequest(message)).catch((error) => {
            this.respondError(message.id, error.message);
          });
        } else if (message.method === 'session/update') {
          this.onUpdate(message.params);
        } else if (message.method.startsWith('cursor/')) {
          this.onUpdate({ extension: message.method, params: message.params });
        }
      } else {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data ?? {})}`));
        else pending.resolve(message.result ?? {});
      }
    });
    // Drain stderr separately; credentials and auth responses never enter task traces.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code, signal) => {
      this.exited = true;
      this.fail(new Error(`Cursor process exited (${code ?? signal})`));
      if (!this.closed) this.onExit?.(code, signal);
    });
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.failure = error;
  }
  write(message) {
    if (this.closed || this.exited || this.failure) throw this.failure ?? new Error('Cursor process is closed');
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }
  request(method, params, timeout = 90000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => {
        this.pending.delete(id); reject(new Error(`ACP ${method} timed out after ${timeout} ms`));
      }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method, params) { this.write({ method, params }); }
  respond(id, result) { this.write({ id, result }); }
  respondError(id, message) {
    try { this.write({ id, error: { code: -32601, message } }); } catch {}
  }
  async initialize() {
    const info = await this.request('initialize', {
      protocolVersion: 1, clientInfo: { name: 'cursourcing', version: '0.2.1' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false,
        _meta: { parameterizedModelPicker: true } },
    });
    await this.request('authenticate', { methodId: 'cursor_login' });
    return info;
  }
  async configure(sessionId, options, requested) {
    for (const [id, value] of Object.entries(requested)) {
      const option = options.find((o) => o.id === id);
      if (!option) throw new Error(`Cursor did not advertise the ${id} config option`);
      if (String(option.currentValue) === String(value)) continue;
      const result = await this.request('session/set_config_option', { sessionId, configId: id, value });
      options = result.configOptions ?? [];
      if (String(options.find((o) => o.id === id)?.currentValue) !== String(value)) {
        throw new Error(`Cursor did not confirm requested ${id}=${value}`);
      }
    }
    const effective = Object.fromEntries(options.map((o) => [o.id, o.currentValue]));
    for (const [key, value] of Object.entries(requested)) {
      if (String(effective[key]) !== String(value)) throw new Error(`Cursor configuration changed unexpectedly: ${key}`);
    }
    return effective;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error('Cursor connection closed'));
    if (this.exited) return;
    await new Promise((resolve) => {
      const terminate = setTimeout(() => this.child.kill('SIGTERM'), 1500);
      const kill = setTimeout(() => this.child.kill('SIGKILL'), 4000);
      this.child.once('close', () => { clearTimeout(terminate); clearTimeout(kill); resolve(); });
      this.child.stdin.end();
    });
    this.lines.close();
  }
}
