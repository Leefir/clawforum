/**
 * @module L6.Daemon
 * DAEMON_AUDIT_EVENTS — Daemon audit events const namespace（phase386 / B.p344-Z）
 */

export const DAEMON_AUDIT_EVENTS = {
  // snapshot 路径（daemon.ts）
  SNAPSHOT_COMMIT_UNCATEGORIZED: 'snapshot_commit_uncategorized',
  SNAPSHOT_COMMIT_FAILED: 'snapshot_commit_failed',
  // daemon-loop 路径
  LOOP_INTERRUPT_POLLER_DISABLED: 'daemon_loop_interrupt_poller_disabled',
  LOOP_INTERRUPT_POLLER_ERROR: 'daemon_loop_interrupt_poller_error',
  LOOP_INTERRUPT_POLLER_RECOVERED: 'daemon_loop_interrupt_poller_recovered',
  LOOP_INTERRUPT_POLLER_RECOVERY_ATTEMPT: 'daemon_loop_interrupt_poller_recovery_attempt',
  LOOP_ITERATION: 'daemon_loop_iteration',
  LOOP_INTERRUPT: 'daemon_loop_interrupt',
  LOOP_LLM_RETRY: 'daemon_loop_llm_retry',
  LOOP_FATAL: 'daemon_loop_fatal',
  LIVENESS_HEARTBEAT: 'daemon_liveness_heartbeat',
  // cleanup 路径
  CLEANUP_HEARTBEAT_FAILED: 'daemon_cleanup_heartbeat_failed',
  CLEANUP_PID_FAILED: 'daemon_cleanup_pid_failed',
} as const;

/**
 * Phase 159 业主声明 file 归属（phase 122 §5.A + §6.7）.
 *
 * daemon_liveness_heartbeat / daemon_loop_iteration → tick（高频）、
 * 其余异常 / 业务 event 留 audit（默认主 file）.
 */
export const DAEMON_FILE_ROUTING: Readonly<Record<string, 'audit' | 'tick'>> = {
  daemon_liveness_heartbeat: 'tick',
  daemon_loop_iteration: 'tick',
} as const;

export const LOOP_ITERATION_TYPES = {
  CHAIN: 'chain',
  CHAIN_LIMITED: 'chain_limited',
  WAIT: 'wait',
} as const;

export const LOOP_INTERRUPT_CAUSES = {
  IDLE_TIMEOUT: 'idle_timeout',
  USER_INTERRUPT: 'user_interrupt',
  PRIORITY_INBOX: 'priority_inbox',
} as const;
