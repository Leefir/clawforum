/**
 * @module L2.Messaging.AuditEmit
 * Typed audit emit functions for messaging module (phase 1163 r128 E fork β-2,
 * phase 1210 cascade closure inbox-writer/reader).
 *
 * Per-event typed payload enforces phase 706 audit key naming decision tree
 * (camelCase typed col + business ID typed). Mirror phase 1127 snapshot/audit-emit.ts
 * + phase 1130 async-task-system + phase 1141 contract per-module typed emit cascade.
 */

import type { AuditLog } from '../audit/index.js';
import { MESSAGING_AUDIT_EVENTS } from './audit-events.js';

// ─── INBOX_WRITTEN ────────────────────────────────────────────────────────────
export function emitInboxWritten(
  audit: AuditLog,
  opts: { file: string; to?: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_WRITTEN, `file=${opts.file}`, `to=${opts.to ?? 'broadcast'}`);
}

// ─── INBOX_WRITE_FAILED ───────────────────────────────────────────────────────
export function emitInboxWriteFailed(
  audit: AuditLog,
  opts: { file: string; to?: string; reason: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_WRITE_FAILED, `file=${opts.file}`, `to=${opts.to ?? 'broadcast'}`, `reason=${opts.reason}`);
}

// ─── INBOX_LIST_FAILED ────────────────────────────────────────────────────────
export function emitInboxListFailed(
  audit: AuditLog,
  opts: { dir: string; op?: string; errorCode?: string; reason: string },
): void {
  const cols: string[] = [`dir=${opts.dir}`];
  if (opts.op !== undefined) cols.push(`op=${opts.op}`);
  if (opts.errorCode !== undefined) cols.push(`error_code=${opts.errorCode}`);
  cols.push(`reason=${opts.reason}`);
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_LIST_FAILED, ...cols);
}

// ─── INBOX_FAILED ─────────────────────────────────────────────────────────────
export function emitInboxFailed(
  audit: AuditLog,
  opts: { file: string; errorCode?: string; reason: string },
): void {
  const cols: string[] = [`file=${opts.file}`];
  if (opts.errorCode !== undefined) cols.push(`error_code=${opts.errorCode}`);
  cols.push(`reason=${opts.reason}`);
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_FAILED, ...cols);
}

// ─── INBOX_PRIORITY_UNKNOWN ───────────────────────────────────────────────────
export function emitInboxPriorityUnknown(
  audit: AuditLog,
  opts: { file: string; original: string; fallback: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_PRIORITY_UNKNOWN, `file=${opts.file}`, `original=${opts.original}`, `fallback=${opts.fallback}`);
}

// ─── INBOX_LEGACY_CLAW_ID_FIELD ───────────────────────────────────────────────
export function emitInboxLegacyClawIdField(
  audit: AuditLog,
  opts: { file: string; clawId: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_LEGACY_CLAW_ID_FIELD, `file=${opts.file}`, `claw_id=${opts.clawId}`);
}

// ─── INBOX_DEDUPED ────────────────────────────────────────────────────────────
export function emitInboxDeduped(
  audit: AuditLog,
  opts: { file: string; taskId: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_DEDUPED, `file=${opts.file}`, `taskId=${opts.taskId}`);
}

// ─── INBOX_MARK_DONE_FAILED ───────────────────────────────────────────────────
export function emitInboxMarkDoneFailed(
  audit: AuditLog,
  opts: { reason: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_MARK_DONE_FAILED, `reason=${opts.reason}`);
}

// ─── INBOX_DONE ───────────────────────────────────────────────────────────────
export function emitInboxDone(
  audit: AuditLog,
  opts: { file: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_DONE, `file=${opts.file}`);
}

// ─── OUTBOX_DELIVERED ─────────────────────────────────────────────────────────
export function emitOutboxDelivered(
  audit: AuditLog,
  opts: { file: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.OUTBOX_DELIVERED, `file=${opts.file}`);
}

// ─── INBOX_MOVE_FAILED ────────────────────────────────────────────────────────
export function emitInboxMoveFailed(
  audit: AuditLog,
  opts: { file: string; op: string; errorCode?: string; reason: string },
): void {
  const cols: string[] = [`file=${opts.file}`, `op=${opts.op}`];
  if (opts.errorCode !== undefined) cols.push(`error_code=${opts.errorCode}`);
  cols.push(`reason=${opts.reason}`);
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_MOVE_FAILED, ...cols);
}

// ─── INBOX_PEEK_RACE_SKIP ─────────────────────────────────────────────────────
export function emitInboxPeekRaceSkip(
  audit: AuditLog,
  opts: { file: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_PEEK_RACE_SKIP, `file=${opts.file}`);
}

// ─── INBOX_META_FAILED ────────────────────────────────────────────────────────
export function emitInboxMetaFailed(
  audit: AuditLog,
  opts: { file: string; kind: string },
): void {
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_META_FAILED, `file=${opts.file}`, `kind=${opts.kind}`);
}

// ─── INBOX_RECONCILE ──────────────────────────────────────────────────────────
export function emitInboxReconcile(
  audit: AuditLog,
  opts: { revertedCount: number; from: string; to: string; reason: string },
): void {
  audit.write(
    MESSAGING_AUDIT_EVENTS.INBOX_RECONCILE,
    `reverted_count=${opts.revertedCount}`,
    `from=${opts.from}`,
    `to=${opts.to}`,
    `reason=${opts.reason}`,
  );
}

// ─── INBOX_NACK ───────────────────────────────────────────────────────────────
export function emitInboxNack(
  audit: AuditLog,
  opts: { file: string; reason?: string },
): void {
  const cols: string[] = [`file=${opts.file}`];
  if (opts.reason !== undefined) cols.push(`reason=${opts.reason}`);
  audit.write(MESSAGING_AUDIT_EVENTS.INBOX_NACK, ...cols);
}

// ─── OUTBOX_SENT ──────────────────────────────────────────────────────────────
export function emitOutboxSent(
  audit: AuditLog,
  opts: {
    from: string;
    to: string;
    type: string;
    id: string;
    contractId?: string;
  },
): void {
  const cols: string[] = [
    `from=${opts.from}`,
    `to=${opts.to}`,
    `type=${opts.type}`,
    `id=${opts.id}`,
  ];
  if (opts.contractId !== undefined) cols.push(`contractId=${opts.contractId}`);
  audit.write(MESSAGING_AUDIT_EVENTS.OUTBOX_SENT, ...cols);
}

// ─── OUTBOX_SEND_FAILED ───────────────────────────────────────────────────────
export function emitOutboxSendFailed(
  audit: AuditLog,
  opts: {
    from: string;
    to: string;
    type: string;
    id: string;
    reason: string;
  },
): void {
  audit.write(
    MESSAGING_AUDIT_EVENTS.OUTBOX_SEND_FAILED,
    `from=${opts.from}`,
    `to=${opts.to}`,
    `type=${opts.type}`,
    `id=${opts.id}`,
    `reason=${opts.reason}`,
  );
}
