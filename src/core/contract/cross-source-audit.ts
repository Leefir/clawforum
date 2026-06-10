/**
 * progress.json ↔ contract.yaml ↔ progress 业务语义跨源一致性 audit。
 *
 * 应然 anchor（per design/modules/l4_contract_system.md §「persist-state observability」、phase 233 Step B）：
 * - DP5 凭日志记录完整重建：progress + yaml + audit 应等价、本审计把跨源契约抬到运行期
 * - DP1 信息不丢失：业务语义违反 = 状态信息被静默改写、违 DP1
 * - DP3 状态可观察：6 check 各显式 audit
 *
 * 6 check 维度（互独立、各 emit 各的）：
 * 1. CS-1: status='completed' ⇒ ∀ subtask.status='completed'
 * 2. CS-2: status='running' ⇒ ∃ subtask.status ∈ {'todo', 'in_progress'}
 * 3. CS-3: subtask.force_accepted=true ⇒ subtask.status='completed'
 * 4. CS-4: subtask.completed_at ⇒ subtask.status='completed'
 * 5. yaml-dep-1: progress.contract_id === yaml.id (when yaml.id provided)
 * 6. yaml-dep-2: progress.subtasks ids === yaml.subtasks ids (集合相等)
 *
 * 不 throw（DP1 防 break saveProgress prod 路径、Path #4）。
 */

import type { AuditLog } from '../../foundation/audit/index.js';
import type { ProgressData, ContractYaml } from './types.js';
import { CONTRACT_AUDIT_EVENTS } from './audit-events.js';

export function auditProgressCrossSource(
  progress: ProgressData,
  yaml: ContractYaml | null,
  audit: AuditLog,
): void {
  // status ↔ subtasks 4 check（不依赖 yaml、独立跑）
  checkCS1_CompletedImpliesAllSubtaskCompleted(progress, audit);
  checkCS2_RunningImpliesSomeSubtaskNotCompleted(progress, audit);
  checkCS3_ForceAcceptedImpliesCompleted(progress, audit);
  checkCS4_CompletedAtImpliesCompleted(progress, audit);

  // yaml-dependent 2 check
  if (yaml === null) {
    audit.write(
      CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_SKIPPED,
      `contract_id=${progress.contract_id}`,
      `reason=yaml_unavailable`,
    );
    return;
  }
  checkYamlIdMatch(progress, yaml, audit);
  checkYamlSubtaskIdSetEqual(progress, yaml, audit);
}

function checkCS1_CompletedImpliesAllSubtaskCompleted(p: ProgressData, audit: AuditLog): void {
  if (p.status !== 'completed') return;
  const notCompleted = Object.entries(p.subtasks).filter(
    ([, st]) => st.status !== 'completed'
  );
  if (notCompleted.length > 0) {
    audit.write(
      CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      `kind=cs1_completed_but_subtasks_not`,
      `contract_id=${p.contract_id}`,
      `not_completed_count=${notCompleted.length}`,
      `not_completed_ids=${notCompleted.map(([id]) => id).join(',')}`,
    );
  }
}

function checkCS2_RunningImpliesSomeSubtaskNotCompleted(p: ProgressData, audit: AuditLog): void {
  if (p.status !== 'running') return;
  const allCompleted = Object.values(p.subtasks).every(st => st.status === 'completed');
  if (allCompleted && Object.keys(p.subtasks).length > 0) {
    audit.write(
      CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      `kind=cs2_running_but_all_subtasks_completed`,
      `contract_id=${p.contract_id}`,
      `subtasks_total=${Object.keys(p.subtasks).length}`,
    );
  }
}

function checkCS3_ForceAcceptedImpliesCompleted(p: ProgressData, audit: AuditLog): void {
  for (const [id, st] of Object.entries(p.subtasks)) {
    if (st.force_accepted === true && st.status !== 'completed') {
      audit.write(
        CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
        `kind=cs3_force_accepted_but_not_completed`,
        `contract_id=${p.contract_id}`,
        `subtask_id=${id}`,
        `actual_status=${st.status}`,
      );
    }
  }
}

function checkCS4_CompletedAtImpliesCompleted(p: ProgressData, audit: AuditLog): void {
  for (const [id, st] of Object.entries(p.subtasks)) {
    if (st.completed_at !== undefined && st.status !== 'completed') {
      audit.write(
        CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
        `kind=cs4_completed_at_but_not_completed`,
        `contract_id=${p.contract_id}`,
        `subtask_id=${id}`,
        `actual_status=${st.status}`,
        `completed_at=${st.completed_at}`,
      );
    }
  }
}

function checkYamlIdMatch(p: ProgressData, yaml: ContractYaml, audit: AuditLog): void {
  if (!yaml || typeof yaml !== 'object') return;
  if (yaml.id !== undefined && yaml.id !== p.contract_id) {
    audit.write(
      CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      `kind=yaml_id_mismatch`,
      `progress_contract_id=${p.contract_id}`,
      `yaml_id=${yaml.id}`,
    );
  }
}

function checkYamlSubtaskIdSetEqual(p: ProgressData, yaml: ContractYaml, audit: AuditLog): void {
  if (!yaml || typeof yaml !== 'object') return;
  if (!Array.isArray(yaml.subtasks)) {
    audit.write(
      CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      `kind=yaml_subtasks_not_array`,
      `contract_id=${p.contract_id}`,
    );
    return;
  }
  const progressIds = new Set(Object.keys(p.subtasks));
  const yamlIds = new Set(yaml.subtasks.map(s => s.id));

  const onlyInProgress = [...progressIds].filter(id => !yamlIds.has(id));
  const onlyInYaml = [...yamlIds].filter(id => !progressIds.has(id));

  if (onlyInProgress.length > 0 || onlyInYaml.length > 0) {
    audit.write(
      CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      `kind=yaml_subtask_id_set_mismatch`,
      `contract_id=${p.contract_id}`,
      `only_in_progress=${onlyInProgress.join(',')}`,
      `only_in_yaml=${onlyInYaml.join(',')}`,
    );
  }
}
