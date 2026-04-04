/**
 * JsonlMonitor - IMonitor implementation using JSONL files
 * 
 * Writes all events to a single monitor.jsonl file.
 * 
 * Note: LLM/Tool/Contract events have been migrated to audit.tsv,
 * use that for call tracking. This monitor is now only for
 * internal error logging and debugging.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import type {
  IMonitor,
  MonitorEvent,
} from './types.js';
import { appendJsonl } from './jsonl.js';

/**
 * Monitor configuration
 */
export interface JsonlMonitorOptions {
  /** Directory for log files */
  logsDir: string;
}

/**
 * JSONL-based monitor implementation
 */
export class JsonlMonitor implements IMonitor {
  private readonly logsDir: string;
  private readonly filePath: string;
  
  // Track pending writes for graceful shutdown
  private pendingWrites = 0;
  private closed = false;
  private logPromises = new Set<Promise<void>>();
  
  constructor(options: JsonlMonitorOptions) {
    this.logsDir = options.logsDir;
    this.filePath = path.join(this.logsDir, 'monitor.jsonl');
  }
  
  /**
   * Ensure logs directory exists
   */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }
  
  /**
   * Generate unique event ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
  
  /**
   * Write event to monitor.jsonl
   */
  private async writeEvent(
    data: Record<string, unknown>,
    metadata?: { clawId?: string; contractId?: string; type?: string }
  ): Promise<void> {
    if (this.closed) {
      throw new Error('Monitor is closed');
    }
    
    await this.ensureDir();
    
    const record: MonitorEvent = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type: metadata?.type ?? 'event',
      ...(metadata?.clawId ? { clawId: metadata.clawId } : {}),
      ...(metadata?.contractId ? { contractId: metadata.contractId } : {}),
      data,
    };
    
    this.pendingWrites++;
    try {
      await appendJsonl(this.filePath, record as unknown as Record<string, unknown>);
    } finally {
      this.pendingWrites--;
    }
  }
  
  // ========================================================================
  // IMonitor Implementation
  // ========================================================================
  
  log(type: string, data: Record<string, unknown>): void {
    const { clawId, contractId, ...rest } = data;
    const promise = this.writeEvent(rest, { 
      type, 
      clawId: clawId as string, 
      contractId: contractId as string 
    });
    this.logPromises.add(promise);
    promise.finally(() => {
      this.logPromises.delete(promise);
    });
  }
  
  async flush(): Promise<void> {
    // Wait for all pending log promises to complete
    while (this.logPromises.size > 0) {
      await Promise.all(this.logPromises);
    }
  }
  
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    
    this.closed = true;
    await this.flush();
  }
}
