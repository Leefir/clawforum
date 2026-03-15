/**
 * DirectoryQueue - File-based task queue
 * 
 * Uses directory structure for queue states:
 * - pending/  - Tasks waiting to be processed
 * - running/  - Tasks currently being processed
 * - done/     - Successfully completed tasks
 * - failed/   - Failed tasks
 * 
 * Leverages fs.rename() atomicity for concurrency safety
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { QueueEntry, Watcher, IFileSystem } from './types.js';

/**
 * Queue configuration
 */
export interface DirectoryQueueOptions {
  /** Base directory for queue (contains pending/, running/, done/, failed/) */
  baseDir: string;
  
  /** File system instance to use */
  fs?: IFileSystem;
  
  /** File extension for queue entries (default: .json) */
  extension?: string;
}

/**
 * Queue entry data (stored in file)
 */
export interface QueueEntryData {
  id: string;
  source: string;
  data: unknown;
  createdAt: string;
  priority?: number;
}

/**
 * Parse queue entry from filename
 * Format: {timestamp}_{source}_{uuid}.{ext}
 */
function parseEntryFilename(
  filename: string, 
  baseDir: string,
  status: QueueEntry['status']
): QueueEntry | null {
  // Remove extension
  const extIndex = filename.lastIndexOf('.');
  const name = extIndex > 0 ? filename.slice(0, extIndex) : filename;
  
  // Parse: timestamp_source_uuid
  const parts = name.split('_');
  if (parts.length < 3) {
    return null;
  }
  
  const timestamp = parts[0];
  const uuid = parts[parts.length - 1];
  // Source (parts[1] to parts[length-2]) is parsed but not stored in QueueEntry
  // It can be extracted from the filename if needed
  
  // Validate timestamp
  const createdAt = new Date(parseInt(timestamp, 10));
  if (isNaN(createdAt.getTime())) {
    return null;
  }
  
  return {
    id: uuid,
    fileName: filename,
    sourcePath: path.join(baseDir, filename),
    status,
    createdAt,
  };
}

/**
 * Generate filename for queue entry
 */
function generateEntryFilename(source: string, extension: string): string {
  const timestamp = Date.now();
  const uuid = randomUUID().slice(0, 8);
  return `${timestamp}_${source}_${uuid}${extension}`;
}

/**
 * Get file modification time
 */
async function getMtime(filePath: string): Promise<Date> {
  const stats = await fs.stat(filePath);
  return stats.mtime;
}

/**
 * Directory-based queue implementation
 */
export class DirectoryQueue {
  private readonly pendingDir: string;
  private readonly runningDir: string;
  private readonly doneDir: string;
  private readonly failedDir: string;
  private readonly extension: string;
  private fsImpl: IFileSystem | null = null;
  
  constructor(private readonly opts: DirectoryQueueOptions) {
    this.pendingDir = path.join(this.opts.baseDir, 'pending');
    this.runningDir = path.join(this.opts.baseDir, 'running');
    this.doneDir = path.join(this.opts.baseDir, 'done');
    this.failedDir = path.join(this.opts.baseDir, 'failed');
    this.extension = this.opts.extension ?? '.json';
    this.fsImpl = this.opts.fs ?? null;
  }
  
  /**
   * Initialize queue directories
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.pendingDir, { recursive: true });
    await fs.mkdir(this.runningDir, { recursive: true });
    await fs.mkdir(this.doneDir, { recursive: true });
    await fs.mkdir(this.failedDir, { recursive: true });
  }
  
  /**
   * Add an entry to the queue (pending state)
   * @param source - Source identifier (e.g., 'inbox', 'contract')
   * @param data - Entry data
   * @returns The created entry ID
   */
  async enqueue(source: string, data: unknown): Promise<string> {
    const id = randomUUID();
    const filename = generateEntryFilename(source, this.extension);
    const filePath = path.join(this.pendingDir, filename);
    
    const entryData: QueueEntryData = {
      id,
      source,  // Used in stored data for tracking
      data,
      createdAt: new Date().toISOString(),
    };
    
    await fs.writeFile(filePath, JSON.stringify(entryData, null, 2), 'utf-8');
    
    return id;
  }
  
  /**
   * Get next pending entry and move it to running (atomic)
   * @returns The entry or null if queue is empty
   */
  async dequeue(): Promise<QueueEntry | null> {
    const pending = await this.listPending();
    
    if (pending.length === 0) {
      return null;
    }
    
    // Sort by creation time (oldest first - FIFO)
    pending.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    for (const entry of pending) {
      const sourcePath = path.join(this.pendingDir, entry.fileName);
      const targetPath = path.join(this.runningDir, entry.fileName);
      
      try {
        // Atomic move using rename
        await fs.rename(sourcePath, targetPath);
        
        // Update entry
        const updatedEntry: QueueEntry = {
          ...entry,
          status: 'running',
          sourcePath: targetPath,
          startedAt: new Date(),
        };
        
        return updatedEntry;
      } catch (error) {
        // Another process might have taken this entry
        // Continue to next
        continue;
      }
    }
    
    // All entries were taken by other processes
    return null;
  }
  
  /**
   * Mark a running entry as completed
   */
  async complete(entryId: string, result?: unknown): Promise<void> {
    const entry = await this.findInRunning(entryId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found in running state`);
    }
    
    const sourcePath = path.join(this.runningDir, entry.fileName);
    const targetPath = path.join(this.doneDir, entry.fileName);
    
    // Move to done
    await fs.rename(sourcePath, targetPath);
    
    // Update file with result
    if (result !== undefined) {
      const data = await this.readEntryData(targetPath);
      data.result = result;
      data.completedAt = new Date().toISOString();
      await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
  
  /**
   * Mark a running entry as failed
   */
  async fail(entryId: string, error: string): Promise<void> {
    const entry = await this.findInRunning(entryId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found in running state`);
    }
    
    const sourcePath = path.join(this.runningDir, entry.fileName);
    const targetPath = path.join(this.failedDir, entry.fileName);
    
    // Move to failed
    await fs.rename(sourcePath, targetPath);
    
    // Update file with error
    const data = await this.readEntryData(targetPath);
    data.error = error;
    data.failedAt = new Date().toISOString();
    await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
  }
  
  /**
   * Move a running entry back to pending (for recovery/retry)
   */
  async requeue(entryId: string): Promise<void> {
    const entry = await this.findInRunning(entryId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found in running state`);
    }
    
    const sourcePath = path.join(this.runningDir, entry.fileName);
    const targetPath = path.join(this.pendingDir, entry.fileName);
    
    await fs.rename(sourcePath, targetPath);
  }
  
  /**
   * Get all pending entries
   */
  async getPending(): Promise<QueueEntry[]> {
    return this.listPending();
  }
  
  /**
   * Get all running entries
   */
  async getRunning(): Promise<QueueEntry[]> {
    const files = await this.safeReaddir(this.runningDir);
    const entries: QueueEntry[] = [];
    
    for (const file of files) {
      const entry = parseEntryFilename(file, this.runningDir, 'running');
      if (entry) {
        entry.startedAt = await getMtime(entry.sourcePath);
        entries.push(entry);
      }
    }
    
    return entries;
  }
  
  /**
   * List pending entries
   */
  private async listPending(): Promise<QueueEntry[]> {
    const files = await this.safeReaddir(this.pendingDir);
    const entries: QueueEntry[] = [];
    
    for (const file of files) {
      const entry = parseEntryFilename(file, this.pendingDir, 'pending');
      if (entry) {
        entries.push(entry);
      }
    }
    
    return entries;
  }
  
  /**
   * Find entry in running state by ID
   */
  private async findInRunning(entryId: string): Promise<QueueEntry | null> {
    const running = await this.getRunning();
    return running.find(e => e.id === entryId) ?? null;
  }
  
  /**
   * Read entry data from file
   */
  private async readEntryData(filePath: string): Promise<QueueEntryData & Record<string, unknown>> {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  }
  
  /**
   * Safe readdir (returns empty array if directory doesn't exist)
   */
  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
  }
  
  /**
   * Watch for new pending entries
   */
  watch(callback: (entry: QueueEntry) => void): Watcher {
    if (!this.fsImpl) {
      throw new Error('FileSystem instance required for watching');
    }
    
    return this.fsImpl.watch(this.pendingDir, (event) => {
      if (event.type === 'add') {
        const entry = parseEntryFilename(
          path.basename(event.path), 
          this.pendingDir, 
          'pending'
        );
        if (entry) {
          callback(entry);
        }
      }
    });
  }
  
  /**
   * Recovery: move all running entries back to pending
   * Should be called on startup to handle crash recovery
   */
  async recover(): Promise<QueueEntry[]> {
    const running = await this.getRunning();
    const recovered: QueueEntry[] = [];
    
    for (const entry of running) {
      try {
        await this.requeue(entry.id);
        recovered.push(entry);
      } catch {
        // Ignore recovery errors
      }
    }
    
    return recovered;
  }
  
  /**
   * Get queue statistics
   */
  async stats(): Promise<{
    pending: number;
    running: number;
    done: number;
    failed: number;
  }> {
    const [pending, running, done, failed] = await Promise.all([
      this.safeReaddir(this.pendingDir).then(f => f.length),
      this.safeReaddir(this.runningDir).then(f => f.length),
      this.safeReaddir(this.doneDir).then(f => f.length),
      this.safeReaddir(this.failedDir).then(f => f.length),
    ]);
    
    return { pending, running, done, failed };
  }
}
