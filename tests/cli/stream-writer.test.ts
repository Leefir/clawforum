/**
 * StreamWriter tests — fix 5: writeSync exception guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsNative from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StreamWriter } from '../../src/cli/commands/stream-writer.js';

describe('StreamWriter', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sw-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('write() when fd is null is a no-op and does not throw', () => {
    const sw = new StreamWriter(tmpDir);
    // fd is null before open()
    expect(() => sw.write({ ts: 1, type: 'test' })).not.toThrow();
  });

  it('write() when writeSync throws logs to stderr and does not propagate', () => {
    const sw = new StreamWriter(tmpDir);
    sw.open();

    // Close the raw fd externally so writeSync will throw EBADF,
    // while StreamWriter still thinks fd is open.
    const rawFd = (sw as unknown as { fd: number }).fd;
    fsNative.closeSync(rawFd);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => sw.write({ ts: 1, type: 'test' })).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[StreamWriter]'),
      expect.anything(),
    );

    // Do NOT call sw.close() here — fd is already closed; skip to avoid double-close noise.
  });

  it('open + write × 2 + close produces valid JSON lines', async () => {
    const sw = new StreamWriter(tmpDir);
    sw.open();
    sw.write({ ts: 1000, type: 'turn_start' });
    sw.write({ ts: 2000, type: 'turn_end' });
    sw.close();

    const raw = await fsp.readFile(path.join(tmpDir, 'stream.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ ts: 1000, type: 'turn_start' });
    expect(lines[1]).toMatchObject({ ts: 2000, type: 'turn_end' });
  });
});
