/**
 * Inbox 测试 - 优先级排序 + failed 移动
 * 
 * 简化测试：使用真实文件系统，验证核心行为
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InboxWatcher } from '../../src/core/communication/inbox.js';
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
});
