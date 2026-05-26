/**
 * @module L4.AsyncTaskSystem
 * Task system exports
 */

import type { FileSystem } from '../../foundation/fs/types.js';
import { AsyncTaskSystem } from './system.js';
import type { AsyncTaskSystemOptions, SubAgentTask } from './types.js';

export { AsyncTaskSystem } from './system.js';
export type { AsyncTaskSystemOptions, SubAgentTask } from './types.js';

export {
  TASKS_SYNC_DIR,
  TASKS_QUEUES_PENDING_DIR,
  TASKS_QUEUES_RUNNING_DIR,
  TASKS_QUEUES_DONE_DIR,
  TASKS_QUEUES_FAILED_DIR,
  TASKS_QUEUES_RESULTS_DIR,
  TASKS_SUBAGENTS_DIR,
} from './dirs.js';

export { writePendingToolTaskFile } from './tools/_pending-tool-task-writer.js';
export { classifyTaskError } from './_helpers.js';

// phase 1130: typed audit emit functions
export * from './audit-emit.js';


/** SubAgent task scheduling payload (sans id/createdAt, filled by writer) */
export type SubAgentTaskInfo = Omit<SubAgentTask, 'id' | 'createdAt'>;

/**
 * AsyncTaskSystem 工厂函数。签名与 constructor 1:1；纯透传不加工。
 *
 * 调用方：Assembly。
 * 不调 initialize / startDispatch——业务动作归 Runtime（见 l4_task_system.md §2 "#2 归属辨析"）。
 */
export function createAsyncTaskSystem(
  clawDir: string,
  fs: FileSystem,
  options: AsyncTaskSystemOptions,
): AsyncTaskSystem {
  return new AsyncTaskSystem(clawDir, fs, options);
}
