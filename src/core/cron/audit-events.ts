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
  // phase 1476: OUTBOX_DRAIN_* (4 const) 砍 — outbox-drain cron 退场（pull 模型替 push）
  // phase 134: outbox-summary 4 events 迁出到自治 helper audit-events 命名空间
  // phase 28: STATE_SAVE_FAILED 砍 — phase1109 state persistence wiring 删（fs? optional 实际从未 wire 进 production）
  // phase 6: SUNSET_READY / SUNSET_QUERY_FAIL 砍 — sunset-monitor cron 移除 / dev-side 信号不该走 motion inbox
} as const;
