/**
 * @module L6.Assembly.ClawSubdirs
 * claw 实例化 mkdir 子目录列表（L6 装配期决策）。
 *
 * phase 69 自 foundation/paths.ts 整迁 → L6 Assembly own、解 L1 持业务漏抽象 +
 * 解 L11 messaging 反向 import（L1 paths → L2c messaging）。
 *
 * list 整体 own = L6 Assembly（装配期决定「claw 实例化时 mkdir 哪些子目录」）。
 * list 内 25 entry 业务来源分散（L2b/L2c/L4/L5/L6）— phase 70+ 各模块自报后
 * Assembly collect union（α 真治本）；phase 69 仅整迁 list 形式（β 过渡）。
 *
 * cluster L1-L4 去 claw 化 / paths.ts 解散第二步、详
 * `coding plan/cluster-claw-decoupling-roadmap.md`。
 */

import { INBOX_PENDING_DIR, INBOX_DONE_DIR, INBOX_FAILED_DIR, OUTBOX_PENDING_DIR } from '../foundation/messaging/index.js';
import { CLAWSPACE_DIR } from './claw-dirs.js';

export const CLAW_SUBDIRS = [
  // L2b DialogStore
  'dialog',
  'dialog/archive',
  // L2c Messaging
  INBOX_PENDING_DIR,
  INBOX_DONE_DIR,
  INBOX_FAILED_DIR,
  OUTBOX_PENDING_DIR,
  'outbox/done',
  'outbox/failed',
  // L4 AsyncTaskSystem
  'tasks/queues/pending',
  'tasks/queues/running',
  'tasks/queues/done',
  'tasks/queues/failed',
  'tasks/queues/results',
  // L6 Assembly admit (per l4_async_task_system.md §3「不含 tasks/sync/、装配方 own」)
  'tasks/sync/exec',
  'tasks/sync/write',
  'tasks/sync/search',
  'tasks/sync/subagent',
  'tasks/sync/spawn',
  'tasks/sync/shadow',
  'tasks/subagents',
  // L4 MemorySystem
  'memory',
  // L4 ContractSystem
  'contract',
  // L2c SkillSystem
  'skills',
  // L6 Assembly
  CLAWSPACE_DIR,
  // L2a AuditLog / L6 Assembly
  'logs',
  // L5 StatusService
  'status',
] as const;
