/**
 * DialogStore types (L2)
 *
 * Session data structure for current.json persistence.
 */

import type { Message } from '../../types/message.js';

export interface SessionData {
  version: number;
  clawId?: string;          // phase 450: 可选 / subagent ephemeral 用例 0 clawId
  createdAt: string;
  updatedAt: string;
  systemPrompt: string;     // phase 466: 必字段 / 与 instance.systemPrompt 同 / writeAtomic 时同步落盘
  messages: Message[];
}

export interface LoadResult {
  session: SessionData;
  source: 'current' | 'archive' | 'empty';
}

/** phase 466: marker 模式 ask_caller 工具用 */
export interface DialogMarker {
  clawId: string;
  toolUseId: string;
}

/** phase 466: restorePrefix 返完整前缀 */
export interface RestoreResult {
  messages: Message[];                              // marker 时刻 messages 切片（含 marker 那条 assistant message）
  systemPrompt: string;                             // 该 SessionData 的 systemPrompt（regime lifetime 锁定值）
  meta: { foundIn: 'current' | 'archive'; foundFile?: string };
}
