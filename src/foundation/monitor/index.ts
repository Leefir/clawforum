/**
 * Monitor interface (F3)
 * Phase 0: Interface definitions only
 * 
 * Design principles:
 * - Async fire-and-forget event logging
 * - JSONL format for easy querying
 * - Minimal performance impact on main flow
 */

import type { LLMCallEvent } from '../llm/index.js';

// Re-export for convenience
export type { LLMCallEvent };

/**
 * Event types for monitoring
 */
export type MonitorEventType = 
  | 'llm_call'
  | 'tool_call'
  | 'contract_created'
  | 'contract_updated'
  | 'contract_completed'
  | 'contract_failed'
  | 'subagent_spawned'
  | 'subagent_completed'
  | 'file_operation'
  | 'error'
  | 'system';

/**
 * Base monitor event
 */
export interface MonitorEvent {
  id: string;
  timestamp: string;
  type: MonitorEventType;
  clawId?: string;
  contractId?: string;
  data: Record<string, unknown>;
}

/**
 * Tool call event details
 */
export interface ToolCallEvent {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  durationMs: number;
}

/**
 * Contract lifecycle event
 */
export interface ContractEvent {
  contractId: string;
  status: string;
  previousStatus?: string;
  message?: string;
}

/**
 * File operation event
 */
export interface FileOperationEvent {
  operation: 'read' | 'write' | 'delete' | 'move' | 'copy';
  path: string;
  success: boolean;
  size?: number;
  error?: string;
}

/**
 * Monitor interface - Event logging and metrics
 * 
 * Implementation notes:
 * - Events are buffered and written asynchronously
 * - JSONL format: one JSON object per line
 * - Query interface for basic filtering
 */
export interface IMonitor {
  /**
   * Log an LLM call event
   * @param event - LLM call details
   */
  logLLMCall(event: LLMCallEvent): void;
  
  /**
   * Log a tool call event
   * @param event - Tool call details
   */
  logToolCall(event: ToolCallEvent): void;
  
  /**
   * Log a contract lifecycle event
   * @param event - Contract event details
   */
  logContract(event: ContractEvent): void;
  
  /**
   * Log a file operation
   * @param event - File operation details
   */
  logFileOperation(event: FileOperationEvent): void;
  
  /**
   * Log a generic event
   * @param type - Event type
   * @param data - Event data
   */
  log(type: MonitorEventType, data: Record<string, unknown>): void;
  
  /**
   * Log an error
   * @param error - Error to log
   * @param context - Additional context
   */
  logError(error: Error, context?: Record<string, unknown>): void;
  
  /**
   * Flush buffered events to disk
   */
  flush(): Promise<void>;
  
  /**
   * Query events with filters
   * @param filters - Query filters
   * @returns Matching events
   */
  query(filters: {
    type?: MonitorEventType;
    clawId?: string;
    contractId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<MonitorEvent[]>;
  
  /**
   * Get metrics summary
   * @param timeRange - Time range for metrics
   */
  getMetrics(timeRange: {
    start: Date;
    end: Date;
  }): Promise<{
    llmCalls: number;
    toolCalls: number;
    errors: number;
    totalTokens: number;
    averageLatency: number;
  }>;
  
  /**
   * Close monitor and flush remaining events
   */
  close(): Promise<void>;
}

/**
 * Monitor configuration
 */
export interface MonitorConfig {
  /** Log file directory */
  logDir: string;
  
  /** Log file name pattern (default: YYYY-MM-DD.jsonl) */
  filePattern?: string;
  
  /** Buffer size before flush (default: 100) */
  bufferSize?: number;
  
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;
  
  /** Maximum log file size in MB (default: 100) */
  maxFileSizeMb?: number;
  
  /** Number of files to retain (default: 30) */
  retentionDays?: number;
}
