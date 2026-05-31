// src/foundation/command-tool/audit-events.ts
// Phase 1473: exec tool 拒绝 motion-chain self-kill (chestnut stop / motion stop)
//   触发：motion 通过 exec 跑 `chestnut stop` → in-flight tool_use_result 丢
//        → motion 重启回到悬挂 tool_use → 再发起 → 死循环

export const COMMAND_TOOL_AUDIT_EVENTS = {
  EXEC_MOTION_SELF_KILL_BLOCKED: 'exec_motion_self_kill_blocked',
} as const;
