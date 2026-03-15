/**
 * InboxWatcher - Event-driven inbox message processor
 * 
 * Features:
 * - Watches inbox/pending/ for new messages
 * - Processes messages serially (one at a time)
 * - Priority-based ordering (critical > high > normal > low)
 * - Moves processed messages to done/, failed ones to failed/
 * - Cold-start recovery: processes existing pending files on start
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import type { IFileSystem, FileEntry } from '../../foundation/fs/types.js';
import type { InboxMessage, Priority } from '../../types/contract.js';
import { createWatcher } from '../../foundation/fs/watcher.js';
import type { Watcher } from '../../foundation/fs/types.js';

/**
 * Priority values for sorting
 */
const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Queued message with metadata
 */
interface QueuedMessage {
  message: InboxMessage;
  filePath: string;
  priority: number;
  timestamp: number;
}

/**
 * Inbox watcher and processor
 */
export class InboxWatcher {
  private inboxDir: string;
  private pendingDir: string;
  private doneDir: string;
  private failedDir: string;
  private watcher: Watcher | null = null;
  private queue: QueuedMessage[] = [];
  private processing = false;
  private stopped = false;
  private onMessage: ((msg: InboxMessage) => Promise<void>) | null = null;

  constructor(
    private clawDir: string,
    private fs: IFileSystem
  ) {
    this.inboxDir = path.join(clawDir, 'inbox');
    this.pendingDir = path.join(this.inboxDir, 'pending');
    this.doneDir = path.join(this.inboxDir, 'done');
    this.failedDir = path.join(this.inboxDir, 'failed');
  }

  /**
   * Start watching and processing messages
   */
  async start(onMessage: (msg: InboxMessage) => Promise<void>): Promise<void> {
    if (this.watcher) {
      throw new Error('InboxWatcher already started');
    }

    this.onMessage = onMessage;
    this.stopped = false;

    // Ensure directories exist
    await this.fs.ensureDir(this.pendingDir);
    await this.fs.ensureDir(this.doneDir);
    await this.fs.ensureDir(this.failedDir);

    // Load existing pending messages (cold-start recovery)
    this.loadExistingMessages().catch(err => {
      console.error('[InboxWatcher] Failed to load existing messages:', err);
    });

    // Start watching for new messages
    this.watcher = createWatcher(
      this.pendingDir,
      (event) => {
        if (event.type === 'add' && event.path.endsWith('.json')) {
          this.handleNewFile(event.path).catch(err => {
            console.error('[InboxWatcher] Failed to handle new file:', err);
          });
        }
      },
      { recursive: false }
    );
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.queue = [];
  }

  /**
   * Get current queue length (includes pending files not yet loaded)
   */
  async queueLength(): Promise<number> {
    // Count files in pending directory
    try {
      const entries = await this.fs.list(this.pendingDir, { includeDirs: false });
      const fileCount = entries.filter(e => e.name.endsWith('.json')).length;
      return Math.max(fileCount, this.queue.length);
    } catch {
      return this.queue.length;
    }
  }

  /**
   * Load existing pending messages on startup
   */
  private async loadExistingMessages(): Promise<void> {
    try {
      const entries = await this.fs.list(this.pendingDir, { includeDirs: false });
      
      for (const entry of entries) {
        if (entry.name.endsWith('.json')) {
          await this.handleNewFile(entry.path);
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  /**
   * Handle a new file in pending directory
   */
  private async handleNewFile(filePath: string): Promise<void> {
    try {
      const content = await this.fs.read(filePath);
      const message: InboxMessage = JSON.parse(content);
      
      const queued: QueuedMessage = {
        message,
        filePath,
        priority: PRIORITY_VALUES[message.priority] ?? PRIORITY_VALUES.normal,
        timestamp: new Date(message.timestamp).getTime() || Date.now(),
      };

      // Add to queue and sort
      this.queue.push(queued);
      this.sortQueue();

      // Trigger processing
      this.processQueue().catch(err => {
        console.error('[InboxWatcher] Failed to process queue:', err);
      });
    } catch {
      // Skip invalid files
    }
  }

  /**
   * Sort queue by priority (desc), then by timestamp (asc)
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.timestamp - b.timestamp; // Older first (FIFO)
    });
  }

  /**
   * Process queue serially
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.stopped || !this.onMessage) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift();
      if (!item) continue;

      try {
        await this.onMessage(item.message);
        // Success: move to done
        await this.moveToDone(item.filePath);
      } catch {
        // Failure: move to failed
        await this.moveToFailed(item.filePath);
      }
    }

    this.processing = false;
  }

  /**
   * Move processed file to done/
   */
  private async moveToDone(filePath: string): Promise<void> {
    try {
      const fileName = path.basename(filePath);
      const targetPath = path.join(this.doneDir, `${Date.now()}_${fileName}`);
      await this.fs.move(filePath, targetPath);
    } catch (err) {
      // Design doc: log move errors to stderr (best-effort)
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[inbox] Failed to move ${filePath} to done: ${msg}\n`);
    }
  }

  /**
   * Move failed file to failed/
   */
  private async moveToFailed(filePath: string): Promise<void> {
    try {
      const fileName = path.basename(filePath);
      const targetPath = path.join(this.failedDir, `${Date.now()}_${fileName}`);
      await this.fs.move(filePath, targetPath);
    } catch (err) {
      // Design doc: log move errors to stderr (best-effort)
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[inbox] Failed to move ${filePath} to failed: ${msg}\n`);
    }
  }
}
