/**
 * Transport tests - LocalTransport implementation
 * 
 * Tests:
 * - Inbox message operations (send, read, mark as read)
 * - Priority sorting
 * - Claw lifecycle (alive check, active claws list)
 * - File watching
 * - Stub methods throw not implemented
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { LocalTransport } from '../../src/foundation/transport/local.js';
import type { InboxMessage } from '../../src/types/contract.js';

/**
 * Create a temporary directory for tests
 */
async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-transport-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Parse YAML frontmatter for testing
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw };
  const afterOpen = raw.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx < 0) return { meta: {}, body: raw };

  const meta: Record<string, string> = {};
  for (const line of afterOpen.slice(0, closeIdx).split('\n')) {
    const ci = line.indexOf(':');
    if (ci > 0) meta[line.slice(0, ci).trim()] = line.slice(ci + 1).trim();
  }
  return { meta, body: afterOpen.slice(closeIdx + 5).trim() };
}

describe('Transport', () => {
  describe('LocalTransport', () => {
    let tempDir: string;
    let transport: LocalTransport;

    beforeEach(async () => {
      tempDir = await createTempDir();
      transport = new LocalTransport({ workspaceDir: tempDir });
      await transport.initialize();
    });

    afterEach(async () => {
      await transport.close();
      await cleanupTempDir(tempDir);
    });

    it('should send inbox message to pending directory', async () => {
      const msg: InboxMessage = {
        id: 'msg-1',
        type: 'message',
        from: 'motion-1',
        to: 'claw-1',
        content: 'Hello',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      await transport.sendInboxMessage('claw-1', msg);

      // Check file exists in pending
      const pendingDir = path.join(tempDir, 'claws', 'claw-1', 'inbox', 'pending');
      const files = await fs.readdir(pendingDir);
      
      expect(files).toHaveLength(1);
      
      // Verify YAML frontmatter content
      const content = await fs.readFile(path.join(pendingDir, files[0]), 'utf-8');
      const { meta, body } = parseFrontmatter(content);
      expect(meta.id).toBe('msg-1');
      expect(body).toBe('Hello');
    });

    it('should read inbox messages sorted by priority', async () => {
      // Send messages with different priorities
      const priorities: Array<'low' | 'normal' | 'high' | 'critical'> = 
        ['normal', 'critical', 'low', 'high'];
      
      for (let i = 0; i < priorities.length; i++) {
        const msg: InboxMessage = {
          id: `msg-${i}`,
          type: 'message',
          from: 'motion-1',
          to: 'claw-1',
          content: `Message ${i}`,
          priority: priorities[i],
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        };
        await transport.sendInboxMessage('claw-1', msg);
      }

      const messages = await transport.readInbox('claw-1');

      expect(messages).toHaveLength(4);
      // Should be sorted: critical > high > normal > low
      expect(messages[0].priority).toBe('critical');
      expect(messages[1].priority).toBe('high');
      expect(messages[2].priority).toBe('normal');
      expect(messages[3].priority).toBe('low');
    });

    it('should sort same priority by time (oldest first)', async () => {
      // Send messages with same priority but different times
      for (let i = 0; i < 3; i++) {
        const msg: InboxMessage = {
          id: `msg-${i}`,
          type: 'message',
          from: 'motion-1',
          to: 'claw-1',
          content: `Message ${i}`,
          priority: 'normal',
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        };
        await transport.sendInboxMessage('claw-1', msg);
      }

      const messages = await transport.readInbox('claw-1');

      expect(messages).toHaveLength(3);
      // Oldest (msg-0) should be first
      expect(messages[0].id).toBe('msg-0');
      expect(messages[1].id).toBe('msg-1');
      expect(messages[2].id).toBe('msg-2');
    });

    it('should mark message as read (move pending to done)', async () => {
      const msg: InboxMessage = {
        id: 'msg-read-test',
        type: 'message',
        from: 'motion-1',
        to: 'claw-1',
        content: 'To be read',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };

      await transport.sendInboxMessage('claw-1', msg);
      
      // Verify in pending
      const pendingDir = path.join(tempDir, 'claws', 'claw-1', 'inbox', 'pending');
      let pendingFiles = await fs.readdir(pendingDir);
      expect(pendingFiles).toHaveLength(1);

      // Mark as read
      await transport.markAsRead('claw-1', 'msg-read-test');

      // Verify moved to done
      pendingFiles = await fs.readdir(pendingDir);
      expect(pendingFiles).toHaveLength(0);
      
      const doneDir = path.join(tempDir, 'claws', 'claw-1', 'inbox', 'done');
      const doneFiles = await fs.readdir(doneDir);
      expect(doneFiles).toHaveLength(1);
    });

    it('should get inbox status counts', async () => {
      // Send 2 normal messages
      for (let i = 0; i < 2; i++) {
        await transport.sendInboxMessage('claw-1', {
          id: `msg-${i}`,
          type: 'message',
          from: 'motion-1',
          to: 'claw-1',
          content: `Msg ${i}`,
          priority: 'normal',
          timestamp: new Date().toISOString(),
        });
      }

      const status = await transport.getInboxStatus('claw-1');

      expect(status.total).toBe(2);
      expect(status.unread).toBe(2);
      expect(status.highPriority).toBe(0);
    });

    it('should report high priority count correctly', async () => {
      await transport.sendInboxMessage('claw-1', {
        id: 'msg-1',
        type: 'message',
        from: 'motion-1',
        to: 'claw-1',
        content: 'Critical!',
        priority: 'critical',
        timestamp: new Date().toISOString(),
      });

      const status = await transport.getInboxStatus('claw-1');
      expect(status.highPriority).toBe(1);
    });

    it('should check if claw is alive', async () => {
      // Create a claw directory
      const clawDir = path.join(tempDir, 'claws', 'alive-claw');
      await fs.mkdir(clawDir, { recursive: true });

      expect(await transport.isClawAlive('alive-claw')).toBe(true);
      expect(await transport.isClawAlive('nonexistent-claw')).toBe(false);
    });

    it('should list active claws', async () => {
      // Create multiple claw directories
      await fs.mkdir(path.join(tempDir, 'claws', 'claw-a'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'claws', 'claw-b'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'claws', 'claw-c'), { recursive: true });

      const claws = await transport.getActiveClaws();

      expect(claws).toHaveLength(3);
      expect(claws).toContain('claw-a');
      expect(claws).toContain('claw-b');
      expect(claws).toContain('claw-c');
    });

    it('should watch inbox for new messages', async () => {
      const messages: InboxMessage[] = [];
      
      // Start watching
      const unwatch = await transport.watchInbox('claw-watch', (msg) => {
        messages.push(msg);
      });

      // Wait a bit for watcher to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send a message
      const msg: InboxMessage = {
        id: 'watched-msg',
        type: 'message',
        from: 'motion-1',
        to: 'claw-watch',
        content: 'Watched!',
        priority: 'normal',
        timestamp: new Date().toISOString(),
      };
      await transport.sendInboxMessage('claw-watch', msg);

      // Wait for callback
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('watched-msg');

      // Cleanup
      await unwatch();
    });

    it('should send and update heartbeat', async () => {
      const entry = {
        claw_id: 'claw-hb',
        timestamp: new Date().toISOString(),
        status: 'idle' as const,
        message_count: 0,
      };

      await transport.sendHeartbeat(entry);

      // Verify heartbeat file
      const hbPath = path.join(tempDir, 'claws', 'claw-hb', 'heartbeat.json');
      const content = await fs.readFile(hbPath, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.claw_id).toBe('claw-hb');
      expect(parsed.status).toBe('idle');
    });

    it('should throw not implemented for stub methods', async () => {
      await expect(transport.sendMotionMessage('motion-1', {
        id: 'msg-1',
        type: 'response',
        from: 'claw-1',
        to: 'motion-1',
        content: 'test',
        timestamp: new Date().toISOString(),
      })).rejects.toThrow(/not implemented/i);

      await expect(transport.readOutbox('claw-1')).rejects.toThrow(/not implemented/i);
      await expect(transport.dispatchContract('claw-1', {} as any)).rejects.toThrow(/not implemented/i);
      await expect(transport.getContract('contract-1')).rejects.toThrow(/not implemented/i);
      await expect(transport.updateContract('contract-1', {})).rejects.toThrow(/not implemented/i);
      await expect(transport.listContracts('claw-1')).rejects.toThrow(/not implemented/i);
    });

    it('should initialize directory structure', async () => {
      // Verify claws directory exists
      const clawsDir = path.join(tempDir, 'claws');
      const stat = await fs.stat(clawsDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should close all watchers on close', async () => {
      // Start a watcher
      const unwatch = await transport.watchInbox('claw-close', () => {});
      
      // Close should not throw
      await transport.close();
      
      // Cleanup
      await unwatch();
    });
  });
});
