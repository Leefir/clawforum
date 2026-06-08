/**
 * @module L6.Assembly.Guidance
 * phase 9 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: motion daemon 启动 + onboarding 已有 contract（start.ts daemon-loop 路径）
 * 接收方: motion 自己 (MOTION_CLAW_ID)
 * body 自足: 含 `Resuming Onboarding contract (X). Pending subtasks: Y. Please continue.`
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: resume 路径需要 motion 主动调研 contract 历史轨迹时
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
