/**
 * @module L2.Tools
 * ContractStatusPort — statusTool 消费 contract 状态视图的 port interface。
 * 消费方 own / 已计算 view（doneCount 等统计在 impl 端 / statusTool 不知细节）。
 */

export type ContractStatusItemStatus = 'todo' | 'in_progress' | 'completed' | 'failed';

export interface ContractStatusItem {
  id: string;
  description: string;
  status: ContractStatusItemStatus;
}

export interface ContractStatusView {
  title: string;
  doneCount: number;
  totalCount: number;
  items: ContractStatusItem[];
}

export interface ContractStatusPort {
  /** Returns null if no active contract. */
  loadStatusView(): Promise<ContractStatusView | null>;
}
