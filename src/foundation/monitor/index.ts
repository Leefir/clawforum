/**
 * Monitor module (F3)
 * Phase 0: Interface definition + JSONL implementation
 * 
 * Exports: IMonitor interface, JsonlMonitor implementation
 */

// TODO(phase3): 统计聚合方法 get_llm_stats() - MVP 有聚合统计，TS 只有基础 JSONL 写入

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
