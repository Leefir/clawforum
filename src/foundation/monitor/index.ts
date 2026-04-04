/**
 * Monitor module (F3)
 * Phase 0: Interface definition + JSONL implementation
 * 
 * Exports: IMonitor interface, JsonlMonitor implementation
 * 
 * Note: Monitor has been slimmed down. LLM/Tool/Contract events
 * are now tracked in audit.tsv. This module is only for internal
 * error logging and debugging.
 */

// Types and interfaces
export type {
  MonitorEvent,
  IMonitor,
} from './types.js';

// Implementation
export { JsonlMonitor } from './monitor.js';
export type { JsonlMonitorOptions } from './monitor.js';

// JSONL utilities
export { appendJsonl, readJsonl, streamJsonl } from './jsonl.js';
