/**
 * ProcessManager 单元测试
 *
 * 测试可隔离的纯逻辑单元（不涉及真实子进程启动）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ProcessManager } from '../../src/foundation/process/manager.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-process-test-${randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('ProcessManager', () => {
  let tempDir: string;
  let fsInstance: NodeFileSystem;
  let processManager: ProcessManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    fsInstance = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    processManager = new ProcessManager(fsInstance, tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('isAlive', () => {
    it('should return false when pid file does not exist', () => {
      const result = processManager.isAlive('nonexistent-claw');
      expect(result).toBe(false);
    });

    it('should return false when pid file contains invalid content', () => {
      // 创建 pid 文件但内容不是有效数字
      const statusDir = path.join(tempDir, 'claws', 'test-claw', 'status');
      fs.mkdirSync(statusDir, { recursive: true });
      fs.writeFileSync(path.join(statusDir, 'pid'), 'not-a-number');

      const result = processManager.isAlive('test-claw');
      expect(result).toBe(false);
    });

    it('should return false when pid file contains empty content', () => {
      const statusDir = path.join(tempDir, 'claws', 'test-claw', 'status');
      fs.mkdirSync(statusDir, { recursive: true });
      fs.writeFileSync(path.join(statusDir, 'pid'), '');

      const result = processManager.isAlive('test-claw');
      expect(result).toBe(false);
    });

    it('should return false when pid file contains whitespace only', () => {
      const statusDir = path.join(tempDir, 'claws', 'test-claw', 'status');
      fs.mkdirSync(statusDir, { recursive: true });
      fs.writeFileSync(path.join(statusDir, 'pid'), '   \n  ');

      const result = processManager.isAlive('test-claw');
      expect(result).toBe(false);
    });
  });

  describe('stop', () => {
    it('should return false when pid file does not exist', async () => {
      const result = await processManager.stop('nonexistent-claw');
      expect(result).toBe(false);
    });

    it('should clean up stale pid file after detecting dead process', async () => {
      // 创建一个指向不存在进程的 pid 文件
      const statusDir = path.join(tempDir, 'claws', 'test-claw', 'status');
      fs.mkdirSync(statusDir, { recursive: true });
      const pidFile = path.join(statusDir, 'pid');
      
      // 使用一个不可能存在的 PID（Linux 的 PID 上限通常是 2^22，macOS 更低）
      const fakePid = 999999;
      fs.writeFileSync(pidFile, String(fakePid));

      // isAlive 应该返回 false（因为进程不存在）
      expect(processManager.isAlive('test-claw')).toBe(false);

      // 等待 isAlive 触发的异步清理完成
      await new Promise(resolve => setTimeout(resolve, 100));

      // pid 文件应该被 isAlive 清理
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it('should return true when stopping already-cleaned process', async () => {
      // 创建一个指向不存在进程的 pid 文件
      const statusDir = path.join(tempDir, 'claws', 'test-claw-2', 'status');
      fs.mkdirSync(statusDir, { recursive: true });
      const pidFile = path.join(statusDir, 'pid');
      
      const fakePid = 999998;
      fs.writeFileSync(pidFile, String(fakePid));

      // 直接调用 stop（不先调用 isAlive）
      // stop 应该检测到进程不存在，清理 pid 文件，返回 true
      const result = await processManager.stop('test-claw-2');
      expect(result).toBe(true);
      
      // pid 文件应该被清理
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe('listRunning', () => {
    it('should return empty array when claws directory does not exist', async () => {
      const result = await processManager.listRunning();
      expect(result).toEqual([]);
    });

    it('should return empty array when claws directory is empty', async () => {
      const clawsDir = path.join(tempDir, 'claws');
      fs.mkdirSync(clawsDir, { recursive: true });

      const result = await processManager.listRunning();
      expect(result).toEqual([]);
    });

    it('should return empty array when no claws are running', async () => {
      // 创建一些 claw 目录但不创建 pid 文件
      const clawsDir = path.join(tempDir, 'claws');
      fs.mkdirSync(path.join(clawsDir, 'claw-1', 'status'), { recursive: true });
      fs.mkdirSync(path.join(clawsDir, 'claw-2', 'status'), { recursive: true });

      const result = await processManager.listRunning();
      expect(result).toEqual([]);
    });

    it('should ignore files in claws directory', async () => {
      // 在 claws 目录下创建一个文件（不是目录）
      const clawsDir = path.join(tempDir, 'claws');
      fs.mkdirSync(clawsDir, { recursive: true });
      fs.writeFileSync(path.join(clawsDir, 'not-a-directory.txt'), 'test');

      const result = await processManager.listRunning();
      expect(result).toEqual([]);
    });
  });
});
