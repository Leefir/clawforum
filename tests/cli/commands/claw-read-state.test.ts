/**
 * claw-read-state command tests (phase 1452 / F-NEXT.1)
 *
 * Coverage: 4 case
 * 1. Missing file: golden (no daemon ran / cleared / first-run)
 * 2. Valid v1 entries: pretty-print + JSON shape
 * 3. Corrupt file: graceful fallback + note
 * 4. Unknown version: skip + note
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';

import { readStateCommand } from '../../../src/cli/commands/claw-read-state.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';
import { READ_STATE_FILE } from '../../../src/foundation/file-tool/file-state-persist.js';
import { createTempDir, cleanupTempDir } from '../../utils/temp.js';

const fsFactory = (dir: string) => new NodeFileSystem({ baseDir: dir });

vi.mock('../../../src/foundation/config/index.js', () => ({
  loadGlobalConfig: vi.fn(),
  clawExists: vi.fn(),
  getClawDir: vi.fn(),
}));

describe('claw-read-state command (phase 1452 / F-NEXT.1)', () => {
  let clawDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stdoutOutput: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    clawDir = await createTempDir();

    const { loadGlobalConfig, clawExists, getClawDir } = await import('../../../src/foundation/config/index.js');
    vi.mocked(loadGlobalConfig).mockReturnValue({} as any);
    vi.mocked(clawExists).mockReturnValue(true);
    vi.mocked(getClawDir).mockReturnValue(clawDir);

    stdoutOutput = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutOutput += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    });
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    vi.clearAllMocks();
    await cleanupTempDir(clawDir);
  });

  it('case 1: missing read-state.json renders ABSENT with explanation', async () => {
    await readStateCommand({ fsFactory }, 'demo-claw');

    expect(stdoutOutput).toContain('Claw: demo-claw');
    expect(stdoutOutput).toContain('Read state file: ABSENT');
    expect(stdoutOutput).toMatch(/No read-state\.json found/);
  });

  it('case 2 (text): valid v1 entries pretty-print with hash + mtime + overwritable', async () => {
    const payload = {
      version: 1,
      updated_at: '2026-05-30T14:30:12.345Z',
      entries: {
        'clawspace/notes.md': {
          hash: 'a'.repeat(64),
          timestamp: 1717000000000,
          isFullRead: true,
        },
        'clawspace/partial.md': {
          hash: 'b'.repeat(64),
          timestamp: 1717000100000,
          isFullRead: false,
        },
      },
    };
    await fs.writeFile(path.join(clawDir, READ_STATE_FILE), JSON.stringify(payload, null, 2));

    await readStateCommand({ fsFactory }, 'demo-claw');

    expect(stdoutOutput).toContain('Read state file: read-state.json');
    expect(stdoutOutput).toContain('Version: 1');
    expect(stdoutOutput).toContain('Entries: 2');
    expect(stdoutOutput).toContain('clawspace/notes.md');
    expect(stdoutOutput).toContain('clawspace/partial.md');
    expect(stdoutOutput).toContain('aaaaaaaaaaaa');  // hash short
    expect(stdoutOutput).toContain('bbbbbbbbbbbb');
    expect(stdoutOutput).toContain('yes');
    expect(stdoutOutput).toContain('no (not full-read)');
  });

  it('case 2 (json): --json produces machine-readable report', async () => {
    const payload = {
      version: 1,
      updated_at: '2026-05-30T14:30:12.345Z',
      entries: {
        'clawspace/x.md': {
          hash: 'c'.repeat(64),
          timestamp: 1717000200000,
          isFullRead: true,
        },
      },
    };
    await fs.writeFile(path.join(clawDir, READ_STATE_FILE), JSON.stringify(payload));

    await readStateCommand({ fsFactory }, 'demo-claw', { json: true });

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.claw).toBe('demo-claw');
    expect(parsed.exists).toBe(true);
    expect(parsed.version).toBe(1);
    expect(parsed.entry_count).toBe(1);
    expect(parsed.entries[0]).toMatchObject({
      path: 'clawspace/x.md',
      hash_short: 'cccccccccccc',
      timestamp_ms: 1717000200000,
      is_full_read: true,
      overwritable: true,
    });
    expect(parsed.entries[0].timestamp_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('case 3: corrupt JSON reports parse failure with note + 0 entries', async () => {
    await fs.writeFile(path.join(clawDir, READ_STATE_FILE), '{not valid json');

    await readStateCommand({ fsFactory }, 'demo-claw', { json: true });

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.exists).toBe(true);
    expect(parsed.entry_count).toBe(0);
    expect(parsed.notes.join(' ')).toMatch(/parse failed/);
  });

  it('case 4: unknown version reports skipped with note + 0 entries', async () => {
    await fs.writeFile(
      path.join(clawDir, READ_STATE_FILE),
      JSON.stringify({ version: 99, updated_at: '', entries: {} }),
    );

    await readStateCommand({ fsFactory }, 'demo-claw', { json: true });

    const parsed = JSON.parse(stdoutOutput);
    expect(parsed.exists).toBe(true);
    expect(parsed.version).toBe(99);
    expect(parsed.entry_count).toBe(0);
    expect(parsed.notes.join(' ')).toMatch(/Unknown version 99/);
  });
});
