// src/core/evolution-system/invariants.ts

/**
 * evolution-system state.json save 入口 schema invariant。
 *
 * 应然 anchor（per design/modules/l4_evolution_system.md §「persist-state observability」、phase 253 Step A）：
 * - DP1 信息不丢失：state.json 是 evolution 累进权威进度
 * - DP2 不静默丢弃：违例 emit audit 消除静默
 * - DP3/DP5 状态可观察 + 凭日志记录重建：违例显式可观察
 *
 * 与 `_loadState` load 端 check 对称：load 端违例 `_backupCorruptState` isolate + emit STATE_LOAD_FAILED、
 * save 端只 emit invariant_violated audit、不 isolate 文件（Path #4 防 break _saveState 业务路径）。
 *
 * 4 sub-check：
 * - version: number === 1 (current schema_version)
 * - processedContractIds: string[]
 * - lastProcessedAt: ISO 8601 timestamp 形态
 * - processedContractIds duplicate detection（防 raw inspection / 旧版本 state 含 dup）
 *
 * 不 throw（DP1 + Path #4 防 break _saveState 路径）。
 */

import type { AuditLog } from '../../foundation/audit/index.js';
import { RETRO_AUDIT_EVENTS } from './retro-audit-events.js';

// NOTE: 改 schema version 时同步 system.ts:164 字面量
const EVOLUTION_STATE_CURRENT_VERSION = 1;
const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function assertEvolutionStateShape(state: unknown, audit: AuditLog): void {
  if (typeof state !== 'object' || state === null) {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=state_not_object`, `actual=${typeof state}`,
    );
    return;
  }
  const s = state as Record<string, unknown>;

  checkVersion(s, audit);
  checkProcessedContractIds(s, audit);
  checkLastProcessedAt(s, audit);
}

function checkVersion(s: Record<string, unknown>, audit: AuditLog): void {
  if (typeof s.version !== 'number') {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=version_not_number`, `actual=${typeof s.version}`,
    );
  } else if (s.version !== EVOLUTION_STATE_CURRENT_VERSION) {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=version_mismatch`, `actual=${s.version}`, `expected=${EVOLUTION_STATE_CURRENT_VERSION}`,
    );
  }
}

function checkProcessedContractIds(s: Record<string, unknown>, audit: AuditLog): void {
  if (!Array.isArray(s.processedContractIds)) {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=processedContractIds_not_array`, `actual=${typeof s.processedContractIds}`,
    );
    return;
  }
  const nonStrIdx = s.processedContractIds.findIndex(x => typeof x !== 'string');
  if (nonStrIdx >= 0) {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=processedContractIds_element_not_string`,
      `idx=${nonStrIdx}`, `actual=${typeof s.processedContractIds[nonStrIdx]}`,
    );
  }
  // duplicate detection
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const id of s.processedContractIds) {
    if (typeof id !== 'string') continue;
    if (seen.has(id)) dups.push(id); else seen.add(id);
  }
  if (dups.length > 0) {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=processedContractIds_duplicate`,
      `dup_ids=${dups.slice(0, 5).join(',')}`, `dup_count=${dups.length}`,
    );
  }
}

function checkLastProcessedAt(s: Record<string, unknown>, audit: AuditLog): void {
  if (typeof s.lastProcessedAt !== 'string') {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=lastProcessedAt_not_string`, `actual=${typeof s.lastProcessedAt}`,
    );
    return;
  }
  if (!ISO_TIMESTAMP_REGEX.test(s.lastProcessedAt)) {
    audit.write(
      RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
      `kind=lastProcessedAt_not_iso`, `actual=${s.lastProcessedAt}`,
    );
  }
}
