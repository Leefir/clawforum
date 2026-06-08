/**
 * @module L6.Assembly.Guidance
 * phase 9 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: async task (spawn / subagent / tool task) 完成
 * 接收方: 父 claw (task.parentClawId)
 * body 自足: 含 task result JSON (taskId + result + is_error)
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: 父 claw 处置 task result 需要跨层 CLI 调研 / monitor / restart 类 hint 时
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
