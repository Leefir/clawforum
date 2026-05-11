import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('daemon-entry shim audit', () => {
  let originalArgv: string[];
  let mockAuditWrite: vi.Mock;
  let errorSpy: vi.SpyInstance;
  let mockExit: vi.SpyInstance;

  beforeEach(() => {
    originalArgv = process.argv;
    mockAuditWrite = vi.fn();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
  });

  afterEach(() => {
    process.argv = originalArgv;
    errorSpy.mockRestore();
    mockExit.mockRestore();
    // 清理本测试注册的 handler，保留 vitest 原有 handler
    const originalUncaught = process.listeners('uncaughtException').filter(
      h => !h.toString().includes('daemon_uncaught_exception')
    );
    const originalUnhandled = process.listeners('unhandledRejection').filter(
      h => !h.toString().includes('daemon_unhandled_rejection')
    );
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    originalUncaught.forEach(h => process.on('uncaughtException', h));
    originalUnhandled.forEach(h => process.on('unhandledRejection', h));
    vi.restoreAllMocks();
  });

  it('shim 加载时构造 audit sink 并注册 handler', async () => {
    process.argv = ['node', 'daemon-entry', 'test-claw'];

    vi.doMock('../../src/foundation/fs/node-fs.js', () => ({
      NodeFileSystem: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/foundation/audit/index.js', () => ({
      createSystemAudit: vi.fn(() => ({ write: mockAuditWrite })),
    }));
    vi.doMock('../../src/foundation/config/index.js', () => ({
      getClawDir: vi.fn(() => '/tmp/test-claw'),
      getMotionDir: vi.fn(() => '/tmp/test-motion'),
    }));
    vi.doMock('../../src/daemon/daemon.js', () => ({
      daemonCommand: vi.fn().mockResolvedValue(undefined),
    }));

    vi.resetModules();
    await import('../../src/daemon-entry.js');
    await Promise.resolve(); // 让 top-level await 完成

    // handler 已注册
    const uncaughtHandlers = process.listeners('uncaughtException');
    const unhandledHandlers = process.listeners('unhandledRejection');
    expect(uncaughtHandlers.length).toBeGreaterThanOrEqual(1);
    expect(unhandledHandlers.length).toBeGreaterThanOrEqual(1);
  });

  it('shim uncaughtException → audit daemon_uncaught_exception + console + exit(1)', async () => {
    process.argv = ['node', 'daemon-entry', 'test-claw'];

    vi.doMock('../../src/foundation/fs/node-fs.js', () => ({
      NodeFileSystem: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/foundation/audit/index.js', () => ({
      createSystemAudit: vi.fn(() => ({ write: mockAuditWrite })),
    }));
    vi.doMock('../../src/foundation/config/index.js', () => ({
      getClawDir: vi.fn(() => '/tmp/test-claw'),
      getMotionDir: vi.fn(() => '/tmp/test-motion'),
    }));
    vi.doMock('../../src/daemon/daemon.js', () => ({
      daemonCommand: vi.fn().mockResolvedValue(undefined),
    }));

    vi.resetModules();
    await import('../../src/daemon-entry.js');
    await Promise.resolve();

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

  it('shim unhandledRejection → audit daemon_unhandled_rejection + console + exit(1)', async () => {
    process.argv = ['node', 'daemon-entry', 'test-claw'];

    vi.doMock('../../src/foundation/fs/node-fs.js', () => ({
      NodeFileSystem: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/foundation/audit/index.js', () => ({
      createSystemAudit: vi.fn(() => ({ write: mockAuditWrite })),
    }));
    vi.doMock('../../src/foundation/config/index.js', () => ({
      getClawDir: vi.fn(() => '/tmp/test-claw'),
      getMotionDir: vi.fn(() => '/tmp/test-motion'),
    }));
    vi.doMock('../../src/daemon/daemon.js', () => ({
      daemonCommand: vi.fn().mockResolvedValue(undefined),
    }));

    vi.resetModules();
    await import('../../src/daemon-entry.js');
    await Promise.resolve();

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

  it('shim audit 构造失败 → fallback console 保 exit(1) 语义', async () => {
    process.argv = ['node', 'daemon-entry', 'test-claw'];

    vi.doMock('../../src/foundation/fs/node-fs.js', () => ({
      NodeFileSystem: vi.fn().mockImplementation(() => {
        throw new Error('fs init failed');
      }),
    }));
    vi.doMock('../../src/foundation/audit/index.js', () => ({
      createSystemAudit: vi.fn(() => ({ write: mockAuditWrite })),
    }));
    vi.doMock('../../src/foundation/config/index.js', () => ({
      getClawDir: vi.fn(() => '/tmp/test-claw'),
      getMotionDir: vi.fn(() => '/tmp/test-motion'),
    }));
    vi.doMock('../../src/daemon/daemon.js', () => ({
      daemonCommand: vi.fn().mockResolvedValue(undefined),
    }));

    vi.resetModules();
    await import('../../src/daemon-entry.js');
    await Promise.resolve();

    const handler = process.listeners('uncaughtException').find(
      h => h.toString().includes('daemon_uncaught_exception')
    );
    expect(handler).toBeDefined();

    const testErr = new Error('test with no audit');
    expect(() => handler!(testErr)).toThrow('process.exit(1)');
    // audit 未被调用（构造失败导致 shimAudit=null）
    expect(mockAuditWrite).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[daemon] Uncaught exception:', testErr);
  });

  it('shim audit write 抛 → 静默 fallback console', async () => {
    process.argv = ['node', 'daemon-entry', 'test-claw'];

    const throwingWrite = vi.fn().mockImplementation(() => {
      throw new Error('audit disk full');
    });
    vi.doMock('../../src/foundation/fs/node-fs.js', () => ({
      NodeFileSystem: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('../../src/foundation/audit/index.js', () => ({
      createSystemAudit: vi.fn(() => ({ write: throwingWrite })),
    }));
    vi.doMock('../../src/foundation/config/index.js', () => ({
      getClawDir: vi.fn(() => '/tmp/test-claw'),
      getMotionDir: vi.fn(() => '/tmp/test-motion'),
    }));
    vi.doMock('../../src/daemon/daemon.js', () => ({
      daemonCommand: vi.fn().mockResolvedValue(undefined),
    }));

    vi.resetModules();
    await import('../../src/daemon-entry.js');
    await Promise.resolve();

    const handler = process.listeners('uncaughtException').find(
      h => h.toString().includes('daemon_uncaught_exception')
    );
    expect(handler).toBeDefined();

    const testErr = new Error('test write throw');
    expect(() => handler!(testErr)).toThrow('process.exit(1)');
    expect(throwingWrite).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[daemon] Uncaught exception:', testErr);
  });
});
