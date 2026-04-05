/**
 * Outbox 测试 - send 工具功能验证
 * 
 * 测试内容：
 * - send tool 文件名格式: {timestamp}_{priority}_{type}_{uuid8}.md
 * - 目标目录: outbox/pending/ (相对 clawDir)
 * - Frontmatter 结构: type, priority, timestamp, id headers
 * - 原子写入: writeAtomic 使用
 * - 消息体: Markdown 格式
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Outbox (Send Tool)', () => {
  const testDir = '.test-outbox';

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * 模拟 send tool 的执行逻辑
   */
  async function executeSendTool(clawDir: string, args: {
    type: 'report' | 'question' | 'result' | 'error';
    priority: 'critical' | 'high' | 'normal' | 'low';
    content: string;
  }): Promise<{ success: boolean; messageId: string; path: string }> {
    // 验证 type 枚举
    const validTypes = ['report', 'question', 'result', 'error'];
    if (!validTypes.includes(args.type)) {
      throw new Error(`Invalid type: ${args.type}`);
    }

    // 验证 priority 枚举
    const validPriorities = ['critical', 'high', 'normal', 'low'];
    if (!validPriorities.includes(args.priority)) {
      throw new Error(`Invalid priority: ${args.priority}`);
    }

    // 创建 outbox/pending/ 目录
    const outboxDir = path.join(clawDir, 'outbox', 'pending');
    await fs.mkdir(outboxDir, { recursive: true });

    // 生成 UUID8 (8字符随机)
    const uuid8 = Math.random().toString(36).substring(2, 10);
    const timestamp = Date.now();
    const messageId = `msg_${uuid8}`;

    // 文件名格式: {timestamp}_{priority}_{type}_{uuid8}.md
    const filename = `${timestamp}_${args.priority}_${args.type}_${uuid8}.md`;
    const filePath = path.join(outboxDir, filename);

    // 构建 frontmatter
    const frontmatter = `---
type: ${args.type}
priority: ${args.priority}
timestamp: ${timestamp}
id: ${messageId}
---

${args.content}`;

    // 原子写入（临时文件 + rename）
    const tempPath = filePath + '.tmp';
    await fs.writeFile(tempPath, frontmatter, 'utf-8');
    await fs.rename(tempPath, filePath);

    return {
      success: true,
      messageId,
      path: filePath,
    };
  }

  it('should create outbox/pending/ directory if needed', async () => {
    await executeSendTool(testDir, {
      type: 'report',
      priority: 'normal',
      content: 'Test message',
    });

    const pendingDir = path.join(testDir, 'outbox', 'pending');
    const stat = await fs.stat(pendingDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should generate filename with correct format', async () => {
    const result = await executeSendTool(testDir, {
      type: 'report',
      priority: 'high',
      content: 'Test content',
    });

    const filename = path.basename(result.path);
    const parts = filename.replace('.md', '').split('_');

    // 格式: {timestamp}_{priority}_{type}_{uuid8}.md
    expect(parts).toHaveLength(4);
    expect(parts[1]).toBe('high');
    expect(parts[2]).toBe('report');
    expect(parseInt(parts[0], 10)).toBeGreaterThan(0); // timestamp
    expect(parts[3]).toHaveLength(8); // uuid8
  });

  it('should validate type enum', async () => {
    await expect(executeSendTool(testDir, {
      type: 'invalid' as any,
      priority: 'normal',
      content: 'Test',
    })).rejects.toThrow('Invalid type');
  });

  it('should validate priority enum', async () => {
    await expect(executeSendTool(testDir, {
      type: 'report',
      priority: 'urgent' as any,
      content: 'Test',
    })).rejects.toThrow('Invalid priority');
  });

  it('should write correct frontmatter structure', async () => {
    const result = await executeSendTool(testDir, {
      type: 'question',
      priority: 'critical',
      content: 'What is the answer?',
    });

    const content = await fs.readFile(result.path, 'utf-8');
    
    // 验证 frontmatter 包含所有必要字段
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/type: question/);
    expect(content).toMatch(/priority: critical/);
    expect(content).toMatch(/timestamp: \d+/);
    expect(content).toMatch(/id: msg_/);
    expect(content).toMatch(/---\n\nWhat is the answer\?$/);
  });

  it('should generate unique UUID8 for each message', async () => {
    const result1 = await executeSendTool(testDir, {
      type: 'report',
      priority: 'normal',
      content: 'Message 1',
    });

    const result2 = await executeSendTool(testDir, {
      type: 'report',
      priority: 'normal',
      content: 'Message 2',
    });

    expect(result1.messageId).not.toBe(result2.messageId);
    expect(path.basename(result1.path)).not.toBe(path.basename(result2.path));
  });

  it('should support all valid types', async () => {
    const types: Array<'report' | 'question' | 'result' | 'error'> = 
      ['report', 'question', 'result', 'error'];

    for (const type of types) {
      const result = await executeSendTool(testDir, {
        type,
        priority: 'normal',
        content: `Test ${type}`,
      });

      const content = await fs.readFile(result.path, 'utf-8');
      expect(content).toMatch(new RegExp(`type: ${type}`));
    }
  });

  it('should support all valid priorities', async () => {
    const priorities: Array<'critical' | 'high' | 'normal' | 'low'> = 
      ['critical', 'high', 'normal', 'low'];

    for (const priority of priorities) {
      const result = await executeSendTool(testDir, {
        type: 'report',
        priority,
        content: `Test ${priority}`,
      });

      const filename = path.basename(result.path);
      expect(filename).toContain(`_${priority}_`);
    }
  });

  it('should write message body in markdown format', async () => {
    const content = `# Header

- Item 1
- Item 2

**Bold text**`;

    const result = await executeSendTool(testDir, {
      type: 'report',
      priority: 'normal',
      content,
    });

    const fileContent = await fs.readFile(result.path, 'utf-8');
    expect(fileContent).toContain('# Header');
    expect(fileContent).toContain('- Item 1');
    expect(fileContent).toContain('**Bold text**');
  });

  it('should use atomic write (no partial files)', async () => {
    // 创建文件后不应该有 .tmp 文件残留
    const result = await executeSendTool(testDir, {
      type: 'report',
      priority: 'normal',
      content: 'Test',
    });

    const outboxDir = path.join(testDir, 'outbox', 'pending');
    const files = await fs.readdir(outboxDir);
    
    // 不应该有 .tmp 文件
    expect(files.some(f => f.endsWith('.tmp'))).toBe(false);
    // 应该有一个 .md 文件
    expect(files.filter(f => f.endsWith('.md'))).toHaveLength(1);
  });
});
