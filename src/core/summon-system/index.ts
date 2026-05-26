/**
 * @module L4.SummonSystem
 * Summon system exports
 */

export { SummonTool, SUMMON_TOOL_NAME } from './tools/summon.js';
export { AskMotionTool, ASK_MOTION_TOOL_NAME, ASK_MOTION_TOOL_DESCRIPTION, ASK_MOTION_TOOL_SCHEMA } from './tools/ask-motion.js';
export { SUMMON_AUDIT_EVENTS } from './audit-events.js';
export { summonContractExtractPostProcessor } from './post-processors/contract-extract.js';

import type { FileSystem } from '../../foundation/fs/types.js';
import { CLAWSPACE_DIR } from '../../foundation/paths.js';

/** Phase 1335 (r138 F fork): cross-module query API — pending retrospective reference */
export interface PendingRetroRef {
  contractId: string;
  targetClaw: string;
  mode?: string;
  miningTaskId?: string;
  shadowTaskId?: string;
  createdAt?: string;
}

/**
 * Phase 1335 (r138 F fork): cross-module query API — list pending retrospectives
 * ML#3 资源唯一归属：SummonSystem own pending-retrospective artifact / caller 不直访 fs
 */
export async function listPendingRetrospectives(opts: {
  fs: FileSystem;
  filter?: { contractId?: string };
}): Promise<PendingRetroRef[]> {
  const { fs, filter } = opts;
  const results: PendingRetroRef[] = [];

  const dir = `${CLAWSPACE_DIR}/pending-retrospective/by-contract`;
  if (!fs.existsSync(dir)) return results;

  for (const e of fs.listSync(dir, { includeDirs: false })) {
    if (!e.name.endsWith('.json')) continue;
    const contractId = e.name.replace(/\.json$/, '');
    if (filter?.contractId !== undefined && contractId !== filter.contractId) continue;

    try {
      const raw = fs.readSync(`${dir}/${e.name}`);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.targetClaw !== 'string') continue;
      results.push({
        contractId,
        targetClaw: parsed.targetClaw,
        mode: typeof parsed.mode === 'string' ? parsed.mode : undefined,
        miningTaskId: typeof parsed.miningTaskId === 'string' ? parsed.miningTaskId : undefined,
        shadowTaskId: typeof parsed.shadowTaskId === 'string' ? parsed.shadowTaskId : undefined,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
      });
    } catch { /* best-effort: invalid JSON skip */ }
  }

  return results;
}
