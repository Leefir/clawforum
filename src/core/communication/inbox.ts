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
import { PRIORITY_VALUES } from '../../types/contract.js';
import { createWatcher } from '../../foundation/fs/watcher.js';
import type { Watcher } from '../../foundation/fs/types.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';
const MAX_QUEUE_SIZE = 1000;  // Queue size limit to prevent memory exhaustion

const VALID_PRIORITIES: Priority[] = ['critical', 'high', 'normal', 'low'];
const VALID_TYPES = ['message', 'crash', 'contract', 'report', 'notification'];

function validatePriority(value: unknown): Priority {
  if (typeof value === 'string' && VALID_PRIORITIES.includes(value as Priority)) {
    return value as Priority;
  }
  console.warn(`[inbox] Invalid priority: ${value}, using 'normal'`);
  return 'normal';
}

function validateType(value: unknown): InboxMessage['type'] {
  if (typeof value === 'string' && VALID_TYPES.includes(value)) {
    return value as InboxMessage['type'];
  }
  return 'message';
}

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
  private processedFiles = new Set<string>();  // Deduplication for watcher events

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
    await this.loadExistingMessages();

    // Start watching for new messages
    this.watcher = createWatcher(
      this.pendingDir,
      (event) => {
        if (event.type === 'add' && event.path.endsWith('.md')) {
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
      const fileCount = entries.filter(e => e.name.endsWith('.md')).length;
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
        if (entry.name.endsWith('.md')) {
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
    // Deduplication: skip if already processed
    if (this.processedFiles.has(filePath)) {
      return;
    }
    this.processedFiles.add(filePath);
    
    // Queue size limit: drop lowest priority if exceeded
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.sortQueue();
      const dropped = this.queue.pop();  // Remove lowest priority
      console.warn(`[inbox] Queue full, dropped message: ${dropped?.message.id}`);
    }
    
    try {
      const content = await this.fs.read(filePath);
      const { meta, body } = parseFrontmatter(content);
      
      const message: InboxMessage = {
        id: meta.id ?? randomUUID(),
        type: validateType(meta.type),
        from: meta.from ?? meta.source ?? 'unknown',
        to: meta.to ?? '',
        content: body,
        priority: validatePriority(meta.priority),
        timestamp: meta.timestamp ?? new Date().toISOString(),
        contract_id: meta.claw_id ?? meta.contract_id,
      };
      
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
    } catch (err) {
      console.warn(`[inbox] Skip malformed message ${filePath}:`, err);
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
      } catch (err) {
        // Failure: move to failed
        console.error(`[inbox] Process failed for ${item.filePath}:`, err);
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
      const uuid8 = randomUUID().slice(0, 8);
      const targetPath = path.join(this.doneDir, `${Date.now()}_${uuid8}_${fileName}`);
      await this.fs.move(filePath, targetPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[inbox] Failed to move ${filePath} to done:`, msg);
    }
  }

  /**
   * Move failed file to failed/
   */
  private async moveToFailed(filePath: string): Promise<void> {
    try {
      const fileName = path.basename(filePath);
      const uuid8 = randomUUID().slice(0, 8);
      const targetPath = path.join(this.failedDir, `${Date.now()}_${uuid8}_${fileName}`);
      await this.fs.move(filePath, targetPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[inbox] Failed to move ${filePath} to failed:`, msg);
    }
  }
}
