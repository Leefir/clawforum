/**
 * Phase 148 结构化事件通道 — L2 审计事件常量
 *
 * 命名规范：<module>_<action>_<outcome>
 * outcome 语义：ok / failed / dropped / degraded / corrupted / recovered
 * 详见 coding plan/phase148/Phase 148 Step 1 决策文档.md § Q4
 */

export const AUDIT_EVENTS = {
  // --- AuditLog 自身 ---
  // AuditWriter.write 失败不进 audit 流（递归边界，console.error 兜底）
  // 此处仅占位备忘，不导出事件名

  // --- SessionStore ---
  SESSION_LOAD_FAILED: 'session_load_failed',
  SESSION_SAVE_FAILED: 'session_save_failed',
  SESSION_CORRUPTED: 'session_corrupted',
  SESSION_CORRUPTED_ISOLATE_FAILED: 'session_corrupted_isolate_failed',
  SESSION_RECOVERED: 'session_recovered',
  SESSION_ARCHIVE_FAILED: 'session_archive_failed',
  SESSION_ARCHIVE_READ_FAILED: 'session_archive_read_failed',

  // --- Snapshot ---
  SNAPSHOT_INIT_FAILED: 'snapshot_init_failed',
  SNAPSHOT_INIT_CLEANUP_FAILED: 'snapshot_init_cleanup_failed',
  SNAPSHOT_COMMIT_FAILED: 'snapshot_commit_failed',
  SNAPSHOT_COMMITTED: 'snapshot_committed',
  SNAPSHOT_DEGRADED: 'snapshot_degraded',

  // --- FileWatcher ---
  WATCHER_CALLBACK_FAILED: 'watcher_callback_failed',
  WATCHER_READY_FAILED: 'watcher_ready_failed',
  WATCHER_ERROR: 'watcher_error',

  // --- Stream ---
  STREAM_WRITE_DROPPED: 'stream_write_dropped',
  STREAM_APPEND_FAILED: 'stream_append_failed',
  STREAM_ARCHIVE_FAILED: 'stream_archive_failed',
  STREAM_ARCHIVE_PRUNE_FAILED: 'stream_archive_prune_failed',
  STREAM_READER_CALLBACK_FAILED: 'stream_reader_callback_failed',
  STREAM_READER_PARSE_FAILED: 'stream_reader_parse_failed',
  STREAM_READER_READ_FAILED: 'stream_reader_read_failed',
  STREAM_READER_UNLINKED: 'stream_reader_unlinked',
  STREAM_READER_WATCHER_FAILED: 'stream_reader_watcher_failed',

  // --- Messaging ---
  INBOX_DONE: 'inbox_done',
  INBOX_FAILED: 'inbox_failed',
  INBOX_LIST_FAILED: 'inbox_list_failed',
  INBOX_MOVE_FAILED: 'inbox_move_failed',
  OUTBOX_SENT: 'outbox_sent',
  OUTBOX_SEND_FAILED: 'outbox_send_failed',

  // --- ProcessManager ---（Step 8 追加）
  // --- FileWatcher ---（Step 5 追加）
  // --- Stream ---（Step 6 追加）
  // --- Messaging ---（Step 7 追加）
  // --- ProcessManager ---（Step 8 追加）
} as const;

export type AuditEventName = typeof AUDIT_EVENTS[keyof typeof AUDIT_EVENTS];
