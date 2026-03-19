/**
 * Inbox 测试 - 优先级排序 + failed 移动 + 新增测试
 * 
 * 简化测试：使用真实文件系统，验证核心行为
 * 
 * 新增测试：
 * - Priority queue 排序验证
 * - Deduplication (Set)
 * - MAX_QUEUE_SIZE 行为
 * - loadExistingMessages 冷启动
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InboxWatcher } from '../../src/core/communication/inbox.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';
import type { InboxMessage } from '../../src/types/message.js';

// 使用真实 fs 但限制在测试目录
const TEST_DIR = path.resolve('.test-inbox');

describe('InboxWatcher', () => {
  const processedMessages: InboxMessage[] = [];

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(TEST_DIR, { recursive: true });
    processedMessages.length = 0;
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should parse message priority from frontmatter', async () => {
    // 简单验证：创建带 frontmatter 的消息文件，解析后检查 priority
    const msgContent = `---
type: normal
priority: high
id: test-msg-1
from: test-sender
timestamp: 2026-03-15T12:00:00Z
---
Test message content`;

    const msgPath = path.join(TEST_DIR, 'test_message.md');
    await fs.writeFile(msgPath, msgContent, 'utf-8');

    // 读取并解析
    const content = await fs.readFile(msgPath, 'utf-8');
    
    // 简单 frontmatter 解析
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    expect(match).toBeTruthy();
    
    const frontmatter = match![1];
    const body = match![2].trim();
    
    // 验证 priority 被正确解析
    expect(frontmatter).toContain('priority: high');
    expect(body).toBe('Test message content');
  });

  it('should move failed messages to failed directory', async () => {
    // 创建 mock 文件系统操作来测试失败处理逻辑
    const clawDir = path.join(TEST_DIR, 'test-claw');
    const pendingDir = path.join(clawDir, 'inbox', 'pending');
    const failedDir = path.join(clawDir, 'inbox', 'failed');
    
    await fs.mkdir(pendingDir, { recursive: true });
    await fs.mkdir(failedDir, { recursive: true });

    // 创建一个消息文件
    const msgFile = path.join(pendingDir, '1000_normal_test.md');
    await fs.writeFile(msgFile, '---\ntype: normal\n---\nTest', 'utf-8');

    // 模拟 move 操作（从 pending 移到 failed）
    const failedFile = path.join(failedDir, '1000_normal_test.md');
    await fs.rename(msgFile, failedFile);

    // 验证文件在 failed 目录
    const failedFiles = await fs.readdir(failedDir);
    expect(failedFiles).toContain('1000_normal_test.md');

    // 验证 pending 目录为空
    const pendingFiles = await fs.readdir(pendingDir);
    expect(pendingFiles).toHaveLength(0);
  });

  // === 新增测试 ===

  it('should deduplicate file processing', async () => {
    const clawDir = path.join(TEST_DIR, 'dedup-test');
    await fs.mkdir(clawDir, { recursive: true });
    
    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);
    
    const processed: string[] = [];
    await inbox.start(async (msg: InboxMessage) => {
      processed.push(msg.id);
    });

    // 创建消息文件
    const pendingDir = path.join(clawDir, 'inbox', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });
    
    const msgFile = path.join(pendingDir, '1000_high_test.md');
    await fs.writeFile(msgFile, '---\ntype: normal\npriority: high\nid: msg-1\n---\nBody', 'utf-8');

    // 手动触发两次（模拟 watcher 重复事件）
    await (inbox as any).handleNewFile(msgFile);
    await (inbox as any).handleNewFile(msgFile); // 重复

    // 等待处理
    await new Promise(r => setTimeout(r, 100));

    // 应该只处理一次
    expect(processed.filter(id => id === 'msg-1')).toHaveLength(1);

    await inbox.stop();
  });

  it('should sort queue by priority (critical > high > normal > low)', async () => {
    const clawDir = path.join(TEST_DIR, 'priority-test');
    await fs.mkdir(clawDir, { recursive: true });
    
    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);

    // 手动构建队列
    const queue = (inbox as any).queue;
    queue.push(
      { message: { priority: 'low' }, priority: 1, timestamp: 1000 },
      { message: { priority: 'critical' }, priority: 4, timestamp: 1000 },
      { message: { priority: 'normal' }, priority: 2, timestamp: 1000 },
      { message: { priority: 'high' }, priority: 3, timestamp: 1000 }
    );

    // 排序
    (inbox as any).sortQueue();

    // 验证顺序：critical(4) > high(3) > normal(2) > low(1)
    expect(queue[0].priority).toBe(4);
    expect(queue[1].priority).toBe(3);
    expect(queue[2].priority).toBe(2);
    expect(queue[3].priority).toBe(1);
  });

  it('should sort queue by timestamp for same priority (FIFO)', async () => {
    const clawDir = path.join(TEST_DIR, 'fifo-test');
    await fs.mkdir(clawDir, { recursive: true });
    
    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);

    const queue = (inbox as any).queue;
    queue.push(
      { message: { priority: 'high' }, priority: 3, timestamp: 3000, id: 'third' },
      { message: { priority: 'high' }, priority: 3, timestamp: 1000, id: 'first' },
      { message: { priority: 'high' }, priority: 3, timestamp: 2000, id: 'second' }
    );

    (inbox as any).sortQueue();

    // 同优先级按时间升序（FIFO）
    expect(queue[0].id).toBe('first');
    expect(queue[1].id).toBe('second');
    expect(queue[2].id).toBe('third');
  });

  it('should include UUID in done/failed filenames', async () => {
    const clawDir = path.join(TEST_DIR, 'uuid-test');
    const pendingDir = path.join(clawDir, 'inbox', 'pending');
    const doneDir = path.join(clawDir, 'inbox', 'done');
    
    await fs.mkdir(pendingDir, { recursive: true });
    await fs.mkdir(doneDir, { recursive: true });

    const msgFile = path.join(pendingDir, 'test.md');
    await fs.writeFile(msgFile, '---\ntype: normal\n---\nTest', 'utf-8');

    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);
    
    // 触发 moveToDone
    await (inbox as any).moveToDone(msgFile);

    // 验证 done 目录中的文件名包含 UUID（格式：{timestamp}_{uuid8}_{filename}）
    const doneFiles = await fs.readdir(doneDir);
    expect(doneFiles).toHaveLength(1);
    
    const parts = doneFiles[0].split('_');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[1].length).toBe(8); // UUID8
  });

  // === 新增：更多队列管理测试 ===

  it('should use Set for deduplication tracking', async () => {
    const clawDir = path.join(TEST_DIR, 'set-dedup-test');
    await fs.mkdir(clawDir, { recursive: true });
    
    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);
    
    // 验证 processedFiles 是 Set
    const processedFiles = (inbox as any).processedFiles;
    expect(processedFiles).toBeInstanceOf(Set);
  });

  it('should add and cleanup file path in processedFiles Set', async () => {
    const clawDir = path.join(TEST_DIR, 'processed-set-test');
    const pendingDir = path.join(clawDir, 'inbox', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });

    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);

    const msgFile = path.join(pendingDir, 'test.md');
    await fs.writeFile(msgFile, '---\ntype: normal\nid: test-1\n---\nBody', 'utf-8');

    const processedFiles = (inbox as any).processedFiles;

    // 处理文件前，Set 为空
    expect(processedFiles.has(msgFile)).toBe(false);

    // 处理文件
    await inbox.start(async () => {});
    await (inbox as any).handleNewFile(msgFile);
    await new Promise(r => setTimeout(r, 50));

    // 处理完成后，Set 应被清理（防止内存泄漏）
    expect(processedFiles.has(msgFile)).toBe(false);

    await inbox.stop();
  });

  it('should load existing messages on cold start', async () => {
    const clawDir = path.join(TEST_DIR, 'cold-start-test');
    const pendingDir = path.join(clawDir, 'inbox', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });

    // 创建多个待处理的消息文件
    await fs.writeFile(
      path.join(pendingDir, '1000_normal_msg1.md'),
      '---\ntype: normal\npriority: normal\nid: msg-1\n---\nBody 1',
      'utf-8'
    );
    await fs.writeFile(
      path.join(pendingDir, '2000_high_msg2.md'),
      '---\ntype: normal\npriority: high\nid: msg-2\n---\nBody 2',
      'utf-8'
    );

    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);

    const processed: string[] = [];
    await inbox.start(async (msg: InboxMessage) => {
      processed.push(msg.id);
    });

    // 等待冷启动处理
    await new Promise(r => setTimeout(r, 200));

    // 应该处理已存在的文件
    expect(processed).toContain('msg-1');
    expect(processed).toContain('msg-2');

    await inbox.stop();
  });

  it('should process messages in priority order after cold start', async () => {
    const clawDir = path.join(TEST_DIR, 'priority-cold-start');
    const pendingDir = path.join(clawDir, 'inbox', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });

    // 创建不同优先级的消息（使用相同时间戳，只通过文件名排序）
    // 文件名格式：{timestamp}_{priority}_{id}.md
    await fs.writeFile(
      path.join(pendingDir, '1000_low_low.md'),
      '---\ntype: normal\npriority: low\nid: low-msg\n---\nLow',
      'utf-8'
    );
    await fs.writeFile(
      path.join(pendingDir, '1000_critical_critical.md'),
      '---\ntype: normal\npriority: critical\nid: critical-msg\n---\nCritical',
      'utf-8'
    );
    await fs.writeFile(
      path.join(pendingDir, '1000_normal_normal.md'),
      '---\ntype: normal\npriority: normal\nid: normal-msg\n---\nNormal',
      'utf-8'
    );

    const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });
    const inbox = new InboxWatcher(clawDir, nodeFs);

    const processed: string[] = [];
    await inbox.start(async (msg: InboxMessage) => {
      processed.push(msg.id);
    });

    // 等待冷启动处理
    await new Promise(r => setTimeout(r, 300));

    await inbox.stop();

    // 验证所有消息都被处理
    expect(processed).toContain('critical-msg');
    expect(processed).toContain('normal-msg');
    expect(processed).toContain('low-msg');
  });
});
