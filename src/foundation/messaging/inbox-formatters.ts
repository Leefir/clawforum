/**
 * @module L2.Messaging
 * phase 1414: Messaging 自家的两个通用 inbox formatter。
 *
 * 'user_inbox_message' + 'message' 两类消息措辞业主 = Messaging（L2 持
 * inbox/outbox + 通用消息体）。phase 1414 derive：从 Runtime 的
 * formatInboxMessage case-switch 迁入此处。
 */

import type { MessageFormatter, MessageFormatterRegistry } from './formatter-registry.js';

export const formatUserInboxMessage: MessageFormatter = async ({ body, timestampSec }) =>
  `[user inbox message${timestampSec}]\n${body}`;

export const formatGenericMessage: MessageFormatter = async ({ body, timestampSec }) =>
  `[system message${timestampSec}] ${body}`;

/**
 * Assembly 装配期一次调、注册 Messaging 自家两个通用 formatter。
 */
export function registerMessagingFormatters(registry: MessageFormatterRegistry): void {
  registry.register('user_inbox_message', formatUserInboxMessage);
  registry.register('message', formatGenericMessage);
}
