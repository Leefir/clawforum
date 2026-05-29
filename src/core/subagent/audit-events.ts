/**
 * SubAgent audit event names.
 *
 * Module-owned event namespace per H1 design (phase338 / r36 α 决策).
 * 字符串值与起步态 events.ts SUBAGENT_ 系列等价 / 0 漂移。
 */

import type { AuditLog } from '../../foundation/audit/index.js';

export const SUBAGENT_AUDIT_EVENTS = {
  STEP_COMPLETE_FAILED: 'subagent_step_complete_failed',
  PERSIST_FAILED: 'subagent_persist_failed',
  LOG_APPEND_FAILED: 'subagent_log_append_failed',
  GHOST_CALLBACK_AFTER_TURN_END: 'ghost_callback_after_turn_end',
  // STREAM_APPEND_FAILED removed (phase 1152 G.1): PerResourceStreamWriter internally emits
  // STREAM_AUDIT_EVENTS.APPEND_FAILED with full path context; caller-side duplicate emit eliminated.
  TIMEOUT_REJECTION: 'subagent_timeout_rejection',
  // phase 1411 (reframe of phase 1409): generic tool_call index row.
  // 仅 name + tool_use_id + args_size — args body 0 入 audit.
  // dialog/current.json 是 tool_use args 全文权威源、CLI 凭 tool_use_id 跨源 join。
  // 详 design/modules/l3_subagent.md §A.phase1409-on-tool-call-args-emit
  // (amended-by phase 1411)。
  TOOL_CALL_INPUT: 'tool_call_input',
} as const;

export function emitToolCallInput(audit: AuditLog, opts: {
  name: string;
  toolUseId: string;
  argsSize: number;
}): void {
  audit.write(
    SUBAGENT_AUDIT_EVENTS.TOOL_CALL_INPUT,
    opts.name,
    opts.toolUseId,
    `args_size=${opts.argsSize}`,
  );
}

/**
 * React loop audit events (γ 同源复制 / phase375 裁决 2)
 *
 * 字符串值与 src/core/runtime/runtime-audit-events.ts 的 REACT_LOOP_AUDIT_EVENTS 等价 / 0 漂移。
 * 不抽共享层文件（避免新增模块层级 / M#5 反向）。
 */
export const REACT_LOOP_AUDIT_EVENTS = {
  TURN_START: 'turn_start',
  TURN_END: 'turn_end',
  TURN_INTERRUPTED: 'turn_interrupted',
  TURN_ERROR: 'turn_error',
  LLM_CALL: 'llm_call',
  LLM_ERROR: 'llm_error',
} as const;
