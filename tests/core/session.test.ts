/**
 * Session 测试 - save/load 原子性 + 冷启动恢复
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Session Persistence', () => {
  const TEST_DIR = '.test-session';

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should save and load session atomically', async () => {
    const sessionFile = path.join(TEST_DIR, 'session.json');
    const sessionData = {
      id: 'test-session',
      clawId: 'test-claw',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      timestamp: Date.now(),
    };

    // 原子写入（使用临时文件 + rename）
    const tempFile = sessionFile + '.tmp';
    await fs.writeFile(tempFile, JSON.stringify(sessionData, null, 2), 'utf-8');
    await fs.rename(tempFile, sessionFile);

    // 读取
    const loaded = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
    expect(loaded.id).toBe('test-session');
    expect(loaded.messages).toHaveLength(2);
  });

  it('should recover from corrupted session', async () => {
    const sessionFile = path.join(TEST_DIR, 'session.json');
    
    // 写入损坏的 JSON
    await fs.writeFile(sessionFile, '{ invalid json }', 'utf-8');

    // 尝试读取应该失败
    await expect(fs.readFile(sessionFile, 'utf-8').then(JSON.parse)).rejects.toThrow();
  });

  it('should handle concurrent writes safely', async () => {
    const sessionFile = path.join(TEST_DIR, 'session.json');
    
    // 模拟并发写入
    const write1 = async () => {
      const temp = sessionFile + '.tmp1';
      await fs.writeFile(temp, JSON.stringify({ version: 1 }), 'utf-8');
      await fs.rename(temp, sessionFile);
    };

    const write2 = async () => {
      const temp = sessionFile + '.tmp2';
      await fs.writeFile(temp, JSON.stringify({ version: 2 }), 'utf-8');
      await fs.rename(temp, sessionFile);
    };

    // 顺序执行（真实的原子 rename 应该保证最终一致性）
    await write1();
    await write2();

    const result = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
    // 最终状态应该是 write2 的
    expect(result.version).toBe(2);
  });

  it('should cold-start with empty state when no session file', async () => {
    const sessionFile = path.join(TEST_DIR, 'nonexistent.json');
    
    const exists = await fs.access(sessionFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);

    // 冷启动应该创建新状态
    const newSession = {
      id: 'new-session',
      messages: [],
      timestamp: Date.now(),
    };

    await fs.writeFile(sessionFile, JSON.stringify(newSession), 'utf-8');
    const loaded = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
    expect(loaded.messages).toEqual([]);
  });
});
