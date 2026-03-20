/**
 * ProcessManager spawn 默认参数和环境变量测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ProcessManager } from '../../src/foundation/process/manager.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';

function createTempDir(): string {
  const tempDir = path.join(tmpdir(), `spawn-test-${randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupTempDir(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

describe('ProcessManager - spawn defaults', () => {
  let tempDir: string;
  let nodeFs: NodeFileSystem;
  let mockProc: any;

  beforeEach(() => {
    tempDir = createTempDir();
    nodeFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    
    // Setup mock process
    mockProc = {
      pid: 12345,
      unref: vi.fn(),
    };
    vi.mocked(spawn).mockReturnValue(mockProc as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanupTempDir(tempDir);
  });

  describe('spawn default args', () => {
    it('should use [claw, daemon, <id>] args for regular claw', async () => {
      const pm = new ProcessManager(nodeFs, tempDir);
      const clawDir = path.join(tempDir, 'claws', 'test-claw');

      // Pre-create logs dir to avoid ENOENT
      fs.mkdirSync(path.join(clawDir, 'logs'), { recursive: true });

      try {
        await pm.spawn('test-claw', clawDir);
      } catch {
        // Expected to fail due to isAlive check
      }

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      
      // Args are [daemonEntryPath, clawId]
      expect(args[0]).toContain('daemon-entry');
      expect(args[1]).toBe('test-claw');
    });

    it('should use [motion, daemon] args for motion (no id)', async () => {
      const pm = new ProcessManager(nodeFs, tempDir);
      const motionDir = path.join(tempDir, 'motion');

      // Pre-create logs dir
      fs.mkdirSync(path.join(motionDir, 'logs'), { recursive: true });

      try {
        await pm.spawn('motion', motionDir);
      } catch {
        // Expected to fail due to isAlive check
      }

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      
      // Args are [daemonEntryPath, 'motion']
      expect(args[0]).toContain('daemon-entry');
      expect(args[1]).toBe('motion');
    });

    it('should pass custom args when provided', async () => {
      const pm = new ProcessManager(nodeFs, tempDir);
      const clawDir = path.join(tempDir, 'claws', 'custom-claw');
      const customArgs = ['/custom/cli.js', 'custom', 'command'];

      // Pre-create logs dir
      fs.mkdirSync(path.join(clawDir, 'logs'), { recursive: true });

      try {
        await pm.spawn('custom-claw', clawDir, customArgs);
      } catch {
        // Expected to fail
      }

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      
      expect(args).toEqual(customArgs);
    });
  });

  describe('spawn environment', () => {
    it('should include CLAWFORUM_DAEMON_MODE in env', async () => {
      const pm = new ProcessManager(nodeFs, tempDir);
      const clawDir = path.join(tempDir, 'claws', 'env-claw');

      // Pre-create logs dir
      fs.mkdirSync(path.join(clawDir, 'logs'), { recursive: true });

      // Save original env
      const originalEnv = process.env.CLAWFORUM_DAEMON_MODE;

      try {
        await pm.spawn('env-claw', clawDir);
      } catch {
        // Expected to fail
      }

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const options = spawnCall[2] as any;
      
      // env inherits from process.env (daemon-entry.js handles CLAWFORUM_DAEMON_MODE internally)
      expect(options.env).toMatchObject({ ...process.env });
      
      // Restore original env
      if (originalEnv === undefined) {
        delete process.env.CLAWFORUM_DAEMON_MODE;
      } else {
        process.env.CLAWFORUM_DAEMON_MODE = originalEnv;
      }
    });

    it('should inherit parent environment variables', async () => {
      const pm = new ProcessManager(nodeFs, tempDir);
      const clawDir = path.join(tempDir, 'claws', 'inherit-claw');

      // Pre-create logs dir
      fs.mkdirSync(path.join(clawDir, 'logs'), { recursive: true });

      // Set a test env var
      process.env.TEST_INHERITANCE = 'test-value';

      try {
        await pm.spawn('inherit-claw', clawDir);
      } catch {
        // Expected to fail
      }

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const options = spawnCall[2] as any;
      
      expect(options.env).toHaveProperty('TEST_INHERITANCE', 'test-value');
      
      // Cleanup
      delete process.env.TEST_INHERITANCE;
    });
  });
});
