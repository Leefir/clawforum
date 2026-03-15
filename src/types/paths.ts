/**
 * Shared path constants
 * 
 * These are used across CLI and Core modules to ensure consistency.
 */

/**
 * Claw directory structure - shared between createCommand and runtime.ensureDirectories
 * Modifying this requires updating all consumers.
 */
export const CLAW_SUBDIRS = [
  'dialog',
  'dialog/archive',
  'inbox/pending',
  'inbox/done',
  'inbox/failed',
  'outbox/pending',
  'outbox/done',
  'outbox/failed',
  'tasks/pending',
  'tasks/running',
  'tasks/done',
  'tasks/results',
  'memory',
  'contract',
  'skills',
  'clawspace',
  'logs',
  'status',  // 用于 PID 文件和 STATUS.md
] as const;
