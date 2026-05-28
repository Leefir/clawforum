import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeUserChat } from '../../../src/cli/commands/chat-viewport-utils.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';

describe('phase 1388 Bug A: writeUserChat 普通 claw 不嵌套 claws/claws/', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1388-bug-a-'));
    originalEnv = process.env.CLAWFORUM_ROOT;
    process.env.CLAWFORUM_ROOT = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAWFORUM_ROOT;
    } else {
      process.env.CLAWFORUM_ROOT = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writeUserChat for regular claw writes to .clawforum/claws/<id>/inbox/pending (NOT claws/claws/)', () => {
    const clawDir = path.join(tempDir, '.clawforum', 'claws', 'test-claw');
    fs.mkdirSync(path.join(clawDir, 'inbox', 'pending'), { recursive: true });

    const fsFactory = (baseDir: string) => new NodeFileSystem({ baseDir });

    expect(() => {
      writeUserChat(clawDir, 'test message', fsFactory);
    }).not.toThrow();

    // 正确路径有文件
    const inboxPending = path.join(tempDir, '.clawforum', 'claws', 'test-claw', 'inbox', 'pending');
    const files = fs.readdirSync(inboxPending);
    expect(files.length).toBe(1);

    // 嵌套路径不存在
    const nestedWrong = path.join(tempDir, '.clawforum', 'claws', 'claws', 'test-claw');
    expect(fs.existsSync(nestedWrong)).toBe(false);
  });

  it('writeUserChat for Motion writes to .clawforum/motion/inbox/pending (regression-guard)', () => {
    const motionDir = path.join(tempDir, '.clawforum', 'motion');
    fs.mkdirSync(path.join(motionDir, 'inbox', 'pending'), { recursive: true });

    const fsFactory = (baseDir: string) => new NodeFileSystem({ baseDir });

    expect(() => {
      writeUserChat(motionDir, 'motion test', fsFactory);
    }).not.toThrow();

    const inboxPending = path.join(tempDir, '.clawforum', 'motion', 'inbox', 'pending');
    const files = fs.readdirSync(inboxPending);
    expect(files.length).toBe(1);
  });
});
