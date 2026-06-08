/**
 * @module Assembly.GuidanceComposers
 * phase 63 γ NEW: contract_cancelled real composer
 * phase 190: 删 null 旁路、扩 batch 路径（observer 投 extraFields.cancellations）
 *
 * 触发：cancelContract 走 safeNotify 路径（motion 自家 cancel 自家 contract 实时）
 *      或 contract-observer cron 扫 worker archive 发现 cancelled contract
 *
 * 设计原则（Philosophy「系统为智能体服务、提供基础设施和必要信息」）：
 * - 事实 + 系统已尝试 + 相关基础设施
 * - 0 prescription（无「建议」「推荐」「应该」「按优先级」字面）
 * - motion 自决用哪条基础设施处理
 */

import type { GuidanceComposer, GuidanceEntry } from '../types.js';

interface ContractCancelledState {
  source_claw?: string;
  contract_id?: string;
  reason?: string;
  cancellations?: string; // JSON-encoded array (observer 路径)
}

interface CancellationEntry {
  source_claw: string;
  contract_id: string;
  reason: string;
}

const SYSTEM_DID = [
  `  - lockContract source dir`,
  `  - saveProgress(status='cancelled', checkpoint='cancelled: <reason>')`,
  `  - abortContractVerifiers (best-effort)`,
  `  - move source → archive`,
  `  - emit CONTRACT_CANCELLED audit`,
];

const INFRASTRUCTURE = [
  `  CLI:        chestnut contract [list|cancel]`,
  `  agent 工具: exec, ask_user, send, summon, notify_claw`,
  `  文件系统:   archive 下的 contract 目录可 read/inspect、含 progress.json + contract.yaml`,
];

const MAX_BATCH_RENDER = 10;

export const composer: GuidanceComposer<ContractCancelledState> = (state): GuidanceEntry => {
  const entries = parseEntries(state);
  if (entries.length === 0) {
    // 既无 single entry 又无 batch、仍出 guidance（旁路删后底线：至少投 system已做 + 基础设施 hint）
    return { text: renderBatch([{ source_claw: '(unknown)', contract_id: '(unknown)', reason: '(unknown)' }]) };
  }
  return { text: renderBatch(entries) };
};

function parseEntries(state: ContractCancelledState): CancellationEntry[] {
  // batch 路径优先
  if (state.cancellations) {
    try {
      const parsed = JSON.parse(state.cancellations) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((e): e is CancellationEntry =>
            typeof e === 'object' && e !== null &&
            typeof (e as Record<string, unknown>).source_claw === 'string' &&
            typeof (e as Record<string, unknown>).contract_id === 'string' &&
            typeof (e as Record<string, unknown>).reason === 'string'
          );
      }
    } catch {
      // silent: JSON parse failure handled by fallback to single-entry path below
    }
  }
  // single entry 路径（safeNotify）
  if (state.contract_id) {
    return [{
      source_claw: state.source_claw ?? '(unknown)',
      contract_id: state.contract_id,
      reason: state.reason ?? '(no reason given)',
    }];
  }
  return [];
}

function renderBatch(entries: CancellationEntry[]): string {
  const lines: string[] = [`[contract_cancelled]`, ``];
  const displayCount = Math.min(entries.length, MAX_BATCH_RENDER);
  if (entries.length > MAX_BATCH_RENDER) {
    lines.push(`(${entries.length} cancellations、显示前 ${MAX_BATCH_RENDER})`, ``);
  }
  lines.push(`事实:`);
  for (const e of entries.slice(0, displayCount)) {
    lines.push(`  - source_claw: ${e.source_claw}`);
    lines.push(`    contract_id: ${e.contract_id}`);
    lines.push(`    reason:      ${e.reason}`);
  }
  lines.push(``, `系统已做（per cancellation）:`);
  lines.push(...SYSTEM_DID);
  lines.push(``, `相关基础设施:`);
  lines.push(...INFRASTRUCTURE);
  return lines.join('\n');
}
