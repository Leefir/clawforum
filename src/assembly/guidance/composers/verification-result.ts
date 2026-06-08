/**
 * @module L6.Assembly.Guidance
 * phase 1469 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: claw submit_subtask → verifier passed (含 force-accepted)
 * 接收方: 调用方 claw 自己（ctx.notifyClaw(ctx.clawId, ...)）
 * body 自足: 含 `Subtask X accepted. All subtasks complete!` 类摘要
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: verification 通知投递跨 daemon（如 motion 跨观察 worker 通过） → 重审跨层 hint
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
