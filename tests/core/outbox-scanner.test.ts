/**
 * Outbox Scanner tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { scanClawOutboxes } from '../../src/core/outbox-scanner.js';

async function createTempDir(): Promise<string> {
  const tempDir = fs.mkdtempSync('/tmp/clawforum-outbox-test-');
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('OutboxScanner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should do nothing when claws directory does not exist', () => {
    // No claws directory created
    scanClawOutboxes(tempDir);
    
    // Should not throw, should not create motion inbox
    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    expect(fs.existsSync(motionInbox)).toBe(false);
  });

  it('should do nothing when all outboxes are empty', () => {
    // Create claws directory structure with empty outboxes
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    const claw2Dir = path.join(tempDir, 'claws', 'claw2');
    fs.mkdirSync(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
    fs.mkdirSync(path.join(claw2Dir, 'outbox', 'pending'), { recursive: true });

    scanClawOutboxes(tempDir);

    // Directory may be created (for dedup check), but no .md files written
    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    if (fs.existsSync(motionInbox)) {
      const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
      expect(files.length).toBe(0);
    }
  });

  it('should write notification when claw has unread outbox messages', () => {
    // Create claw with outbox messages
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    const outboxDir = path.join(claw1Dir, 'outbox', 'pending');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, 'msg1.md'), 'test message');

    scanClawOutboxes(tempDir);

    // Verify notification was written
    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    expect(fs.existsSync(motionInbox)).toBe(true);

    const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(motionInbox, files[0]), 'utf-8');
    expect(content).toContain('type: claw_outbox');
    expect(content).toContain('source: system');
    expect(content).toContain('priority: normal');
    expect(content).toContain('claw1(1)');
    expect(content).toContain('未处理 claw outbox');
  });

  it('should summarize multiple claws with unread messages', () => {
    // Create multiple claws with outbox messages
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    const claw2Dir = path.join(tempDir, 'claws', 'claw2');
    const claw3Dir = path.join(tempDir, 'claws', 'claw3');

    fs.mkdirSync(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
    fs.mkdirSync(path.join(claw2Dir, 'outbox', 'pending'), { recursive: true });
    fs.mkdirSync(path.join(claw3Dir, 'outbox', 'pending'), { recursive: true });

    // claw1: 2 messages
    fs.writeFileSync(path.join(claw1Dir, 'outbox', 'pending', 'msg1.md'), 'test');
    fs.writeFileSync(path.join(claw1Dir, 'outbox', 'pending', 'msg2.md'), 'test');

    // claw2: 1 message
    fs.writeFileSync(path.join(claw2Dir, 'outbox', 'pending', 'msg3.md'), 'test');

    // claw3: empty

    scanClawOutboxes(tempDir);

    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(motionInbox, files[0]), 'utf-8');
    expect(content).toContain('claw1(2)');
    expect(content).toContain('claw2(1)');
    expect(content).not.toContain('claw3');
  });

  it('should deduplicate by removing old _claw_outbox_ notifications', () => {
    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    fs.mkdirSync(motionInbox, { recursive: true });

    // Create old notification
    fs.writeFileSync(
      path.join(motionInbox, '20240315_120000_claw_outbox_abc123.md'),
      '---\ntype: claw_outbox\n---\n\nold notification'
    );

    // Create claw with outbox messages
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    const outboxDir = path.join(claw1Dir, 'outbox', 'pending');
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, 'msg1.md'), 'test message');

    scanClawOutboxes(tempDir);

    // Verify old notification was removed and new one written
    const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(1);
    expect(files[0]).not.toContain('20240315'); // Old file removed

    const content = fs.readFileSync(path.join(motionInbox, files[0]), 'utf-8');
    expect(content).toContain('claw1(1)'); // New content
  });

  it('should ignore non-.md files in outbox', () => {
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    const outboxDir = path.join(claw1Dir, 'outbox', 'pending');
    fs.mkdirSync(outboxDir, { recursive: true });

    // Mix of .md and non-.md files
    fs.writeFileSync(path.join(outboxDir, 'msg1.md'), 'test');
    fs.writeFileSync(path.join(outboxDir, 'msg2.md'), 'test');
    fs.writeFileSync(path.join(outboxDir, 'temp.json'), 'test');
    fs.writeFileSync(path.join(outboxDir, 'readme.txt'), 'test');

    scanClawOutboxes(tempDir);

    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(motionInbox, files[0]), 'utf-8');
    expect(content).toContain('claw1(2)'); // Only .md files counted
  });

  it('should log warning when removing old outbox notification fails', () => {
    // 创建一个有消息的 claw
    const clawDir = path.join(tempDir, 'claws', 'claw1');
    fs.mkdirSync(path.join(clawDir, 'outbox', 'pending'), { recursive: true });
    fs.writeFileSync(path.join(clawDir, 'outbox', 'pending', 'msg.md'), 'content');

    // 在 inboxDir 中放一个名称含 _claw_outbox_ 的【目录】
    // → unlinkSync 会抛 EISDIR → 触发内层 console.warn
    const inboxDir = path.join(tempDir, 'motion', 'inbox', 'pending');
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(path.join(inboxDir, '20240101T000000_claw_outbox_abc'), { recursive: true });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scanClawOutboxes(tempDir);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to remove old notification')
    );
    warnSpy.mockRestore();
  });

  it('should skip claw whose outbox/pending is a file (not a directory)', () => {
    // claw1: outbox/pending is a FILE → readdirSync throws ENOTDIR → swallowed silently
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    fs.mkdirSync(path.join(claw1Dir, 'outbox'), { recursive: true });
    fs.writeFileSync(path.join(claw1Dir, 'outbox', 'pending'), 'i am a file not a dir');

    // claw2: valid outbox with one message → should still be counted
    const claw2Dir = path.join(tempDir, 'claws', 'claw2');
    fs.mkdirSync(path.join(claw2Dir, 'outbox', 'pending'), { recursive: true });
    fs.writeFileSync(path.join(claw2Dir, 'outbox', 'pending', 'msg.md'), 'test');

    scanClawOutboxes(tempDir);

    const motionInbox = path.join(tempDir, 'motion', 'inbox', 'pending');
    const files = fs.readdirSync(motionInbox).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(motionInbox, files[0]), 'utf-8');
    // Only claw2 counted; claw1's error was silently swallowed
    expect(content).toContain('claw2(1)');
    expect(content).not.toContain('claw1');
  });

  it('should log warn when inbox pending dir cannot be read for dedup (dir replaced by file)', () => {
    // Create a claw with outbox messages
    const claw1Dir = path.join(tempDir, 'claws', 'claw1');
    fs.mkdirSync(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
    fs.writeFileSync(path.join(claw1Dir, 'outbox', 'pending', 'msg.md'), 'content');

    // Place a FILE at motion/inbox so mkdirSync for motion/inbox/pending fails → outer catch
    const motionDir = path.join(tempDir, 'motion');
    fs.mkdirSync(motionDir, { recursive: true });
    fs.writeFileSync(path.join(motionDir, 'inbox'), 'i block the dir creation');

    // The outer catch should swallow the error and write to stderr (not throw)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => scanClawOutboxes(tempDir)).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[OutboxScanner]'));
    stderrSpy.mockRestore();
  });
});
