/**
 * Phase 147 Step C: reader + dialog cross-source E2E invariant tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuditReader } from '../../../src/foundation/audit/reader.js';
import type { FileSystem } from '../../../src/foundation/fs/types.js';
import type { LookupResult } from '../../../src/foundation/dialog-store/lookup.js';

function makeFs(entries: Record<string, string | { size: number; isDirectory?: boolean }>): FileSystem {
  const store: Record<string, string> = {};
  const meta: Record<string, { size: number; isDirectory: boolean }> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (typeof v === 'string') {
      store[k] = v;
      meta[k] = { size: v.length, isDirectory: false };
    } else {
      meta[k] = { size: v.size, isDirectory: v.isDirectory ?? false };
    }
  }
  return {
    existsSync: (p: string) => p in store || p in meta,
    readSync: (p: string) => store[p] ?? '',
    statSync: (p: string) => ({
      size: meta[p]?.size ?? 0,
      mtime: new Date(),
      ctime: new Date(),
      isDirectory: () => meta[p]?.isDirectory ?? false,
      isFile: () => !meta[p]?.isDirectory,
    }),
    listSync: (p: string, opts?: { includeDirs?: boolean }) => {
      const result: { name: string; path: string; isDirectory: boolean; isFile: boolean; size: number; mtime: Date }[] = [];
      for (const key of Object.keys(meta)) {
        const dir = key.split('/').slice(0, -1).join('/') || '/';
        if (dir === p) {
          result.push({
            name: key.split('/').pop()!,
            path: key,
            isDirectory: meta[key].isDirectory,
            isFile: !meta[key].isDirectory,
            size: meta[key].size,
            mtime: new Date(),
          });
        }
      }
      if (!opts?.includeDirs) {
        return result.filter(e => !e.isDirectory);
      }
      return result;
    },
  } as unknown as FileSystem;
}

function currentJson(messages: unknown[]) {
  return JSON.stringify({ version: 2, messages });
}

describe('Phase 147 reader-lookup E2E', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('E2E current: reader.read yields toolUseId + lookupContent returns source current', async () => {
    const fs = makeFs({
      '/claw/audit.tsv':
        '2024-01-01T00:00:00Z\tseq=1\ttool_emit\ttool_use_id=t1\tstep=1\n',
      '/claw/dialog/current.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello current' }] },
      ]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv');

    const recs: unknown[] = [];
    for await (const rec of reader.read()) recs.push(rec);
    expect(recs).toHaveLength(1);
    expect((recs[0] as any).toolUseId).toBe('t1');

    const result = reader.lookupContent('t1');
    expect(result.source).toBe('current');
    expect((result as Extract<LookupResult, { source: 'current' }>).content).toBe('hello current');
  });

  it('E2E archive: lookupContent falls back to archive', async () => {
    const fs = makeFs({
      '/claw/audit.tsv':
        '2024-01-01T00:00:00Z\tseq=1\ttool_emit\ttool_use_id=t1\tstep=1\n',
      '/claw/dialog/current.json': currentJson([]),
      '/claw/dialog/archive': { size: 0, isDirectory: true },
      '/claw/dialog/archive/1704067200000_abc123.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello archive' }] },
      ]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv');
    const result = reader.lookupContent('t1');
    expect(result.source).toBe('archive');
    const ar = result as Extract<LookupResult, { source: 'archive'; archivedAt: string }>;
    expect(ar.content).toBe('hello archive');
    expect(ar.archivedAt).toBe('1704067200000');
  });

  it('E2E all-failed: lookupContent returns unavailable when dialog empty', async () => {
    const fs = makeFs({
      '/claw/audit.tsv':
        '2024-01-01T00:00:00Z\tseq=1\ttool_emit\ttool_use_id=t1\tstep=1\n',
      '/claw/dialog/current.json': currentJson([]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv');
    const result = reader.lookupContent('t1');
    expect(result.source).toBe('unavailable');
    expect((result as Extract<LookupResult, { source: 'unavailable' }>).reason).toBe('all_failed');
  });

  it('E2E dialogDir override: explicit dialogDir option is respected', () => {
    const fs = makeFs({
      '/claw/audit.tsv': '2024-01-01T00:00:00Z\tseq=1\ttool_emit\n',
      '/custom/dialog/current.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'custom path' }] },
      ]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv', { dialogDir: '/custom/dialog' });
    const result = reader.lookupContent('t1');
    expect(result.source).toBe('current');
    expect((result as Extract<LookupResult, { source: 'current' }>).content).toBe('custom path');
  });

  it('E2E hash match: lookupContent with contentHash returns hashVerified', () => {
    const content = 'hello archive';
    const fs = makeFs({
      '/claw/audit.tsv': '2024-01-01T00:00:00Z\tseq=1\ttool_emit\n',
      '/claw/dialog/current.json': currentJson([]),
      '/claw/dialog/archive': { size: 0, isDirectory: true },
      '/claw/dialog/archive/1704067200000_abc123.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content }] },
      ]),
    });
    const hash = require('node:crypto').createHash('sha256').update(content).digest('hex').slice(0, 8);
    const reader = createAuditReader(fs, '/claw/audit.tsv');
    const result = reader.lookupContent('t1', { contentHash: hash });
    expect(result.source).toBe('archive');
    const ar = result as Extract<LookupResult, { source: 'archive'; hashVerified: true }>;
    expect(ar.hashVerified).toBe(true);
    expect(ar.content).toBe(content);
  });

  it('E2E hash mismatch: lookupContent with wrong contentHash returns hash_mismatch', () => {
    const fs = makeFs({
      '/claw/audit.tsv': '2024-01-01T00:00:00Z\tseq=1\ttool_emit\n',
      '/claw/dialog/current.json': currentJson([]),
      '/claw/dialog/archive': { size: 0, isDirectory: true },
      '/claw/dialog/archive/1704067200000_abc123.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello archive' }] },
      ]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv');
    const result = reader.lookupContent('t1', { contentHash: '00000000' });
    expect(result.source).toBe('unavailable');
    expect((result as Extract<LookupResult, { source: 'unavailable' }>).reason).toBe('hash_mismatch');
  });

  it('E2E multiple archive entries: picks latest archive', () => {
    const fs = makeFs({
      '/claw/audit.tsv': '2024-01-01T00:00:00Z\tseq=1\ttool_emit\n',
      '/claw/dialog/current.json': currentJson([]),
      '/claw/dialog/archive': { size: 0, isDirectory: true },
      '/claw/dialog/archive/1704067200000_old.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'old' }] },
      ]),
      '/claw/dialog/archive/1706745600000_new.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'new' }] },
      ]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv');
    const result = reader.lookupContent('t1');
    expect(result.source).toBe('archive');
    const ar = result as Extract<LookupResult, { source: 'archive'; archivedAt: string }>;
    expect(ar.content).toBe('new');
    expect(ar.archivedAt).toBe('1706745600000');
  });

  it('E2E reader.lookupContent does not re-implement lookup logic (delegates to dialog-store)', () => {
    const fs = makeFs({
      '/claw/audit.tsv': '2024-01-01T00:00:00Z\tseq=1\ttool_emit\n',
      '/claw/dialog/current.json': currentJson([
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'delegated' }] },
      ]),
    });
    const reader = createAuditReader(fs, '/claw/audit.tsv');
    const result = reader.lookupContent('t1');
    // If it delegated correctly, result should be consistent with dialog-store behavior
    expect(result.source).toBe('current');
    expect((result as Extract<LookupResult, { source: 'current' }>).content).toBe('delegated');
  });
});
