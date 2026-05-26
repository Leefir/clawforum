/**
 * DialogStore types (L2)
 *
 * Session data structure for current.json persistence.
 */

import type { Message, ToolDefinition } from '../llm-provider/types.js';

export interface SessionData {
  version: number;          // bump to 2 (phase 713)
  clawId?: string;          // phase 450: 可选 / subagent ephemeral 用例 0 clawId
  createdAt: string;
  updatedAt: string;
  systemPrompt: string;     // phase 713: per-turn latest snapshot
  messages: Message[];
  toolsForLLM: ToolDefinition[];  // phase 713 NEW
}

export interface LoadResult {
  session: SessionData;
  source: 'current' | 'archive' | 'empty';
}

/** phase 466: marker 模式 for subagent context restoration */
export interface DialogMarker {
  clawId: string;
  toolUseId: string;
}

/** phase 466: restorePrefix 返完整前缀 */
export interface RestoreResult {
  messages: Message[];                              // marker 时刻 messages 切片（含 marker 那条 assistant message）
  systemPrompt: string;                             // 该 SessionData 的 systemPrompt（phase 713: per-turn snapshot）
  toolsForLLM: ToolDefinition[];                    // phase 713 NEW
  meta: { foundIn: 'current' | 'archive'; foundFile?: string };
}
