/**
 * Notification utilities - Unified notification helpers
 *
 * Standardizes error handling and formatting for inbox notifications.
 */

import { InboxWriter } from './inbox-writer.js';
import type { InboxMessageOptionsBase } from './inbox-writer.js';
import type { FileSystem } from '../fs/types.js';
import type { AuditLog } from '../audit/index.js';

/**
 * Send an inbox notification with standardized error handling.
 * Logs warning on failure but does not throw.
 */
export function notifyInbox(
  fs: FileSystem,
  opts: InboxMessageOptionsBase & { inboxDir: string },
  audit: AuditLog,
): void {
  try {
    const { inboxDir, ...rest } = opts;
    new InboxWriter(fs, inboxDir, audit).writeSync(rest);
  } catch {
    // InboxWriter.writeSync 已 audit INBOX_WRITE_FAILED
    // 此处 catch 是防 TUI raw mode 渲染污染的 best-effort barrier
    // 不 rethrow — notify 是旁路通知，失败不影响主流程
  }
}

/**
 * Send a system message to inbox with high priority.
 * Convenience wrapper for common system notification pattern.
 */
export function notifySystem(
  fs: FileSystem,
  inboxDir: string,
  body: string,
  audit: AuditLog,
  options?: {
    type?: string;
    priority?: 'critical' | 'high' | 'normal' | 'low';
    idPrefix?: string;
  },
): void {
  notifyInbox(fs, {
    inboxDir,
    type: options?.type ?? 'message',
    source: 'system',
    priority: options?.priority ?? 'high',
    body,
    idPrefix: options?.idPrefix,
  }, audit);
}


