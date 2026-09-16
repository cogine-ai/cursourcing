import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultStateRoot } from '../src/store.mjs';
import { cursorBinary } from '../src/acp.mjs';

test('renamed state keeps preview sessions discoverable and respects explicit configuration', () => {
  const home = mkdtempSync(join(tmpdir(), 'cursourcing-config-'));
  try {
    assert.equal(defaultStateRoot({}, home), join(home, '.local/state/cursourcing'));
    const legacy = join(home, '.local/state/codex-cursor');
    mkdirSync(legacy, { recursive: true });
    assert.equal(defaultStateRoot({}, home), legacy);
    assert.equal(defaultStateRoot({ CODEX_CURSOR_STATE_DIR: '/old' }, home), '/old');
    assert.equal(defaultStateRoot({ CURSOURCING_STATE_DIR: '/new', CODEX_CURSOR_STATE_DIR: '/old' }, home), '/new');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('new binary setting takes precedence while the preview setting remains supported', () => {
  const keys = ['CURSOURCING_BINARY', 'CODEX_CURSOR_BINARY'];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.CURSOURCING_BINARY = '/new/agent';
    process.env.CODEX_CURSOR_BINARY = '/old/agent';
    assert.equal(cursorBinary(), '/new/agent');
    delete process.env.CURSOURCING_BINARY;
    assert.equal(cursorBinary(), '/old/agent');
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
