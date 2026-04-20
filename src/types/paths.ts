/**
 * Shared path constants
 * 
 * These are used across CLI and Core modules to ensure consistency.
 */

/**
 * Claw directory structure - shared between createCommand and runtime.ensureDirectories
 * Modifying this requires updating all consumers.
 */
/** tasks/results 目录相对路径 */
export const TASKS_RESULTS_DIR = 'tasks/results';
/** tasks/pending 目录相对路径 */
export const TASKS_PENDING_DIR = 'tasks/pending';

export const CLAW_SUBDIRS = [
  'dialog',
  'dialog/archive',
  'inbox/pending',
  'inbox/done',
  'inbox/failed',
  'outbox/pending',
  'outbox/done',
  'outbox/failed',
  TASKS_PENDING_DIR,
  'tasks/running',
  'tasks/done',
  TASKS_RESULTS_DIR,
  'memory',
  'contract',
  'skills',
  'clawspace',
  'logs',
  'status',  // 用于 PID 文件
] as const;
