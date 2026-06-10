/**
 * async-task pending↔running 双源（内存 ↔ 磁盘）cross-source 一致性 audit。
 *
 * 应然 anchor（per design/modules/l4_async_task_system.md §「persist-state observability」、phase 239）：
 * - DP1 信息不丢失：双源不一致 = task 状态丢
 * - DP3 状态可观察：4 check 各显式 audit
 * - DP4 中断恢复：磁盘是权威、内存是 derived view、boot recover 路径依赖一致性
 * - DP5 凭日志记录重建：双源契约抬到运行期
 * - M#4 持久化一切到磁盘：磁盘是 truth source、内存与之不一致 = derived view 漂
 *
 * 4 check 维度（互独立、各 emit）：
 * - QC-1: set(pendingQueue ids) === set(pending dir files)
 * - QC-2: set(runningTasks keys) === set(running dir files)
 * - QC-3: pendingQueue ∩ runningTasks = ∅
 * - QC-4: cancellingIds ⊆ (pendingQueue ∪ runningTasks)
 *
 * 不 throw（DP1 + Path #4 防 break dispatch / ingest 主路径）。
 * fs list 失败 → emit _skipped + 跳磁盘相关 check（QC-1/QC-2）、内存 check（QC-3/QC-4）仍跑。
 */

import type { AuditLog } from '../../foundation/audit/index.js';
import type { FileSystem } from '../../foundation/fs/types.js';
import { formatErr } from '../../foundation/utils/index.js';
import { TASKS_QUEUES_PENDING_DIR, TASKS_QUEUES_RUNNING_DIR } from './dirs.js';
import { TASK_AUDIT_EVENTS } from './audit-events.js';

export interface QueueSnapshot {
  readonly pendingMemoryIds: ReadonlySet<string>;
  readonly runningMemoryIds: ReadonlySet<string>;
  readonly cancellingIds: ReadonlySet<string>;
}

export async function auditQueueCrossSource(
  snapshot: QueueSnapshot,
  fs: FileSystem,
  audit: AuditLog,
  traceTag: string,
): Promise<void> {
  // QC-3/QC-4 在内存层、独立跑、不依赖 fs
  checkQC3_PendingRunningDisjoint(snapshot, audit, traceTag);
  checkQC4_CancellingSubsetOfActive(snapshot, audit, traceTag);

  // QC-1/QC-2 依赖 fs list、降级路径走 _skipped
  let pendingDiskIds: Set<string>;
  let runningDiskIds: Set<string>;
  try {
    pendingDiskIds = await listTaskIdsInDir(fs, TASKS_QUEUES_PENDING_DIR);
    runningDiskIds = await listTaskIdsInDir(fs, TASKS_QUEUES_RUNNING_DIR);
  } catch (err) {
    audit.write(
      TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_SKIPPED,
      `reason=fs_list_failed`,
      `error=${formatErr(err)}`,
      `trace=${traceTag}`,
    );
    return;
  }

  checkQC1_PendingMemoryEqDisk(snapshot, pendingDiskIds, audit, traceTag);
  checkQC2_RunningMemoryEqDisk(snapshot, runningDiskIds, audit, traceTag);
}

async function listTaskIdsInDir(fs: FileSystem, dir: string): Promise<Set<string>> {
  const exists = await fs.exists(dir);
  if (!exists) return new Set();
  const entries = await fs.list(dir, { includeDirs: false });
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.name.endsWith('.json')) ids.add(e.name.slice(0, -5));
  }
  return ids;
}

function checkQC1_PendingMemoryEqDisk(
  s: QueueSnapshot, disk: Set<string>, audit: AuditLog, trace: string,
): void {
  const onlyMemory = [...s.pendingMemoryIds].filter(id => !disk.has(id));
  const onlyDisk = [...disk].filter(id => !s.pendingMemoryIds.has(id));
  if (onlyMemory.length === 0 && onlyDisk.length === 0) return;
  audit.write(
    TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH,
    `kind=qc1_pending_memory_ne_disk`,
    `only_memory=${onlyMemory.slice(0, 5).join(',')}`,
    `only_disk=${onlyDisk.slice(0, 5).join(',')}`,
    `memory_count=${s.pendingMemoryIds.size}`,
    `disk_count=${disk.size}`,
    `trace=${trace}`,
  );
}

function checkQC2_RunningMemoryEqDisk(
  s: QueueSnapshot, disk: Set<string>, audit: AuditLog, trace: string,
): void {
  const onlyMemory = [...s.runningMemoryIds].filter(id => !disk.has(id));
  const onlyDisk = [...disk].filter(id => !s.runningMemoryIds.has(id));
  if (onlyMemory.length === 0 && onlyDisk.length === 0) return;
  audit.write(
    TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH,
    `kind=qc2_running_memory_ne_disk`,
    `only_memory=${onlyMemory.slice(0, 5).join(',')}`,
    `only_disk=${onlyDisk.slice(0, 5).join(',')}`,
    `memory_count=${s.runningMemoryIds.size}`,
    `disk_count=${disk.size}`,
    `trace=${trace}`,
  );
}

function checkQC3_PendingRunningDisjoint(s: QueueSnapshot, audit: AuditLog, trace: string): void {
  const overlap = [...s.pendingMemoryIds].filter(id => s.runningMemoryIds.has(id));
  if (overlap.length === 0) return;
  audit.write(
    TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH,
    `kind=qc3_pending_running_overlap`,
    `overlap_ids=${overlap.slice(0, 5).join(',')}`,
    `overlap_count=${overlap.length}`,
    `trace=${trace}`,
  );
}

function checkQC4_CancellingSubsetOfActive(s: QueueSnapshot, audit: AuditLog, trace: string): void {
  const active = new Set([...s.pendingMemoryIds, ...s.runningMemoryIds]);
  const orphan = [...s.cancellingIds].filter(id => !active.has(id));
  if (orphan.length === 0) return;
  audit.write(
    TASK_AUDIT_EVENTS.ASYNC_TASK_QUEUE_CROSS_SOURCE_MISMATCH,
    `kind=qc4_cancelling_orphan`,
    `orphan_ids=${orphan.slice(0, 5).join(',')}`,
    `orphan_count=${orphan.length}`,
    `trace=${trace}`,
  );
}
