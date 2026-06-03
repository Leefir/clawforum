/**
 * Cron module audit event names (runner + jobs).
 *
 * Module-owned event namespace per H1 design (phase345 / B.p336-1 治理).
 * 字符串值与起步态等价 / 0 漂移。
 *
 * 多子资源（runner + jobs / llm_stats + disk_monitor）保留 prefix。
 */
export const CRON_AUDIT_EVENTS = {
  RUNNER_STARTED: 'cron_runner_started',
  RUNNER_STOPPED: 'cron_runner_stopped',
  LLM_STATS: 'cron_llm_stats',
  DISK_MONITOR_CHECK: 'cron_disk_monitor_check',
  DISK_MONITOR_THRESHOLD_EXCEEDED: 'cron_disk_monitor_threshold_exceeded',
  METRICS_SNAPSHOT: 'cron_metrics_snapshot',
  GIT_GC_WEEKLY: 'cron_git_gc_weekly',
  PARSE_INVALID: 'cron_parse_invalid',
  PARSE_FALLBACK: 'cron_parse_fallback',
  JOB_ERROR: 'cron_job_error',
  JOB_STARTED: 'cron_job_started',        // NEW phase1108: tick dispatch
  HANDLER_TIMEOUT: 'cron_handler_timeout',
  HANDLER_ABORTED: 'cron_handler_aborted',  // NEW phase 1232 r132 C
  HANDLER_STUCK: 'cron_handler_stuck',
  JOB_LATE_SETTLED: 'cron_job_late_settled',  // NEW phase 758
  RUNNER_DRAIN_TIMEOUT: 'cron_drain_timeout',   // phase 793 (P0.22): stop drain cap timeout
  RUNNER_DRAIN_LATE_SETTLE: 'cron_drain_late_settle',  // NEW phase 867 (r111 E fork): post-drain late settle observability
  RETENTION_CLEANUP: 'cron_retention_cleanup',          // NEW phase 1053 β-1: retention cleanup cron
  AUDIT_SIZE_THRESHOLD_EXCEEDED: 'cron_audit_size_threshold_exceeded',     // NEW phase 1154 α-3b
  AUDIT_SIZE_CHECK_FAILED: 'cron_audit_size_check_failed',                 // NEW phase 1154 α-3b
  // phase 1476: OUTBOX_DRAIN_* (4 const) 砍 — outbox-drain cron 退场（pull 模型替 push）
  OUTBOX_SUMMARY_WRITTEN: 'cron_outbox_summary_written',                   // NEW phase 1476
  OUTBOX_SUMMARY_SKIPPED: 'cron_outbox_summary_skipped',                   // NEW phase 1476 (dedup hit)
  OUTBOX_SUMMARY_CLEARED: 'cron_outbox_summary_cleared',                   // NEW phase 1476 (0 unread → archive 旧 pending summary mv→done / 不 delete / DP 不丢弃)
  OUTBOX_SUMMARY_FAILED: 'cron_outbox_summary_failed',                     // NEW phase 1476 (tick handler throw)
  STATE_SAVE_FAILED: 'cron_state_save_failed',                             // NEW phase 1210
  // phase 6: SUNSET_READY / SUNSET_QUERY_FAIL 砍 — sunset-monitor cron 移除 / dev-side 信号不该走 motion inbox
} as const;
