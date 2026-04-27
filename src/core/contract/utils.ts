/**
 * @module L4.ContractUtils
 * @layer L4 业务层（Contract 工具函数）
 * @depends L1.FileSystem
 * @consumers L6a.Watchdog, L6b.ChatViewport
 * @contract design/modules/l4_contract_system.md
 *
 * Contract directory inspection utilities (read-only).
 */

import * as fs from 'fs';
import * as path from 'path';

/** 返回当前活跃/暂停契约的创建时间（毫秒），无契约时返回 null */
export function getContractCreatedMs(clawDir: string): number | null {
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(
        path.join(clawDir, 'contract', sub),
        { withFileTypes: true },
      );
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const ts = parseInt(e.name.split('-')[0], 10);
        // 合理的毫秒时间戳：> 2020-01-01
        if (!isNaN(ts) && ts > 1_577_836_800_000) return ts;
      }
    } catch { /* 目录不存在 */ }
  }
  return null;
}
