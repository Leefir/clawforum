import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// File-level shared mocks (vi.mock hoists / phase 1240 refactor)
// ─────────────────────────────────────────────────────────────────────

const mockAuditWrite = vi.fn();

vi.mock('../../src/foundation/fs/node-fs.js', () => ({
  NodeFileSystem: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/foundation/audit/index.js', () => ({
  createSystemAudit: vi.fn(() => ({
    write: mockAuditWrite,
    preview: vi.fn((s: string) => s),
    message: vi.fn((s: string) => s),
    summary: vi.fn((s: string) => s),
  })),
  AUDIT_FILE: 'audit.tsv',
}));

vi.mock('../../src/foundation/config/index.js', () => ({
  getClawDir: vi.fn(() => '/tmp/test-claw'),
  getNamedSubrootDir: vi.fn(() => '/tmp/test-motion'),
}));

vi.mock('../../src/daemon/daemon.js', () => ({
  createDaemonCommand: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}));

/**
 * daemon-entry.ts top-level `await import` 拉 assembly + daemon + foundation
 * transitive graph (~10+ module)。isolated project (isolate: true) 591 file
 * 并行冷 transform 下超 vitest 全局 hookTimeout 10s floor (实测 report:
 * transform 40s / collect 137s)。3× baseline 经验余量、不调全局 config 避影响
 * 其他 110 isolated test。未来若 30s 仍不够 → 信号是 import graph 又重了、
 * 应回查 daemon-entry import 而非加 budget。
 */
const HEAVY_TRANSITIVE_IMPORT_HOOK_TIMEOUT_MS = 30_000;

describe('daemon-entry shim audit', () => {
  let originalArgv: string[];
  let errorSpy: vi.SpyInstance;
  let mockExit: vi.SpyInstance;

  beforeAll(async () => {
    originalArgv = process.argv;
    process.argv = ['node', 'daemon-entry', 'test-claw'];
    // 单次 import 触发 daemon-entry.js top-level 副作用 (装配 audit sink + register handler)
    await import('../../src/daemon-entry.js');
    await Promise.resolve(); // 让 top-level await 完成
  }, HEAVY_TRANSITIVE_IMPORT_HOOK_TIMEOUT_MS);

  afterAll(() => {
    process.argv = originalArgv;
    // 清本 file 注册 handler、保 vitest 原有
    const isOurUncaught = (h: any) => h.toString().includes('daemon_uncaught_exception');
    const isOurUnhandled = (h: any) => h.toString().includes('daemon_unhandled_rejection');
    const otherUncaught = process.listeners('uncaughtException').filter(h => !isOurUncaught(h));
    const otherUnhandled = process.listeners('unhandledRejection').filter(h => !isOurUnhandled(h));
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    otherUncaught.forEach(h => process.on('uncaughtException', h));
    otherUnhandled.forEach(h => process.on('unhandledRejection', h));
  });

  beforeEach(() => {
    mockAuditWrite.mockClear();
    mockAuditWrite.mockImplementation(() => {}); // 默 noop
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    mockExit.mockRestore();
  });

  it('shim 加载时构造 audit sink 并注册 handler', () => {
    // beforeAll 已 import / handler 应已注册
    const uncaughtHandlers = process.listeners('uncaughtException');
    const unhandledHandlers = process.listeners('unhandledRejection');
    expect(uncaughtHandlers.length).toBeGreaterThanOrEqual(1);
    expect(unhandledHandlers.length).toBeGreaterThanOrEqual(1);
  });

  it('shim uncaughtException → audit daemon_uncaught_exception + console + exit(1)', () => {
    const handler = process.listeners('uncaughtException').find(
      h => h.toString().includes('daemon_uncaught_exception')
    );
    expect(handler).toBeDefined();

    const testErr = new Error('test shim uncaught');
    testErr.stack = 'mock-stack';

    expect(() => handler!(testErr)).toThrow('process.exit(1)');
    expect(mockAuditWrite).toHaveBeenCalledWith(
      'daemon_uncaught_exception',
      expect.stringContaining('error=test shim uncaught'),
    );
    expect(errorSpy).toHaveBeenCalledWith('[daemon] Uncaught exception:', testErr);
  });

  it('shim unhandledRejection → audit daemon_unhandled_rejection + console + exit(1)', () => {
    const handler = process.listeners('unhandledRejection').find(
      h => h.toString().includes('daemon_unhandled_rejection')
    );
    expect(handler).toBeDefined();

    const reason = 'test rejection';
    expect(() => handler!(reason)).toThrow('process.exit(1)');
    expect(mockAuditWrite).toHaveBeenCalledWith(
      'daemon_unhandled_rejection',
      expect.stringContaining('error=test rejection'),
    );
    expect(errorSpy).toHaveBeenCalledWith('[daemon] Unhandled rejection:', reason);
  });

  it('shim audit write 抛 → 静默 fallback console', () => {
    // 切换 mock 行为：本 it write 抛错
    mockAuditWrite.mockImplementation(() => {
      throw new Error('audit disk full');
    });

    const handler = process.listeners('uncaughtException').find(
      h => h.toString().includes('daemon_uncaught_exception')
    );
    expect(handler).toBeDefined();

    const testErr = new Error('test write throw');
    expect(() => handler!(testErr)).toThrow('process.exit(1)');
    expect(mockAuditWrite).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[daemon] Uncaught exception:', testErr);
  });
});
