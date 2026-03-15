/**
 * JsonlMonitor - IMonitor implementation using JSONL files
 * 
 * Each event type is written to a separate JSONL file:
 * - llm-calls.jsonl
 * - tool-calls.jsonl
 * - contracts.jsonl
 * - errors.jsonl
 * - events.jsonl (generic events)
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import type {
  IMonitor,
  MonitorEvent,
  MonitorEventType,
  LLMCallEvent,
  ToolCallEvent,
  ContractEvent,
} from './types.js';
import { appendJsonl, readJsonl } from './jsonl.js';

/**
 * Monitor configuration
 */
export interface JsonlMonitorOptions {
  /** Directory for log files */
  logsDir: string;
}

/**
 * Internal event record with metadata
 */
interface EventRecord {
  id: string;
  timestamp: string;
  type: MonitorEventType;
  clawId?: string;
  contractId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/**
 * JSONL-based monitor implementation
 */
export class JsonlMonitor implements IMonitor {
  private readonly logsDir: string;
  
  // Track pending writes for graceful shutdown
  private pendingWrites = 0;
  private closed = false;
  
  constructor(options: JsonlMonitorOptions) {
    this.logsDir = options.logsDir;
  }
  
  /**
   * Ensure logs directory exists
   */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }
  
  /**
   * Get file path for event type
   * Maps event types to safe filenames (avoid reserved names like 'system')
   */
  private getFilePath(type: MonitorEventType): string {
    const filenameMap: Record<MonitorEventType, string> = {
      'llm_call': 'llm-calls.jsonl',
      'tool_call': 'tool-calls.jsonl',
      'contract_created': 'contracts.jsonl',
      'contract_updated': 'contracts.jsonl',
      'contract_completed': 'contracts.jsonl',
      'contract_failed': 'contracts.jsonl',
      'subagent_spawned': 'subagents.jsonl',
      'subagent_completed': 'subagents.jsonl',
      'file_operation': 'file-ops.jsonl',
      'error': 'errors.jsonl',
      'system': 'events.jsonl',  // Map 'system' to 'events.jsonl'
    };
    const filename = filenameMap[type] ?? `${type.replace(/_/g, '-')}.jsonl`;
    return path.join(this.logsDir, filename);
  }
  
  /**
   * Generate unique event ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
  
  /**
   * Write event to appropriate JSONL file
   */
  private async writeEvent(
    type: MonitorEventType,
    data: Record<string, unknown> | unknown,
    metadata?: { clawId?: string; contractId?: string }
  ): Promise<void> {
    if (this.closed) {
      throw new Error('Monitor is closed');
    }
    
    await this.ensureDir();
    
    const record: EventRecord = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type,
      ...metadata,
      data: data as Record<string, unknown>,
    };
    
    const filePath = this.getFilePath(type);
    
    this.pendingWrites++;
    try {
      await appendJsonl(filePath, record as unknown as Record<string, unknown>);
    } finally {
      this.pendingWrites--;
    }
  }
  
  // ========================================================================
  // IMonitor Implementation
  // ========================================================================
  
  private logPromises: Promise<void>[] = [];

  logLLMCall(event: LLMCallEvent): void {
    const promise = this.writeEvent('llm_call', event as unknown);
    this.logPromises.push(promise);
    // Clean up completed promises
    promise.then(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    }).catch(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    });
  }
  
  logToolCall(event: ToolCallEvent): void {
    const promise = this.writeEvent('tool_call', event as unknown);
    this.logPromises.push(promise);
    promise.then(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    }).catch(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    });
  }
  
  logContract(event: ContractEvent): void {
    const promise = this.writeEvent('contract_updated', event as unknown);
    this.logPromises.push(promise);
    promise.then(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    }).catch(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    });
  }
  
  logFileOperation(event: {
    operation: string;
    path: string;
    success: boolean;
    size?: number;
    error?: string;
  }): void {
    const promise = this.writeEvent('file_operation', event);
    this.logPromises.push(promise);
    promise.then(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    }).catch(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    });
  }
  
  log(type: MonitorEventType, data: Record<string, unknown>): void {
    const { clawId, contractId, ...rest } = data;
    const promise = this.writeEvent(type, rest, { clawId: clawId as string, contractId: contractId as string });
    this.logPromises.push(promise);
    promise.then(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    }).catch(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    });
  }
  
  logError(error: Error, context?: Record<string, unknown>): void {
    const promise = this.writeEvent('error', {
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack,
      },
      context,
    });
    this.logPromises.push(promise);
    promise.then(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    }).catch(() => {
      const idx = this.logPromises.indexOf(promise);
      if (idx > -1) this.logPromises.splice(idx, 1);
    });
  }
  
  async flush(): Promise<void> {
    // Wait for all pending log promises to complete
    while (this.logPromises.length > 0) {
      await Promise.all(this.logPromises);
    }
  }
  
  async query(filters: {
    type?: MonitorEventType;
    clawId?: string;
    contractId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<MonitorEvent[]> {
    const { type, clawId, contractId, startTime, endTime, limit } = filters;
    
    // If type specified, only read that file
    const typesToQuery: MonitorEventType[] = type 
      ? [type] 
      : ['llm_call', 'tool_call', 'contract_updated', 'file_operation', 'error', 'system'];
    
    const allEvents: MonitorEvent[] = [];
    
    for (const eventType of typesToQuery) {
      const filePath = this.getFilePath(eventType);
      const records = await readJsonl<EventRecord>(filePath);
      
      for (const record of records) {
        // Apply filters
        if (clawId && record.clawId !== clawId) continue;
        if (contractId && record.contractId !== contractId) continue;
        
        if (startTime || endTime) {
          const recordTime = new Date(record.timestamp);
          if (startTime && recordTime < startTime) continue;
          if (endTime && recordTime > endTime) continue;
        }
        
        allEvents.push(record as MonitorEvent);
      }
    }
    
    // Sort by timestamp (oldest first)
    allEvents.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Apply limit
    if (limit && limit > 0) {
      return allEvents.slice(0, limit);
    }
    
    return allEvents;
  }
  
  async getMetrics(timeRange: {
    start: Date;
    end: Date;
  }): Promise<{
    llmCalls: number;
    toolCalls: number;
    errors: number;
    totalTokens: number;
    averageLatency: number;
  }> {
    const { start, end } = timeRange;
    
    let llmCalls = 0;
    let toolCalls = 0;
    let errors = 0;
    let totalTokens = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    
    // Query LLM calls
    const llmRecords = await this.query({ type: 'llm_call', startTime: start, endTime: end });
    for (const record of llmRecords) {
      llmCalls++;
      const data = record.data as unknown as LLMCallEvent;
      if (data.inputTokens) totalTokens += data.inputTokens;
      if (data.outputTokens) totalTokens += data.outputTokens;
      if (data.latencyMs) {
        totalLatency += data.latencyMs;
        latencyCount++;
      }
    }
    
    // Query tool calls
    const toolRecords = await this.query({ type: 'tool_call', startTime: start, endTime: end });
    toolCalls = toolRecords.length;
    
    // Query errors
    const errorRecords = await this.query({ type: 'error', startTime: start, endTime: end });
    errors = errorRecords.length;
    
    return {
      llmCalls,
      toolCalls,
      errors,
      totalTokens,
      averageLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
    };
  }
  
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    
    this.closed = true;
    await this.flush();
  }
}
