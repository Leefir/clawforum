/**
 * @module L4.ContractSystem
 * ContractStatusPort default impl — 包装 ContractSystem.loadActive +
 * 计算统计视图（业务归属 ContractSystem）。
 */

import type { ContractSystem } from './manager.js';
import type {
  ContractStatusPort,
  ContractStatusView,
} from '../../foundation/tools/builtins/status-port.js';

export function createContractStatusPort(manager: ContractSystem): ContractStatusPort {
  return {
    async loadStatusView(): Promise<ContractStatusView | null> {
      const contract = await manager.loadActive();
      if (!contract) return null;
      return {
        title: contract.title,
        doneCount: contract.subtasks.filter(s => s.status === 'completed').length,
        totalCount: contract.subtasks.length,
        items: contract.subtasks.map(s => ({
          id: s.id,
          description: s.description,
          status: s.status,
        })),
      };
    }
  };
}
