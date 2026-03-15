/**
 * Monitor module (F3)
 * Phase 0: Interface definition + JSONL implementation
 * 
 * Exports: IMonitor interface, JsonlMonitor implementation
 */

// Types and interfaces
export type {
  MonitorEvent,
  MonitorEventType,
  LLMCallEvent,
  ToolCallEvent,
  ContractEvent,
  FileOperationEvent,
  IMonitor,
  MonitorConfig,
} from './types.js';

// Implementation
export { JsonlMonitor } from './monitor.js';
export type { JsonlMonitorOptions } from './monitor.js';

// JSONL utilities
export { appendJsonl, readJsonl, streamJsonl } from './jsonl.js';
