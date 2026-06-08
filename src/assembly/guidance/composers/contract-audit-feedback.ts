/**
 * @module L6.Assembly.Guidance
 * phase 9 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: contract-auditor LLM 周期审 drift 后投反馈
 * 接收方: 被审的 claw (req.clawId)
 * body 自足: 含 drift 列表 + next_focus_suggestion（claw LLM 自决调整 / 不属 CLI 类）
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: drift 处置需 claw 调用特定 CLI（如 cancel / recreate）的标准化模式出现时
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
