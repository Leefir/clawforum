/**
 * Dialog module tests
 * 
 * Tests:
 * - SessionManager: load, save, archive, token estimation
 * - ContextInjector: system prompt building
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { SessionManager } from '../../src/core/dialog/session.js';
import { ContextInjector } from '../../src/core/dialog/injector.js';
import type { Message } from '../../src/types/message.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-dialog-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Dialog', () => {
  describe('SessionManager', () => {
    let tempDir: string;
    let fs: NodeFileSystem;
    let sessionManager: SessionManager;

    beforeEach(async () => {
      tempDir = await createTempDir();
      fs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
      await fs.ensureDir('dialog');
      sessionManager = new SessionManager(fs, 'dialog');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('should return empty session when current.json does not exist', async () => {
      const session = await sessionManager.load();
      
      expect(session.messages).toEqual([]);
      expect(session.clawId).toBeDefined();
    });

    it('should save and load messages consistently', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      await sessionManager.save(messages);
      const loaded = await sessionManager.load();

      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].role).toBe('user');
      expect(loaded.messages[1].role).toBe('assistant');
    });

    it('should archive current.json to archive directory', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];
      await sessionManager.save(messages);

      // Verify current.json exists
      expect(await fs.exists('dialog/current.json')).toBe(true);

      // Archive
      await sessionManager.archive();

      // current.json should be gone
      expect(await fs.exists('dialog/current.json')).toBe(false);
      
      // Archive directory should have the file
      const entries = await fs.list('dialog/archive');
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].name).toMatch(/\d+\.json$/);
    });

    it('should recover from archive on cold start', async () => {
      // Create and archive a session
      const messages: Message[] = [
        { role: 'user', content: 'Archived message' },
      ];
      await sessionManager.save(messages);
      await sessionManager.archive();

      // Verify current.json doesn't exist
      expect(await fs.exists('dialog/current.json')).toBe(false);

      // Load should recover from archive
      const recovered = await sessionManager.load();
      expect(recovered.messages).toHaveLength(1);
      expect(recovered.messages[0].content).toBe('Archived message');
    });

    it('should estimate tokens correctly (chars / 4)', async () => {
      // 100 characters should estimate to ~25 tokens
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(100) },
      ];

      const tokens = sessionManager.estimateTokens(messages);
      expect(tokens).toBe(25);
    });

    it('should append message and save', async () => {
      const msg: Message = { role: 'user', content: 'New message' };
      
      await sessionManager.appendMessage(msg);
      
      const loaded = await sessionManager.load();
      expect(loaded.messages).toHaveLength(1);
      expect(loaded.messages[0].content).toBe('New message');
    });

    it('should update token estimate as messages grow', async () => {
      const tokens1 = sessionManager.estimateTokens([{ role: 'user', content: 'a'.repeat(40) }]);
      const tokens2 = sessionManager.estimateTokens([
        { role: 'user', content: 'a'.repeat(40) },
        { role: 'assistant', content: 'b'.repeat(40) },
      ]);

      expect(tokens2).toBe(tokens1 * 2);
    });

    it('should track session metadata', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }];
      await sessionManager.save(messages);

      const loaded = await sessionManager.load();
      
      expect(loaded.version).toBe(1);
      expect(loaded.clawId).toBeDefined();
      expect(loaded.createdAt).toBeDefined();
      expect(loaded.updatedAt).toBeDefined();
    });
  });

  describe('ContextInjector', () => {
    let tempDir: string;
    let fs: NodeFileSystem;
    let injector: ContextInjector;

    beforeEach(async () => {
      tempDir = await createTempDir();
      fs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
      injector = new ContextInjector(fs);
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('should build system prompt from AGENTS.md and MEMORY.md', async () => {
      // Create AGENTS.md
      await fs.writeAtomic('AGENTS.md', '# Agent Instructions\nBe helpful.');
      // Create MEMORY.md
      await fs.writeAtomic('MEMORY.md', '# Memory\nUser likes TypeScript.');

      const prompt = await injector.buildSystemPrompt();

      expect(prompt).toContain('Agent Instructions');
      expect(prompt).toContain('Be helpful');
      expect(prompt).toContain('Memory');
      expect(prompt).toContain('User likes TypeScript');
    });

    it('should return empty string when AGENTS.md does not exist', async () => {
      const prompt = await injector.buildSystemPrompt();

      expect(prompt).toBe('');
    });

    it('should handle missing MEMORY.md gracefully', async () => {
      await fs.writeAtomic('AGENTS.md', '# Instructions\nTest.');
      // MEMORY.md doesn't exist

      const prompt = await injector.buildSystemPrompt();

      expect(prompt).toContain('Instructions');
      // Should not crash, just have AGENTS content
      expect(prompt).not.toContain('Memory');
    });

    it('should inject fixed prefix into session', async () => {
      await fs.writeAtomic('AGENTS.md', 'System prompt here');
      
      const session = {
        version: 1,
        clawId: 'test-claw',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [{ role: 'user', content: 'User question' }] as Message[],
        prunedMarkers: [],
      };

      await injector.injectFixedPrefix(session);

      // First message should be system with AGENTS content
      expect(session.messages[0].role).toBe('system');
      expect(session.messages[0].content).toContain('System prompt here');
      // Original user message should still be there
      expect(session.messages[1].role).toBe('user');
      expect(session.messages[1].content).toBe('User question');
    });

    it('should inject with no files gracefully', async () => {
      const session = {
        version: 1,
        clawId: 'test-claw',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [{ role: 'user', content: 'Q' }] as Message[],
        prunedMarkers: [],
      };

      // No AGENTS.md or MEMORY.md
      await injector.injectFixedPrefix(session);

      // No system message should be added (nothing to inject)
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].role).toBe('user');
    });
  });
});
