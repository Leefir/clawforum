/**
 * SessionManager - Manages Claw conversation sessions
 * 
 * Handles:
 * - current.json read/write
 * - Session archiving
 * - Token estimation
 * - Crash recovery from archive
 */

import * as path from 'path';
import type { IFileSystem } from '../../foundation/fs/types.js';
import type { Message } from '../../types/message.js';
import type { SessionData } from './types.js';
import { randomUUID } from 'crypto';

/**
 * Session manager configuration
 */
export interface SessionManagerOptions {
  /** Path to dialog directory (relative to fs base) */
  dialogDir: string;
}

/**
 * Manages a Claw's conversation session
 */
export class SessionManager {
  private readonly currentPath: string;
  private readonly archiveDir: string;
  private createdAt: string | null = null;
  
  constructor(
    private readonly fs: IFileSystem,
    dialogDir: string,
    private readonly clawId: string = randomUUID()
  ) {
    this.currentPath = path.join(dialogDir, 'current.json');
    this.archiveDir = path.join(dialogDir, 'archive');
  }

  /**
   * Load session from disk
   * - Returns current.json if exists
   * - Otherwise recovers latest archive (cold start)
   * - Returns empty session if nothing found
   */
  async load(): Promise<SessionData> {
    // Try current.json first
    try {
      const content = await this.fs.read(this.currentPath);
      const data = JSON.parse(content) as SessionData;
      // Cache createdAt for subsequent saves
      this.createdAt = data.createdAt;
      return data;
    } catch (err) {
      const code = (err as any).code;
      if (code === 'ENOENT' || code === 'FS_NOT_FOUND') {
        // 冷启动，文件不存在是正常的
      } else {
        console.error('[session] current.json corrupted:', err);
      }
    }

    // Try to recover from archive (cold start recovery)
    const archived = await this.loadLatestArchive();
    if (archived) {
      return archived;
    }

    // Return empty session
    const now = new Date().toISOString();
    return {
      version: 1,
      clawId: this.clawId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      prunedMarkers: [],
    };
  }

  /**
   * Save session to current.json
   */
  async save(messages: Message[]): Promise<void> {
    const now = new Date().toISOString();
    
    // Use cached createdAt if available, otherwise use now
    if (!this.createdAt) {
      this.createdAt = now;
    }

    const data: SessionData = {
      version: 1,
      clawId: this.clawId,
      createdAt: this.createdAt,
      updatedAt: now,
      messages,
      prunedMarkers: [], // Phase 3: will track compression markers
    };

    await this.fs.writeAtomic(this.currentPath, JSON.stringify(data, null, 2));
  }

  /**
   * Archive current session (move to archive dir)
   */
  async archive(): Promise<void> {
    // Ensure archive directory exists
    await this.fs.ensureDir(this.archiveDir);

    // Generate archive filename with timestamp
    const timestamp = Date.now();
    const archivePath = path.join(this.archiveDir, `${timestamp}.json`);

    // Move current.json to archive
    await this.fs.move(this.currentPath, archivePath);
  }

  /**
   * Get current messages
   */
  async getMessages(): Promise<Message[]> {
    const session = await this.load();
    return session.messages;
  }

  /**
   * Append a message and save
   */
  async appendMessage(msg: Message): Promise<void> {
    const messages = await this.getMessages();
    messages.push(msg);
    await this.save(messages);
  }

  /**
   * Estimate token count (rough approximation)
   * Simple heuristic: 4 characters ≈ 1 token
   * Good enough for threshold checking without external tokenizer
   */
  estimateTokens(messages: Message[]): number {
    let charCount = 0;
    
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        // Handle content blocks
        for (const block of msg.content) {
          if (block.type === 'text') {
            charCount += (block as { text: string }).text?.length ?? 0;
          } else {
            // Tool blocks estimate (JSON is verbose)
            charCount += JSON.stringify(block).length;
          }
        }
      }
    }

    return Math.ceil(charCount / 4);
  }

  /**
   * Truncate messages to stay within context token limit (sliding window).
   * Scans from the front until under limit, landing on a safe starting message
   * (a user message that isn't purely tool_results).
   * Returns the same array reference if no truncation needed.
   */
  truncateForContext(messages: Message[], maxTokens: number): { result: Message[]; pruned: number } {
    if (this.estimateTokens(messages) <= maxTokens) {
      return { result: messages, pruned: 0 };
    }

    // Find the first index where the tail fits in maxTokens
    let cutIdx = 0;
    while (cutIdx < messages.length - 2 &&
           this.estimateTokens(messages.slice(cutIdx)) > maxTokens) {
      cutIdx++;
    }

    // Advance to a safe starting point: first user message that isn't pure tool_results
    while (cutIdx < messages.length - 2) {
      const msg = messages[cutIdx];
      if (msg.role === 'user') {
        const isPureToolResult =
          Array.isArray(msg.content) &&
          msg.content.length > 0 &&
          msg.content.every((b: any) => b.type === 'tool_result');
        if (!isPureToolResult) break;
      }
      cutIdx++;
    }

    const pruned = cutIdx;
    if (pruned > 0) {
      console.warn(`[session] Pruned ${pruned} messages to fit context window (${maxTokens} tokens)`);
    }
    return { result: messages.slice(cutIdx), pruned };
  }

  /**
   * Load latest archive for crash recovery
   */
  private async loadLatestArchive(): Promise<SessionData | null> {
    try {
      const entries = await this.fs.list(this.archiveDir);
      
      // Filter JSON files and sort by timestamp (descending)
      const archives = entries
        .filter(e => e.isFile && e.name.endsWith('.json'))
        .sort((a, b) => {
          const tsA = parseInt(a.name.split('.')[0], 10);
          const tsB = parseInt(b.name.split('.')[0], 10);
          return tsB - tsA; // Newest first
        });

      if (archives.length === 0) {
        return null;
      }

      // Load latest
      const latestPath = path.join(this.archiveDir, archives[0].name);
      const content = await this.fs.read(latestPath);
      try {
        const data = JSON.parse(content) as SessionData;
        return this.validateSession(data);
      } catch (parseErr) {
        console.error(`[session] Archive corrupted: ${archives[0].name}`, parseErr);
        return null;
      }
    } catch (err) {
      console.error('[session] Failed to load archive:', err);
      return null;
    }
  }

  /**
   * Validate and normalize session data
   */
  private validateSession(data: SessionData): SessionData {
    return {
      version: data.version ?? 1,
      clawId: data.clawId ?? this.clawId,
      createdAt: data.createdAt ?? new Date().toISOString(),
      updatedAt: data.updatedAt ?? new Date().toISOString(),
      messages: Array.isArray(data.messages) ? data.messages : [],
      prunedMarkers: Array.isArray(data.prunedMarkers) ? data.prunedMarkers : [],
    };
  }
}
