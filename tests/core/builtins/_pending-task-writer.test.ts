/**
 * _pending-task-writer tests
 *
 * Tests for the direct file-based scheduling primitive.
 * Covers: uuid generation, field validation, audit trigger,
 * fs failure propagation, and undefined audit safety.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writePendingSubagentTaskFile } from '../../../src/core/async-task-system/tools/_pending-task-writer.js';
import { TASKS_PENDING_DIR } from '../../../src/types/paths.js';
import type { FileSystem } from '../../../src/foundation/fs/types.js';
import type { AuditWriter } from '../../../src/foundation/audit/writer.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createMockFs(overrides?: Partial<Record<keyof FileSystem, unknown>>) {
  return {
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    writeAtomic: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    list: vi.fn().mockResolvedValue([]),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    isDirectory: vi.fn().mockResolvedValue(false),
    resolve: vi.fn((p: string) => p),
    getPermissions: vi.fn().mockResolvedValue({ owner: 'rw', group: 'r', other: '' }),
    setPermissions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FileSystem;
}

function createMockAudit() {
  return {
    write: vi.fn().mockReturnValue(undefined),
  } as unknown as AuditWriter;
}

function makeArgs(overrides?: Record<string, unknown>) {
  return {
    kind: 'subagent' as const,
    prompt: 'test prompt',
    messages: [],
    tools: ['read'],
    timeout: 3600,
    maxSteps: 100,
    idleTimeoutMs: 30000,
    parentClawId: 'parent-1',
    originClawId: 'origin-1',
    callerType: 'subagent' as const,
    ...overrides,
  };
}

describe('writePendingSubagentTaskFile', () => {
  let mockFs: FileSystem;
  let mockAudit: AuditWriter;

  beforeEach(() => {
    mockFs = createMockFs();
    mockAudit = createMockAudit();
  });

  it('should generate a UUID taskId and write correct fields', async () => {
    const args = makeArgs();
    const taskId = await writePendingSubagentTaskFile(mockFs, mockAudit, args);

    expect(taskId).toMatch(UUID_RE);
    expect(mockFs.writeAtomic).toHaveBeenCalledTimes(1);

    const [filePath, fileContent] = (mockFs.writeAtomic as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filePath).toBe(`${TASKS_PENDING_DIR}/${taskId}.json`);

    const parsed = JSON.parse(fileContent as string);
    expect(parsed.id).toBe(taskId);
    expect(parsed.kind).toBe('subagent');
    expect(parsed.prompt).toBe('test prompt');
    expect(parsed.parentClawId).toBe('parent-1');
    expect(parsed.originClawId).toBe('origin-1');
    expect(parsed.maxSteps).toBe(100);
    expect(parsed.createdAt).toBeTruthy();

    const date = new Date(parsed.createdAt);
    expect(date.toISOString()).toBe(parsed.createdAt);
  });

  it('should trigger audit write with correct event', async () => {
    const args = makeArgs({ parentClawId: 'audit-parent' });
    const taskId = await writePendingSubagentTaskFile(mockFs, mockAudit, args);

    expect(mockAudit.write).toHaveBeenCalledTimes(1);
    expect(mockAudit.write).toHaveBeenCalledWith(
      'task_scheduled',
      taskId,
      'kind=subagent',
      'parent=audit-parent',
    );
  });

  it('should reject when fs.writeAtomic fails', async () => {
    const err = new Error('disk full');
    mockFs = createMockFs({ writeAtomic: vi.fn().mockRejectedValue(err) });
    const args = makeArgs();

    await expect(writePendingSubagentTaskFile(mockFs, mockAudit, args)).rejects.toThrow('disk full');
  });

  it('should be safe when audit is undefined', async () => {
    const args = makeArgs();
    const taskId = await writePendingSubagentTaskFile(mockFs, undefined, args);

    expect(taskId).toMatch(UUID_RE);
    expect(mockFs.writeAtomic).toHaveBeenCalledTimes(1);
    // audit.write should not be called and should not throw
  });
});
