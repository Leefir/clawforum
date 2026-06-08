/**
 * @module L6.Assembly.Guidance
 * phase 1469 立 / phase 203 ratify: NO_GUIDANCE by-design.
 *
 * 触发: daemon 启动后第一 loop（daemon-loop.ts:157 shouldEmitStartupCheck）
 * 接收方: daemon 自己
 * body 自足: 含 `System startup. Please review active contracts and resume execution.`
 * 跨层 CLI hint 需要: ❌（详 design/modules/l6_assembly_composer_framework.md §2）
 *
 * 升档条件: 启动检查失败 + 需要 claw 调用 restart / inspect 类 CLI hint 时（如 daemon recovery 类）
 */

import { NO_GUIDANCE } from '../types.js';

export const composer = NO_GUIDANCE;
