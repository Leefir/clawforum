/**
 * FileWatcher persistent option tests
 *
 * Module-level mock of chokidar to verify options passed through.
 */

import { describe, it, expect, vi } from 'vitest';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';
import { createWatcher } from '../../src/foundation/file-watcher/index.js';
import { makeAudit } from '../helpers/audit.js';

vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
}));

import * as chokidar from 'chokidar';

describe('createWatcher persistent option', () => {
  const fs = new NodeFileSystem({ baseDir: '/tmp', enforcePermissions: false });

  beforeEach(() => {
    vi.mocked(chokidar.watch).mockClear();
  });

  it('defaults to persistent: true', () => {
    const { audit } = makeAudit();
    createWatcher(fs, 'x', () => {}, audit);
    expect(vi.mocked(chokidar.watch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ persistent: true }),
    );
  });

  it('passes persistent: false through to chokidar', () => {
    const { audit } = makeAudit();
    createWatcher(fs, 'x', () => {}, audit, { persistent: false });
    expect(vi.mocked(chokidar.watch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ persistent: false }),
    );
  });
});
