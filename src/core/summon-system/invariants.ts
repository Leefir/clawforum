// src/core/summon-system/invariants.ts

/**
 * summon-system state.json save 入口 schema invariant。
 *
 * 应然 anchor（per design/modules/l4_summon_system.md §「persist-state observability」、phase 253 Step A mirror）：
 * - DP1 信息不丢失：summon-state/<taskId>.json 是 summon 决策权威进度
 * - DP2 不静默丢弃：违例 emit audit 消除静默
 * - DP3/DP5 状态可观察 + 凭日志记录重建：违例显式可观察
 *
 * 与 `createSummonStateStore.read` load 端 check 对称：load 端违例 emit audit、
 * 不 throw（Path #4 防 break read 业务路径）。
 *
 * legacy v0 兼容：schema_version === undefined 时 emit LEGACY_V0_MIGRATED、accept。
 */

import type { AuditLog } from '../../foundation/audit/index.js';
import { SUMMON_AUDIT_EVENTS } from './audit-events.js';

const SUMMON_STATE_CURRENT_VERSION = 1;
const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function assertSummonDecisionShape(data: unknown, audit?: AuditLog): void {
  if (typeof data !== 'object' || data === null) {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=not_object`, `actual=${typeof data}`,
    );
    return;
  }
  const d = data as Record<string, unknown>;

  checkSchemaVersion(d, audit);
  checkRequiredFields(d, audit);
}

function checkSchemaVersion(d: Record<string, unknown>, audit?: AuditLog): void {
  if (d.schema_version === undefined) {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_LEGACY_V0_MIGRATED,
      `kind=legacy_v0_detected`,
    );
    return;
  }
  if (typeof d.schema_version !== 'number') {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=schema_version_not_number`, `actual=${typeof d.schema_version}`,
    );
    return;
  }
  if (d.schema_version !== SUMMON_STATE_CURRENT_VERSION) {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=schema_version_mismatch`, `actual=${d.schema_version}`, `expected=${SUMMON_STATE_CURRENT_VERSION}`,
    );
  }
}

function checkRequiredFields(d: Record<string, unknown>, audit?: AuditLog): void {
  if (typeof d.taskId !== 'string') {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=taskId_not_string`, `actual=${typeof d.taskId}`,
    );
  }
  if (typeof d.verify !== 'boolean') {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=verify_not_boolean`, `actual=${typeof d.verify}`,
    );
  }
  if (d.targetClaw !== undefined && typeof d.targetClaw !== 'string') {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=targetClaw_not_string`, `actual=${typeof d.targetClaw}`,
    );
  }
  if (d.mode !== 'shadow' && d.mode !== 'mining') {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=mode_invalid`, `actual=${String(d.mode)}`,
    );
  }
  if (typeof d.dispatchedAt !== 'string') {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=dispatchedAt_not_string`, `actual=${typeof d.dispatchedAt}`,
    );
    return;
  }
  if (!ISO_TIMESTAMP_REGEX.test(d.dispatchedAt)) {
    audit?.write(
      SUMMON_AUDIT_EVENTS.SUMMON_STATE_INVARIANT_VIOLATED,
      `kind=dispatchedAt_not_iso`, `actual=${d.dispatchedAt}`,
    );
  }
}
