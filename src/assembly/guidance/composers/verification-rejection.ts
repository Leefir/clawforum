/**
 * @module L6.Assembly.Guidance
 * phase 1469 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: claw submit_subtask → verifier rejected + 未达 verification_attempts
 * 接收方: 调用方 claw 自己
 * body 自足: 含 verifier 给的 feedback 字面（claw 凭 in-context info 修后再 submit）
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: 同 verification_result
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
