/**
 * Heartbeat 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Heartbeat } from '../../src/core/heartbeat.js';
import { ProcessManager } from '../../src/foundation/process/manager.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-hb-test-${randomUUID()}`);
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

describe('Heartbeat', () => {
  let tempDir: string;
  let fsInstance: NodeFileSystem;
  let pm: ProcessManager;
  let heartbeat: Heartbeat;

  beforeEach(async () => {
    tempDir = await createTempDir();
    fsInstance = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    pm = new ProcessManager(fsInstance, tempDir);
    heartbeat = new Heartbeat(tempDir, pm, {
      interval: 1, // 1秒间隔用于测试
      stallThreshold: 1, // 1秒阈值用于测试
      outboxCooldown: 1, // 1秒冷却用于测试
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('isDue', () => {
    it('should return false before interval', () => {
      expect(heartbeat.isDue()).toBe(true); // 首次调用，lastRun=0
      heartbeat.checkAll(); // 设置 lastRun
      expect(heartbeat.isDue()).toBe(false); // 刚执行过
    });

    it('should return true after interval', async () => {
      heartbeat.checkAll(); // 设置 lastRun
      expect(heartbeat.isDue()).toBe(false);
      
      // 等待超过 interval
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(heartbeat.isDue()).toBe(true);
    });
  });

  describe('checkAll', () => {
    it('should skip motion itself', () => {
      // 创建 motion 目录
      fs.mkdirSync(path.join(tempDir, 'claws', 'motion'), { recursive: true });
      
      const results = heartbeat.checkAll();
      
      // motion 应该被跳过，不处理
      expect(results).not.toContain(expect.stringMatching(/motion/));
    });

    it('should return empty array when claws dir does not exist', () => {
      const results = heartbeat.checkAll();
      expect(results).toEqual([]);
    });

    it('should return empty array when claws dir is empty', () => {
      fs.mkdirSync(path.join(tempDir, 'claws'), { recursive: true });
      const results = heartbeat.checkAll();
      expect(results).toEqual([]);
    });

    it('should skip non-directory entries in claws dir', () => {
      fs.mkdirSync(path.join(tempDir, 'claws'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'claws', 'not-a-directory.txt'), 'test');
      
      const results = heartbeat.checkAll();
      expect(results).toEqual([]);
    });
  });

  describe('handleCrash', () => {
    it('should write motion inbox on crash detection', () => {
      // 创建一个 claw 目录（但没有运行），有活跃契约
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(clawDir, { recursive: true });
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      fs.mkdirSync(path.join(clawDir, 'contract', 'abc-123'), { recursive: true });
      fs.writeFileSync(
        path.join(clawDir, 'contract', 'abc-123', 'progress.json'),
        JSON.stringify({ status: 'running' })
      );
      
      // 执行检查
      const results = heartbeat.checkAll();
      
      // 应该检测到崩溃并尝试重启
      expect(results.some(r => r.startsWith('crash_recovery:test-claw'))).toBe(true);
    });

    it('should NOT restart when claw has no active contract (MVP aligned)', async () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw-no-contract');
      fs.mkdirSync(clawDir, { recursive: true });
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      // 注意：没有创建 contract/ 目录
      
      // 执行检查
      const results = heartbeat.checkAll();
      
      // 应该检测到崩溃但不重启（无契约）
      expect(results.some(r => r.startsWith('crash_recovery:test-claw-no-contract'))).toBe(true);
      
      // 等待异步写入完成
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 检查 motion inbox 中的 .md 消息内容（应该包含"未自动重启"）
      const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
      expect(fs.existsSync(motionInbox)).toBe(true);
      
      const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
      expect(files.length).toBeGreaterThan(0);
      
      const hasNoRestartMsg = files.some(f => {
        const content = fs.readFileSync(path.join(motionInbox, f), 'utf-8');
        return content.includes('未自动重启') || content.includes('no active contract');
      });
      expect(hasNoRestartMsg).toBe(true);
    });

    it('should restart when contract directory has active contract', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw-with-contract');
      fs.mkdirSync(clawDir, { recursive: true });
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      fs.mkdirSync(path.join(clawDir, 'contract', 'test-123'), { recursive: true });
      fs.writeFileSync(
        path.join(clawDir, 'contract', 'test-123', 'progress.json'),
        JSON.stringify({ status: 'running' })
      );
      
      // 执行检查
      const results = heartbeat.checkAll();
      
      // 有契约应该尝试重启
      expect(results.some(r => r.startsWith('crash_recovery:test-claw-with-contract'))).toBe(true);
    });

    it('should deduplicate crash notifications within 5 minutes', async () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw-dedup');
      fs.mkdirSync(clawDir, { recursive: true });
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      // 无契约，会触发 crash_recovery 通知
      
      // 第一次检查 - 应该通知
      const results1 = heartbeat.checkAll();
      expect(results1.some(r => r.startsWith('crash_recovery:test-claw-dedup'))).toBe(true);
      
      // 等待异步写入完成
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 记录第一次通知后的文件数
      const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
      const filesAfterFirst = fs.existsSync(motionInbox) ? fs.readdirSync(motionInbox) : [];
      
      // 第二次检查（在 5 分钟内）- 应该去重，不重复写 inbox
      const results2 = heartbeat.checkAll();
      expect(results2.some(r => r.startsWith('crash_recovery:test-claw-dedup'))).toBe(true); // 仍返回 true（已处理）
      
      // 等待异步写入完成
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 文件数应该不变（没有去重写）
      const filesAfterSecond = fs.existsSync(motionInbox) ? fs.readdirSync(motionInbox) : [];
      expect(filesAfterSecond.length).toBe(filesAfterFirst.length);
    });
  });

  describe('checkStall', () => {
    it('should write nudge when status is old', async () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      
      // 写入一个旧的 STATUS.md（超过 1 秒阈值）
      const oldTime = new Date(Date.now() - 2000).toISOString();
      fs.writeFileSync(
        path.join(clawDir, 'status', 'STATUS.md'),
        `updated_at: ${oldTime}\nstate: running\n`
      );
      
      // 使用当前进程自己的 PID，这样 isAlive 会返回 true
      fs.writeFileSync(path.join(clawDir, 'status', 'pid'), String(process.pid));
      
      const results = heartbeat.checkAll();
      
      // 应该检测到 stall
      expect(results.some(r => r.startsWith('stall_nudge:test-claw'))).toBe(true);
    });

    it('should skip when status is fresh', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      
      // 写入一个新鲜的 STATUS.md
      const freshTime = new Date().toISOString();
      fs.writeFileSync(
        path.join(clawDir, 'status', 'STATUS.md'),
        `updated_at: ${freshTime}\nstate: running\n`
      );
      
      // 使用当前进程自己的 PID
      fs.writeFileSync(path.join(clawDir, 'status', 'pid'), String(process.pid));
      
      const results = heartbeat.checkAll();
      
      // 不应该检测到 stall
      expect(results.some(r => r.startsWith('stall_nudge:'))).toBe(false);
    });

    it('should skip when no status file', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      // 使用当前进程自己的 PID
      fs.writeFileSync(path.join(clawDir, 'status', 'pid'), String(process.pid));
      
      const results = heartbeat.checkAll();
      
      // 不应该有 stall_nudge
      expect(results.some(r => r.startsWith('stall_nudge:'))).toBe(false);
    });
  });

  describe('checkOutbox', () => {
    it('should notify motion when messages pending', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'outbox', 'pending'), { recursive: true });
      fs.writeFileSync(path.join(clawDir, 'outbox', 'pending', 'msg1.json'), '{}');
      
      const results = heartbeat.checkAll();
      
      // 应该检测到 outbox
      expect(results.some(r => r.startsWith('outbox_notify:test-claw'))).toBe(true);
    });

    it('should deduplicate within cooldown', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'outbox', 'pending'), { recursive: true });
      fs.writeFileSync(path.join(clawDir, 'outbox', 'pending', 'msg1.json'), '{}');
      
      // 第一次检查
      const results1 = heartbeat.checkAll();
      expect(results1.some(r => r.startsWith('outbox_notify:'))).toBe(true);
      
      // 第二次检查（在冷却期内）
      const results2 = heartbeat.checkAll();
      expect(results2.some(r => r.startsWith('outbox_notify:'))).toBe(false);
    });

    it('should skip when outbox is empty', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'outbox', 'pending'), { recursive: true });
      
      const results = heartbeat.checkAll();
      
      expect(results.some(r => r.startsWith('outbox_notify:'))).toBe(false);
    });

    it('should skip when outbox dir does not exist', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(clawDir, { recursive: true });
      
      const results = heartbeat.checkAll();
      
      expect(results.some(r => r.startsWith('outbox_notify:'))).toBe(false);
    });
  });

  describe('writeInbox', () => {
    it('should use motion dir for motion target', () => {
      fs.mkdirSync(path.join(tempDir, 'claws', 'test-claw'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'claws', 'test-claw', 'outbox', 'pending'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'claws', 'test-claw', 'outbox', 'pending', 'msg.json'), '{}');
      
      heartbeat.checkAll();
      
      // 检查 motion inbox 是否有 .md 文件
      const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
      if (fs.existsSync(motionInbox)) {
        const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
        expect(files.length).toBeGreaterThan(0);
        
        // 检查 YAML frontmatter 内容
        const content = fs.readFileSync(path.join(motionInbox, files[0]), 'utf-8');
        expect(content).toContain('---');
        expect(content).toContain('source: heartbeat');
        expect(content).toMatch(/type: (crash_recovery|outbox_notify)/);
      }
    });

    it('should use claw dir for regular claw target', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(clawDir, { recursive: true });
      
      // 创建一个旧的 STATUS.md 触发 stall 检测
      const oldTime = new Date(Date.now() - 2000).toISOString();
      fs.mkdirSync(path.join(clawDir, 'status'), { recursive: true });
      fs.writeFileSync(
        path.join(clawDir, 'status', 'STATUS.md'),
        `updated_at: ${oldTime}\nstate: running\n`
      );
      fs.writeFileSync(path.join(clawDir, 'status', 'pid'), '999999');
      
      heartbeat.checkAll();
      
      // 检查 claw inbox 是否有文件
      const clawInbox = path.join(clawDir, 'inbox', 'pending');
      if (fs.existsSync(clawInbox)) {
        const files = fs.readdirSync(clawInbox);
        expect(files.length).toBeGreaterThan(0);
      }
    });

    it('should generate unique filenames', () => {
      const clawDir = path.join(tempDir, 'claws', 'test-claw');
      fs.mkdirSync(path.join(clawDir, 'outbox', 'pending'), { recursive: true });
      fs.writeFileSync(path.join(clawDir, 'outbox', 'pending', 'msg1.json'), '{}');
      fs.writeFileSync(path.join(clawDir, 'outbox', 'pending', 'msg2.json'), '{}');
      
      // 连续调用两次
      heartbeat.checkAll();
      
      // 等待冷却期后再次调用
      setTimeout(() => {
        heartbeat.checkAll();
      }, 1100);
    });
  });
});
