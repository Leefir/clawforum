import { describe, it, expect, vi } from 'vitest';
import {
  auditQueueCrossSource,
  type QueueSnapshot,
} from '../../../src/core/async-task-system/queue-cross-source-audit.js';
import { TASK_AUDIT_EVENTS } from '../../../src/core/async-task-system/audit-events.js';
import { AsyncTaskSystem } from '../../../src/core/async-task-system/system.js';
import { makeTaskSystemDeps } from '../../helpers/task-system.js';
import { SUBAGENT_DEFAULT_TIMEOUT_MS } from '../../helpers/test-timeouts.js';
import type { FileSystem, FileEntry } from '../../../src/foundation/fs/types.js';
import type { AuditLog } from '../../../src/foundation/audit/index.js';

function makeAudit(): { audit: AuditLog; events: Array<[string, ...(string | number)[]]> } {
  const events: Array<[string, ...(string | number)[]]> = [];
  const audit: AuditLog = {
    write: (type: string, ...cols: (string | number)[]) => {
      events.push([type, ...cols]);
    },
    preview: (s: string) => s,
    message: (s: string) => s,
    summary: (s: string) => s,
  };
  return { audit, events };
}

function makeMockFs(overrides?: {
  pendingFiles?: string[];
  runningFiles?: string[];
  listThrow?: boolean;
}): FileSystem {
  const pendingEntries: FileEntry[] = (overrides?.pendingFiles ?? []).map(name => ({
    name: `${name}.json`,
    path: `tasks/queues/pending/${name}.json`,
    isDirectory: false,
    isFile: true,
    size: 100,
    mtime: new Date(),
  }));
  const runningEntries: FileEntry[] = (overrides?.runningFiles ?? []).map(name => ({
    name: `${name}.json`,
    path: `tasks/queues/running/${name}.json`,
    isDirectory: false,
    isFile: true,
    size: 100,
    mtime: new Date(),
  }));

  return {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockImplementation((dir: string) => {
      if (overrides?.listThrow) return Promise.reject(new Error('list_failed'));
      if (dir === 'tasks/queues/pending') return Promise.resolve(pendingEntries);
      if (dir === 'tasks/queues/running') return Promise.resolve(runningEntries);
      return Promise.resolve([]);
    }),
    resolve: vi.fn((p: string) => `/abs/${p}`),
    read: vi.fn().mockResolvedValue(''),
    move: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    writeAtomic: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockImplementation((dir: string) => {
      if (dir === 'tasks/queues/pending') return Promise.resolve(true);
      if (dir === 'tasks/queues/running') return Promise.resolve(true);
      return Promise.resolve(false);
    }),
  } as unknown as FileSystem;
}

describe('async-task queue cross-source audit (phase 239 Step B)', () => {
  describe('QC-1: pending memory === pending disk', () => {
    it('完全一致 → 0 emit', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a', 'b']),
        runningMemoryIds: new Set(),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ pendingFiles: ['a', 'b'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(0);
    });

    it('内存多 1 task → emit + only_memory 字段', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a', 'b']),
        runningMemoryIds: new Set(),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ pendingFiles: ['a'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc1_pending_memory_ne_disk'),
        expect.stringContaining('only_memory=b'),
      ]));
    });

    it('磁盘多 1 task → emit + only_disk 字段', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a']),
        runningMemoryIds: new Set(),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ pendingFiles: ['a', 'c'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc1_pending_memory_ne_disk'),
        expect.stringContaining('only_disk=c'),
      ]));
    });

    it('两侧各多 → emit + both 字段', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a', 'b']),
        runningMemoryIds: new Set(),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ pendingFiles: ['a', 'c'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('only_memory=b'),
        expect.stringContaining('only_disk=c'),
      ]));
    });
  });

  describe('QC-2: running memory === running disk', () => {
    it('完全一致 → 0 emit', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(),
        runningMemoryIds: new Set(['x', 'y']),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ runningFiles: ['x', 'y'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(0);
    });

    it('内存多 1 task → emit', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(),
        runningMemoryIds: new Set(['x', 'y']),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ runningFiles: ['x'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc2_running_memory_ne_disk'),
        expect.stringContaining('only_memory=y'),
      ]));
    });

    it('磁盘多 1 task → emit', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(),
        runningMemoryIds: new Set(['x']),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ runningFiles: ['x', 'z'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc2_running_memory_ne_disk'),
        expect.stringContaining('only_disk=z'),
      ]));
    });
  });

  describe('QC-3: pending ∩ running disjoint', () => {
    it('两 Set 不交 → 0 emit', () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a']),
        runningMemoryIds: new Set(['b']),
        cancellingIds: new Set(),
      };
      // QC-3 是纯内存 check、不依赖 fs
      void auditQueueCrossSource(snapshot, makeMockFs(), audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(0);
    });

    it('1 task in both → emit overlap', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a', 'b']),
        runningMemoryIds: new Set(['b', 'c']),
        cancellingIds: new Set(),
      };
      // 让 disk 与 memory 一致、仅 QC-3 触发
      const fs = makeMockFs({ pendingFiles: ['a', 'b'], runningFiles: ['b', 'c'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc3_pending_running_overlap'),
        expect.stringContaining('overlap_ids=b'),
        expect.stringContaining('overlap_count=1'),
      ]));
    });
  });

  describe('QC-4: cancellingIds 子集', () => {
    it('cancellingIds ⊆ active → 0 emit', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a']),
        runningMemoryIds: new Set(['b']),
        cancellingIds: new Set(['a']),
      };
      // 让 disk 与 memory 一致、仅验证 QC-4
      const fs = makeMockFs({ pendingFiles: ['a'], runningFiles: ['b'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(0);
    });

    it('cancellingIds 含 orphan id → emit orphan', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a']),
        runningMemoryIds: new Set(['b']),
        cancellingIds: new Set(['a', 'orphan']),
      };
      // 让 disk 与 memory 一致、仅 QC-4 触发
      const fs = makeMockFs({ pendingFiles: ['a'], runningFiles: ['b'] });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc4_cancelling_orphan'),
        expect.stringContaining('orphan_ids=orphan'),
        expect.stringContaining('orphan_count=1'),
      ]));
    });
  });

  describe('fs list 失败降级', () => {
    it('fs.list throw → emit _skipped + QC-1/QC-2 跳', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a']),
        runningMemoryIds: new Set(['b']),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ listThrow: true });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      const skipped = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_SKIPPED);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('reason=fs_list_failed'),
        expect.stringContaining('trace=test'),
      ]));
      // QC-1/QC-2 不应 emit（因 fs 失败已 return）
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      // 但 QC-3/QC-4 仍应跑、此处 snapshot 合法故 0 mismatch
      expect(mismatch).toHaveLength(0);
    });

    it('降级时 QC-3/QC-4 仍跑（内存 check 独立）', async () => {
      const { audit, events } = makeAudit();
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(['a']),
        runningMemoryIds: new Set(['a']),
        cancellingIds: new Set(),
      };
      const fs = makeMockFs({ listThrow: true });
      await auditQueueCrossSource(snapshot, fs, audit, 'test');
      // _skipped 1 条 + QC-3 1 条
      const skipped = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_SKIPPED);
      expect(skipped).toHaveLength(1);
      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc3_pending_running_overlap'),
      ]));
    });
  });

  describe('集成', () => {
    it('schedule → ingest → audit 跑、0 mismatch', async () => {
      const { audit, events } = makeAudit();
      const writes: Array<{ path: string; content: string }> = [];
      const mockFs: FileSystem = {
        ensureDir: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        resolve: vi.fn((p: string) => `/abs/${p}`),
        read: vi.fn().mockResolvedValue(''),
        move: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        writeAtomic: vi.fn().mockImplementation((p: string, c: string) => {
          writes.push({ path: p, content: c });
          return Promise.resolve();
        }),
        exists: vi.fn().mockResolvedValue(false),
      } as unknown as FileSystem;

      const system = new AsyncTaskSystem('/tmp/claw', mockFs, {
        auditWriter: audit,
        ...makeTaskSystemDeps(),
      });

      const taskId = await system.schedule('subagent', {
        kind: 'subagent',
        intent: 'test intent',
        timeoutMs: SUBAGENT_DEFAULT_TIMEOUT_MS,
        maxSteps: 5,
        parentClawId: 'claw-1',
        mode: 'standard',
      });

      expect(taskId).toBeTruthy();

      // 手动触发 ingest（无 watcher 时）
      await (system as unknown as { _ingestPendingFile(path: string): Promise<void> })._ingestPendingFile(
        `tasks/queues/pending/${taskId}.json`,
      );

      // 给 microtask 一点时间让 fire-and-forget audit 完成
      await new Promise(r => setTimeout(r, 10));

      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch).toHaveLength(0);

      await system.shutdown(100).catch(() => {});
    });

    it('手动制造内存/磁盘 mismatch → audit emit', async () => {
      const { audit, events } = makeAudit();
      const mockFs: FileSystem = {
        ensureDir: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockImplementation((dir: string) => {
          if (dir === 'tasks/queues/pending') {
            return Promise.resolve([{
              name: 'ghost.json',
              path: 'tasks/queues/pending/ghost.json',
              isDirectory: false,
              isFile: true,
              size: 100,
              mtime: new Date(),
            }]);
          }
          return Promise.resolve([]);
        }),
        resolve: vi.fn((p: string) => `/abs/${p}`),
        read: vi.fn().mockResolvedValue(''),
        move: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        writeAtomic: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockImplementation((p: string) => Promise.resolve(p.includes('pending'))),
      } as unknown as FileSystem;

      const system = new AsyncTaskSystem('/tmp/claw', mockFs, {
        auditWriter: audit,
        ...makeTaskSystemDeps(),
      });

      // 直接 push 一个 task 到 pendingQueue（内存有 task、但磁盘不同）
      (system as unknown as { pendingQueue: Array<unknown> }).pendingQueue.push({
        id: 'memory-task',
        kind: 'subagent',
        intent: 'x',
        timeoutMs: 1000,
        parentClawId: 'c',
        createdAt: '2026-01-01T00:00:00Z',
        mode: 'standard',
      });

      // 手动调 cross-source audit
      const snapshot = {
        pendingMemoryIds: new Set(['memory-task']),
        runningMemoryIds: new Set(),
        cancellingIds: new Set(),
      };
      await auditQueueCrossSource(snapshot, mockFs, audit, 'manual');

      const mismatch = events.filter(e => e[0] === TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH);
      expect(mismatch.length).toBeGreaterThanOrEqual(1);
      expect(mismatch[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('kind=qc1_pending_memory_ne_disk'),
      ]));

      await system.shutdown(100).catch(() => {});
    });

    it('fire-and-forget 模式：主路径不 throw 不阻塞', async () => {
      const { audit, events } = makeAudit();
      const fs = makeMockFs({ listThrow: true });
      const snapshot: QueueSnapshot = {
        pendingMemoryIds: new Set(),
        runningMemoryIds: new Set(),
        cancellingIds: new Set(),
      };
      // 直接 await 应 resolve（不 throw）
      await expect(auditQueueCrossSource(snapshot, fs, audit, 'test')).resolves.toBeUndefined();
      expect(events).toHaveLength(1);
    });
  });
});
