/**
 * @module L4.SpawnSystem.AuditEvents
 * spawn-system 审计事件常量 / Phase X 暂空 / Phase Y 加 sync 路径事件。
 *
 * 注：现有 spawn 工具经 writePendingSubagentTaskFile 内 TASK_AUDIT_EVENTS.TASK_SCHEDULED 落 audit /
 * 该 const 仍归 async-task-system own / spawn-system 不重复定义。
 */

export const SPAWN_AUDIT_EVENTS = {
  SYNC_STARTED: 'spawn_sync_started',
  SYNC_FINISHED: 'spawn_sync_finished',
  SYNC_FAILED: 'spawn_sync_failed',
} as const;
