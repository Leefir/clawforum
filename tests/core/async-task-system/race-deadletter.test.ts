/**
 * Phase 556: race + dead-letter cluster fix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recoverTasks, type RecoverTasksDeps } from '../../../src/core/async-task-system/task-recovery.js';
import { sendResult } from '../../../src/core/async-task-system/result-delivery.js';
import { AsyncTaskSystem } from '../../../src/core/async-task-system/system.js';
import { TASK_AUDIT_EVENTS } from '../../../src/core/async-task-system/audit-events.js';
import { makeTaskSystemDeps } from '../../helpers/task-system.js';
import type { FileSystem } from '../../../src/foundation/fs/types.js';
import type { AuditLog } from '../../../src/foundation/audit/index.js';

vi.mock('../../../src/core/async-task-system/result-delivery.js', () => ({
  sendResult: vi.fn(),
  sendFallbackError: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockAudit(): { audit: AuditLog; events: Array<[string, ...(string | number)[]]> } {
  const events: Array<[string, ...(string | number)[]]> = [];
  const audit: AuditLog = {
    write: (type: string, ...cols: (string | number)[]) => {
      events.push([type, ...cols]);
    },
  };
  return { audit, events };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('phase 556: race + dead-letter cluster fix', () => {
  // ─── C1 β: cancel during ingest await race ─────────────────────────────────
  describe('C1 β: cancel during _ingestPendingFile fs.read await', () => {
    let system: AsyncTaskSystem;
    let mockFs: FileSystem;
    let auditEvents: Array<[string, ...(string | number)[]]>;

    beforeEach(() => {
      mockFs = {
        ensureDir: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        resolve: vi.fn((p: string) => `/abs/${p}`),
      } as unknown as FileSystem;

      auditEvents = [];
      const audit: AuditLog = {
        write: (type: string, ...cols: (string | number)[]) => {
          auditEvents.push([type, ...cols]);
        },
      };

      system = new AsyncTaskSystem('/tmp/claw', mockFs, {
        auditWriter: audit,
        ...makeTaskSystemDeps(),
      });
    });

    afterEach(async () => {
      await system.shutdown(100).catch(() => {});
    });

    it('cancel during _ingestPendingFile fs.read await must prevent dispatch', async () => {
      const taskId = 'task-race';
      const filePath = `tasks/queues/pending/${taskId}.json`;

      let resolveRead!: (v: string) => void;
      let ingestReadDeferred = true;
      mockFs.read = vi.fn().mockImplementation((path: string) => {
        if (path === filePath && ingestReadDeferred) {
          ingestReadDeferred = false;
          return new Promise((resolve) => { resolveRead = resolve; });
        }
        if (path === filePath) {
          return Promise.resolve(JSON.stringify({
            kind: 'subagent',
            id: taskId,
            intent: 'test',
            timeoutMs: 1000,
            maxSteps: 1,
            parentClawId: 'parent',
            createdAt: new Date().toISOString(),
          }));
        }
        return Promise.resolve('');
      });

      let resolveExists!: (v: boolean) => void;
      mockFs.exists = vi.fn().mockImplementation((path: string) => {
        if (path.includes('pending') && path.includes(taskId)) {
          return new Promise((resolve) => { resolveExists = resolve; });
        }
        return Promise.resolve(false);
      });

      mockFs.move = vi.fn().mockResolvedValue(undefined);

      const pushSpy = vi.spyOn((system as any).pendingQueue, 'push');

      const ingestPromise = (system as any)._ingestPendingFile(filePath);
      const cancelPromise = system.cancel(taskId);

      // 等一个 tick，让 cancel 执行到 await fs.exists 并挂起
      await new Promise((r) => setTimeout(r, 0));

      // resolve fs.read（此时 cancellingIds 中仍有 taskId）
      resolveRead(JSON.stringify({
        kind: 'subagent',
        id: taskId,
        intent: 'test',
        timeoutMs: 1000,
        maxSteps: 1,
        parentClawId: 'parent',
        createdAt: new Date().toISOString(),
      }));

      // 等 ingest 完成
      await ingestPromise;

      // 让 cancel 继续执行
      resolveExists(true);
      await cancelPromise;

      // 断言：pendingQueue.push 未被调用（race re-check 拦截了 ghost dispatch）
      expect(pushSpy).not.toHaveBeenCalled();
    });
  });

  // ─── C2: dead-letter cluster ───────────────────────────────────────────────
  describe('C2: dead-letter cluster', () => {
    const taskJson = JSON.stringify({
      kind: 'subagent',
      id: 'task-dead',
      intent: 'test',
      timeoutMs: 1000,
      maxSteps: 1,
      parentClawId: 'parent',
      createdAt: new Date().toISOString(),
    });

    it('dead-letter path cleans up retry counter file', async () => {
      const { audit, events } = makeMockAudit();
      const retryPath = 'tasks/queues/results/task-dead/result.txt.retry-count';

      const mockFs = {
        list: vi.fn().mockImplementation((dir: string) => {
          if (dir === 'tasks/queues/running') {
            return Promise.resolve([{ name: 'task-dead.json', path: 'tasks/queues/running/task-dead.json' }]);
          }
          return Promise.resolve([]);
        }),
        read: vi.fn().mockImplementation((path: string) => {
          if (path === 'tasks/queues/running/task-dead.json') return Promise.resolve(taskJson);
          if (path === 'tasks/queues/results/task-dead/result.txt') return Promise.resolve('result data');
          if (path === retryPath) return Promise.resolve('3');
          return Promise.resolve('');
        }),
        exists: vi.fn().mockImplementation((path: string) => {
          if (path.includes('.sent')) return Promise.resolve(false);
          if (path === 'tasks/queues/results/task-dead/result.txt') return Promise.resolve(true);
          if (path === retryPath) return Promise.resolve(true);
          return Promise.resolve(false);
        }),
        move: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        writeAtomic: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystem;

      (sendResult as any).mockRejectedValue(new Error('send failed'));

      await recoverTasks({ fs: mockFs, auditWriter: audit, pendingQueue: [] } as RecoverTasksDeps);

      // retryPath 应该被 delete 调用过
      const deleteCalls = (mockFs.delete as any).mock.calls;
      const deletedPaths = deleteCalls.map((c: any) => c[0]);
      expect(deletedPaths).toContain(retryPath);

      // audit 含 RECOVERY_DEAD_LETTER
      const deadLetterEvents = events.filter(
        (e) => e[0] === TASK_AUDIT_EVENTS.RECOVERY_DEAD_LETTER,
      );
      expect(deadLetterEvents.length).toBe(1);
    });

    it('dead-letter move failure audits dead_letter_move_failed', async () => {
      const { audit, events } = makeMockAudit();
      const retryPath = 'tasks/queues/results/task-dead/result.txt.retry-count';

      const mockFs = {
        list: vi.fn().mockImplementation((dir: string) => {
          if (dir === 'tasks/queues/running') {
            return Promise.resolve([{ name: 'task-dead.json', path: 'tasks/queues/running/task-dead.json' }]);
          }
          return Promise.resolve([]);
        }),
        read: vi.fn().mockImplementation((path: string) => {
          if (path === 'tasks/queues/running/task-dead.json') return Promise.resolve(taskJson);
          if (path === 'tasks/queues/results/task-dead/result.txt') return Promise.resolve('result data');
          if (path === retryPath) return Promise.resolve('3');
          return Promise.resolve('');
        }),
        exists: vi.fn().mockImplementation((path: string) => {
          if (path.includes('.sent')) return Promise.resolve(false);
          if (path === 'tasks/queues/results/task-dead/result.txt') return Promise.resolve(true);
          return Promise.resolve(false);
        }),
        move: vi.fn().mockImplementation((_src: string, dest: string) => {
          if (dest.includes('failed')) {
            return Promise.reject(new Error('move to failed failed'));
          }
          return Promise.resolve();
        }),
        delete: vi.fn().mockResolvedValue(undefined),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        writeAtomic: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileSystem;

      (sendResult as any).mockRejectedValue(new Error('send failed'));

      await recoverTasks({ fs: mockFs, auditWriter: audit, pendingQueue: [] } as RecoverTasksDeps);

      const moveFailedEvents = events.filter(
        (e) => e[0] === TASK_AUDIT_EVENTS.RECOVERY_FAILED && e.some((c) => typeof c === 'string' && c.includes('context=dead_letter_move_failed')),
      );
      expect(moveFailedEvents.length).toBe(1);
      expect(moveFailedEvents[0]).toEqual(
        expect.arrayContaining([
          TASK_AUDIT_EVENTS.RECOVERY_FAILED,
          'task-dead',
          'context=dead_letter_move_failed',
          expect.stringContaining('error='),
        ]),
      );
    });
  });
});
