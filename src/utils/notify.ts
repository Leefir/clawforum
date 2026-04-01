/**
 * Notification utilities - Unified notification helpers
 *
 * Standardizes error handling and formatting for inbox notifications.
 */

import { writeInboxMessage, type InboxMessageOptions } from './inbox-writer.js';
import * as fsNative from 'fs';

/**
 * Send an inbox notification with standardized error handling.
 * Logs warning on failure but does not throw.
 */
export function notifyInbox(opts: InboxMessageOptions, context?: string): void {
  try {
    writeInboxMessage(opts);
  } catch (e) {
    const prefix = context ? `[${context}] ` : '';
    console.warn(`${prefix}Failed to send inbox notification:`, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Send a system message to inbox with high priority.
 * Convenience wrapper for common system notification pattern.
 */
export function notifySystem(inboxDir: string, body: string, options?: {
  type?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  idPrefix?: string;
  filenameTag?: string;
}, context?: string): void {
  notifyInbox({
    inboxDir,
    type: options?.type ?? 'message',
    source: 'system',
    priority: options?.priority ?? 'high',
    body,
    idPrefix: options?.idPrefix,
    filenameTag: options?.filenameTag,
  }, context);
}

/**
 * Append to stream.jsonl with standardized error handling (best-effort).
 */
export function notifyStream(streamPath: string, line: string, context?: string): void {
  try {
    fsNative.appendFileSync(streamPath, line);
  } catch (e) {
    const prefix = context ? `[${context}] ` : '';
    console.warn(`${prefix}Failed to append to stream:`, e instanceof Error ? e.message : String(e));
  }
}
