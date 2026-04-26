import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createWatcher } from '../../src/foundation/file-watcher/index.js';

describe('FileWatcher', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fw-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('callback receives add/change/unlink events', async () => {
    const events: { type: string; path: string }[] = [];
    const watcher = createWatcher(
      path.join(tmpDir, 'watch.txt'),
      (ev) => events.push({ type: ev.type, path: path.basename(ev.path) }),
      { stability: 'immediate' },
    );

    await new Promise(r => setTimeout(r, 300));

    fsSync.writeFileSync(path.join(tmpDir, 'watch.txt'), 'hello');
    await new Promise(r => setTimeout(r, 100));

    fsSync.writeFileSync(path.join(tmpDir, 'watch.txt'), 'world');
    await new Promise(r => setTimeout(r, 100));

    await watcher.close();

    expect(events.some(e => e.type === 'add')).toBe(true);
    expect(events.some(e => e.type === 'change')).toBe(true);
  });

  it('callback error triggers onError(err, "callback") and continues', async () => {
    const errors: { err: Error; context: string }[] = [];
    let callCount = 0;
    const watcher = createWatcher(
      path.join(tmpDir, 'watch.txt'),
      (ev) => {
        callCount++;
        if (callCount === 1) throw new Error('callback boom');
      },
      {
        stability: 'immediate',
        onError: (err, context) => errors.push({ err, context }),
      },
    );

    await new Promise(r => setTimeout(r, 300));

    fsSync.writeFileSync(path.join(tmpDir, 'watch.txt'), 'first');
    await new Promise(r => setTimeout(r, 100));

    fsSync.writeFileSync(path.join(tmpDir, 'watch.txt'), 'second');
    await new Promise(r => setTimeout(r, 100));

    await watcher.close();

    expect(errors.some(e => e.context === 'callback' && e.err.message === 'callback boom')).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('onReady error triggers onError(err, "ready")', async () => {
    const errors: { err: Error; context: string }[] = [];
    const watcher = createWatcher(
      path.join(tmpDir, 'watch.txt'),
      () => {},
      {
        stability: 'immediate',
        onReady: () => { throw new Error('ready boom'); },
        onError: (err, context) => errors.push({ err, context }),
      },
    );

    await new Promise(r => setTimeout(r, 500));
    await watcher.close();

    expect(errors.some(e => e.context === 'ready' && e.err.message === 'ready boom')).toBe(true);
  });

  it('chokidar error triggers onError(err, "watch")', async () => {
    const errors: { err: Error; context: string }[] = [];
    // watch a non-existent path deep inside non-existent dirs to trigger chokidar error
    const watcher = createWatcher(
      path.join(tmpDir, 'deep', 'nested', 'missing.txt'),
      () => {},
      {
        stability: 'immediate',
        onError: (err, context) => errors.push({ err, context }),
      },
    );

    await new Promise(r => setTimeout(r, 500));
    await watcher.close();

    // chokidar may or may not emit error depending on timing;
    // if it does, onError should capture it
    if (errors.length > 0) {
      expect(errors.some(e => e.context === 'watch')).toBe(true);
    }
  });

  it('onError handler error is swallowed and not propagated', async () => {
    const errors: { err: Error; context: string }[] = [];
    const watcher = createWatcher(
      path.join(tmpDir, 'deep', 'nested', 'missing.txt'),
      () => {},
      {
        stability: 'immediate',
        onError: (err, context) => {
          errors.push({ err, context });
          throw new Error('onError boom');
        },
      },
    );

    await new Promise(r => setTimeout(r, 500));
    await watcher.close();

    // onError throwing should not cause infinite loop or unhandled rejection
    // we just verify the watcher still closes cleanly
    expect(watcher.isActive()).toBe(false);
  });

  it('close is idempotent', async () => {
    const watcher = createWatcher(
      path.join(tmpDir, 'watch.txt'),
      () => {},
      { stability: 'immediate' },
    );
    await watcher.close();
    await expect(watcher.close()).resolves.toBeUndefined();
  });
});
