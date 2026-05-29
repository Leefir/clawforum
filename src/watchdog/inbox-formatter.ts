/**
 * @module L6.Watchdog
 * phase 1414: Watchdog 自家 'crash_notification' inbox 消息 formatter。
 *
 * 业务语义 = "claw crash 后给 motion 发的通知消息怎么对 LLM 呈现"、
 * 措辞业主自定（"Claw X process exited abnormally..."）。
 *
 * phase 1414 derive：原在 Runtime formatInboxMessage case
 * 'crash_notification' 字面 + 措辞（L5 Runtime 字面知 L6 Watchdog 消息
 * 措辞、违 ML#5 底层不预设上层语义），迁入业主模块（消除字面反向）。
 */

import type { MessageFormatter } from '../foundation/messaging/index.js';

export const formatCrashNotification: MessageFormatter = async ({ from, body, timestampSec }) =>
  `[system message${timestampSec}] Claw "${from}" process exited abnormally.\n${body}`;
