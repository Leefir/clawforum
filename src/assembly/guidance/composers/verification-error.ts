/**
 * @module L6.Assembly.Guidance
 * phase 1469 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: claw submit_subtask → verifier 执行 throw（programming_bug / subagent_timeout）
 * 接收方: 调用方 claw 自己
 * body 自足: 含 errorMsg；系统自动 retry 或 force-accept（handleVerificationErrorRetry）
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: error 类需 claw 主动调研 / restart 类 CLI hint 时
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
