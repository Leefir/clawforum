/**
 * Monitor module types (F3)
 * Self-contained type definitions to avoid circular imports
 */

// Event types for monitoring
export type MonitorEventType =
  | 'llm_call'
  | 'tool_call'
  | 'contract_created'
  | 'contract_updated'
  | 'contract_completed'
  | 'contract_failed'
  | 'contract_acceptance_started'
  | 'subagent_spawned'
  | 'subagent_scheduled'
  | 'subagent_completed'
  | 'tool_task_spawned'
  | 'tool_task_scheduled'
  | 'tool_task_completed'
  | 'tool_task_retry'
  | 'task_recovered'
  | 'task_discarded'
  | 'task_recovery_complete'
  | 'file_operation'
  | 'error'
  | 'system';

// LLM call event
export interface LLMCallEvent {
  timestamp: string;
  provider: string;
  model: string;
  success: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  isFallback: boolean;
  retryCount: number;
  clawId?: string;
}

// Tool call event
export interface ToolCallEvent {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  durationMs: number;
}

// Contract lifecycle event
export interface ContractEvent {
  contractId: string;
  status: string;
  previousStatus?: string;
  message?: string;
}

// File operation event
export interface FileOperationEvent {
  operation: 'read' | 'write' | 'delete' | 'move' | 'copy';
  path: string;
  success: boolean;
  size?: number;
  error?: string;
}

// Base monitor event
export interface MonitorEvent {
  id: string;
  timestamp: string;
  type: MonitorEventType;
  clawId?: string;
  contractId?: string;
  data: Record<string, unknown>;
}

// Monitor configuration
export interface MonitorConfig {
  logDir: string;
  filePattern?: string;
  bufferSize?: number;
  flushIntervalMs?: number;
  maxFileSizeMb?: number;
  retentionDays?: number;
}

// Monitor interface
export interface IMonitor {
  logLLMCall(event: LLMCallEvent): void;
  logToolCall(event: ToolCallEvent): void;
  logFileOperation(event: FileOperationEvent): void;
  log(type: MonitorEventType, data: Record<string, unknown>): void;
  logError(error: Error, context?: Record<string, unknown>): void;
  flush(): Promise<void>;
  query(filters: {
    type?: MonitorEventType;
    clawId?: string;
    contractId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<MonitorEvent[]>;
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
  close(): Promise<void>;
}
