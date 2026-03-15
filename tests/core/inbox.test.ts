/**
 * Inbox 测试 - 优先级排序 + failed 移动
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InboxWatcher } from '../../src/core/communication/inbox.js';
import type { InboxMessage } from '../../src/types/message.js';

const TEST_DIR = '.test-inbox';

describe('InboxWatcher', () => {
  let inbox: InboxWatcher;
  const processedMessages: InboxMessage[] = [];

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    // InboxWatcher 期望 clawDir，内部会创建 inbox/ 子目录
    await fs.mkdir(TEST_DIR, { recursive: true });

    processedMessages.length = 0;
    inbox = new InboxWatcher(
      TEST_DIR,
      {
        ensureDir: async (p: string) => fs.mkdir(p, { recursive: true }),
        read: async (p: string) => fs.readFile(p, 'utf-8'),
        writeAtomic: async (p: string, content: string) => {
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, content, 'utf-8');
        },
        move: async (from: string, to: string) => {
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.rename(from, to);
        },
      } as any
    );
    await inbox.start(async (msg: InboxMessage) => {
      processedMessages.push(msg);
    });
  });

  afterEach(async () => {
    await inbox.stop();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should sort by priority high > normal > low', async () => {
    // 创建三个消息，按不同优先级
    const msg1 = `---\ntype: normal\npriority: low\n---\nContent 1`;
    const msg2 = `---\ntype: normal\npriority: high\n---\nContent 2`;
    const msg3 = `---\ntype: normal\npriority: normal\n---\nContent 3`;

    const pendingDir = path.join(TEST_DIR, 'inbox', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });
    await fs.writeFile(path.join(pendingDir, '1000_normal_msg1.md'), msg1, 'utf-8');
    await fs.writeFile(path.join(pendingDir, '1000_high_msg2.md'), msg2, 'utf-8');
    await fs.writeFile(path.join(pendingDir, '1000_normal_msg3.md'), msg3, 'utf-8');

    // 手动加载消息
    await (inbox as any).loadExistingMessages();
    await (inbox as any).sortQueue();

    const queue = (inbox as any).queue;
    expect(queue[0].priority).toBe(3); // high
    expect(queue[1].priority).toBe(2); // normal
    expect(queue[2].priority).toBe(1); // low
  });

  it('should move failed messages to failed dir', async () => {
    // 创建一个会导致处理失败的消息
    const failingInbox = new InboxWatcher(
      path.join(TEST_DIR, 'failing'),
      {
        ensureDir: async (p: string) => fs.mkdir(p, { recursive: true }),
        read: async (p: string) => fs.readFile(p, 'utf-8'),
        writeAtomic: async (p: string, content: string) => {
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, content, 'utf-8');
        },
        move: async (from: string, to: string) => {
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.rename(from, to);
        },
      } as any
    );
    await failingInbox.start(async () => {
      throw new Error('Intentional failure');
    });

    const pendingDir = path.join(TEST_DIR, 'failing', 'inbox', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });
    const msg = `---\ntype: normal\n---\nTest content`;
    await fs.writeFile(path.join(pendingDir, '1000_normal_test.md'), msg, 'utf-8');

    // 处理队列
    await (failingInbox as any).processQueue();

    // 验证消息被移到 failed
    const failedDir = path.join(TEST_DIR, 'failing', 'inbox', 'failed');
    const failedFiles = await fs.readdir(failedDir);
    expect(failedFiles.length).toBe(1);

    await failingInbox.stop();
  });
});
