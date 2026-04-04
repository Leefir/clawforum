/**
 * Monitor module types (F3)
 * Self-contained type definitions to avoid circular imports
 */

// Base monitor event
export interface MonitorEvent {
  id: string;
  timestamp: string;
  type: string;
  clawId?: string;
  contractId?: string;
  data: Record<string, unknown>;
}

// Monitor interface - 精简为仅保留核心方法
export interface IMonitor {
  log(type: string, data: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}
