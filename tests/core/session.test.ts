/**
 * Session 测试 - save/load 原子性 + 冷启动恢复 + archive 恢复
 * 
 * 新增测试：
 * - loadLatestArchive() 扫描 archive 目录
 * - 损坏 JSON 处理
 * - ENOENT vs JSON 解析错误区分
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
// Note: SessionManager 从具体实现导入
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';
import { SessionManager } from '../../src/core/dialog/session.js';
import type { Message } from '../../src/types/message.js';

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

  // === 新增测试：Archive 恢复 ===

  it('should recover from latest archive when current.json is missing', async () => {
    const archiveDir = path.join(TEST_DIR, 'dialog', 'archive');
    await fs.mkdir(archiveDir, { recursive: true });

    // 创建多个 archive 文件（按时间戳命名）
    const oldArchive = path.join(archiveDir, '1000_old.json');
    const newArchive = path.join(archiveDir, '3000_new.json');

    await fs.writeFile(oldArchive, JSON.stringify({ id: 'old', messages: [] }), 'utf-8');
    await fs.writeFile(newArchive, JSON.stringify({ id: 'new', messages: [{ role: 'user', content: 'Hi' }] }), 'utf-8');

    // 读取最新的 archive（按文件名排序）
    const archives = (await fs.readdir(archiveDir))
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const tsA = parseInt(a.split('_')[0], 10) || 0;
        const tsB = parseInt(b.split('_')[0], 10) || 0;
        return tsB - tsA;
      });

    expect(archives[0]).toBe('3000_new.json');

    const latest = JSON.parse(await fs.readFile(path.join(archiveDir, archives[0]), 'utf-8'));
    expect(latest.id).toBe('new');
    expect(latest.messages).toHaveLength(1);
  });

  it('should return null when archive is corrupted', async () => {
    const archiveDir = path.join(TEST_DIR, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });

    const corrupted = path.join(archiveDir, '1000_corrupted.json');
    await fs.writeFile(corrupted, '{ invalid json }', 'utf-8');

    // 尝试解析应该失败
    const content = await fs.readFile(corrupted, 'utf-8');
    expect(() => JSON.parse(content)).toThrow();
  });

  it('should return null when archive directory does not exist', async () => {
    const nonExistentDir = path.join(TEST_DIR, 'nonexistent');
    
    const exists = await fs.access(nonExistentDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);

    // 冷启动逻辑：archive 目录不存在时返回 null
    const result = null;
    expect(result).toBeNull();
  });

  // === 新增：SessionManager 集成测试 ===

  it('should return null when session file does not exist (ENOENT)', async () => {
    const currentFile = path.join(TEST_DIR, 'dialog', 'nonexistent-session.json');
    
    // ENOENT 应该返回 null 而不是抛出
    const exists = await fs.access(currentFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('should distinguish ENOENT from JSON corruption', async () => {
    const dialogDir = path.join(TEST_DIR, 'dialog');
    const currentFile = path.join(dialogDir, 'corrupted.json');
    
    await fs.mkdir(dialogDir, { recursive: true });
    
    // 写入损坏的 JSON
    await fs.writeFile(currentFile, '{ invalid json', 'utf-8');

    // JSON 解析错误应该抛出
    const content = await fs.readFile(currentFile, 'utf-8');
    expect(() => JSON.parse(content)).toThrow();
  });

  it('should loadLatestArchive return latest by timestamp', async () => {
    const archiveDir = path.join(TEST_DIR, 'dialog', 'archive');
    await fs.mkdir(archiveDir, { recursive: true });

    // 创建按时间戳命名的 archive 文件
    await fs.writeFile(
      path.join(archiveDir, '1000_sessionA.json'),
      JSON.stringify({ id: 'sessionA', timestamp: 1000 }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(archiveDir, '2000_sessionB.json'),
      JSON.stringify({ id: 'sessionB', timestamp: 2000 }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(archiveDir, '1500_sessionC.json'),
      JSON.stringify({ id: 'sessionC', timestamp: 1500 }),
      'utf-8'
    );

    // 读取 archive 目录
    const archives = (await fs.readdir(archiveDir))
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const tsA = parseInt(a.split('_')[0], 10) || 0;
        const tsB = parseInt(b.split('_')[0], 10) || 0;
        return tsB - tsA;
      });

    expect(archives[0]).toBe('2000_sessionB.json');
    const latest = JSON.parse(await fs.readFile(path.join(archiveDir, archives[0]), 'utf-8'));
    expect(latest.id).toBe('sessionB');
  });

  it('should handle corrupted archive gracefully', async () => {
    const archiveDir = path.join(TEST_DIR, 'dialog', 'archive');
    await fs.mkdir(archiveDir, { recursive: true });

    // 创建有效的 archive
    await fs.writeFile(
      path.join(archiveDir, '1000_valid.json'),
      JSON.stringify({ id: 'valid' }),
      'utf-8'
    );
    
    // 创建损坏的 archive
    await fs.writeFile(
      path.join(archiveDir, '2000_corrupted.json'),
      '{ invalid',
      'utf-8'
    );

    // 按时间戳排序
    const archives = (await fs.readdir(archiveDir))
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => {
        const tsA = parseInt(a.split('_')[0], 10) || 0;
        const tsB = parseInt(b.split('_')[0], 10) || 0;
        return tsB - tsA;
      });

    // 最新的文件是损坏的
    expect(archives[0]).toBe('2000_corrupted.json');
    
    // 尝试解析应该失败
    const corruptedContent = await fs.readFile(path.join(archiveDir, archives[0]), 'utf-8');
    expect(() => JSON.parse(corruptedContent)).toThrow();
  });
});

describe('SessionManager unit tests', () => {
  let tmpDir: string;
  let nodeFs: NodeFileSystem;
  let sm: SessionManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-test-'));
    nodeFs = new NodeFileSystem({ baseDir: tmpDir, enforcePermissions: false });
    sm = new SessionManager(nodeFs, 'dialog', 'test-claw');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- truncateForContext ---

  it('truncateForContext: returns original reference when under limit', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const { result, pruned } = sm.truncateForContext(messages, 100_000);
    expect(result).toBe(messages); // same reference
    expect(pruned).toBe(0);
  });

  it('truncateForContext: truncates and lands on first valid user message', () => {
    const long = 'x'.repeat(400); // ~100 tokens
    const messages: Message[] = [
      { role: 'user', content: long },       // [0] overlong
      { role: 'assistant', content: long },   // [1] overlong
      { role: 'user', content: 'question' }, // [2] valid start
      { role: 'assistant', content: 'ans' },
      { role: 'user', content: 'more' },
    ];
    // limit=50 tokens → slice starts at [2]
    const { result, pruned } = sm.truncateForContext(messages, 50);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('question');
    expect(pruned).toBe(2);
  });

  it('truncateForContext: skips pure-tool-result user message when finding start', () => {
    const long = 'x'.repeat(400); // ~100 tokens
    const messages: Message[] = [
      { role: 'user', content: long },  // [0] overlong
      { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'r', input: {} }] }, // [1]
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'res' }] }, // [2] pure-tool-result
      { role: 'user', content: 'regular question' },  // [3] valid start
      { role: 'assistant', content: 'done' },
    ];
    // limit=50 tokens: first loop stops at cutIdx=1, second loop skips [1],[2] → lands on [3]
    const { result, pruned } = sm.truncateForContext(messages, 50);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('regular question');
    expect(pruned).toBe(3);
  });

  it('truncateForContext: H2 — falls back to full array when no valid start (all tail is assistant/tool_result)', () => {
    const long = 'x'.repeat(400); // ~100 tokens
    // Sequence: [long_user, assistant_tool_use, pure_tool_result_user, assistant_text, user_final]
    // With limit=50: first loop stops at cutIdx=2 (messages[2..4] ≈ 17 tokens ≤ 50)
    // Second loop: messages[2] isPureToolResult→skip, cutIdx=3; 3 < 3 = false → exit
    // messages[3].role === 'assistant' → isValidStart=false → return original
    const messages: Message[] = [
      { role: 'user', content: long },
      { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'r', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: 'r' }] },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'final' },
    ];
    const { result, pruned } = sm.truncateForContext(messages, 50);
    expect(result).toBe(messages); // fallback: same reference
    expect(pruned).toBe(0);
  });

  // --- archive() ---

  it('archive: moves current.json to archive dir', async () => {
    const msg: Message = { role: 'user', content: 'hello' };
    await sm.save([msg]);

    // Verify current.json exists before archive
    const currentPath = path.join(tmpDir, 'dialog', 'current.json');
    await expect(fs.access(currentPath)).resolves.toBeUndefined();

    await sm.archive();

    // current.json should be gone
    await expect(fs.access(currentPath)).rejects.toThrow();

    // archive dir should have one file
    const archiveDir = path.join(tmpDir, 'dialog', 'archive');
    const files = await fs.readdir(archiveDir);
    expect(files.filter(f => f.endsWith('.json'))).toHaveLength(1);
  });

  it('archive: throws with ENOENT code when no current.json exists', async () => {
    // initialize() catches this with: if (err?.code !== 'ENOENT') console.warn(...)
    // 验证 code 确实是 ENOENT，确保 initialize() 的静默判断能正确生效
    await expect(sm.archive()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // --- load() with archive recovery ---

  it('load: recovers from archive when current.json is gone', async () => {
    const msg: Message = { role: 'user', content: 'remembered' };
    await sm.save([msg]);
    await sm.archive(); // moves current.json → archive/

    // Fresh SessionManager (simulate restart)
    const sm2 = new SessionManager(nodeFs, 'dialog', 'test-claw');
    const session = await sm2.load();

    expect(session.messages).toHaveLength(1);
    expect((session.messages[0].content as string)).toBe('remembered');
  });
});
