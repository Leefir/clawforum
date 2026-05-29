/**
 * @module L5.Gateway
 * phase 1414: Gateway 自家 'user_chat' inbox 消息 formatter。
 *
 * 业务语义 = "用户 chat 消息怎么对 LLM 呈现"、Gateway 是 user input 业主。
 * 透传 body 无前缀（user_chat 消息体已是用户原文 / Gateway 不加装饰）。
 *
 * phase 1414 derive：原在 Runtime formatInboxMessage case 'user_chat'、
 * 迁入业主模块（一致性 / 不字面持上下游 message type）。
 */

import type { MessageFormatter } from '../../foundation/messaging/index.js';

export const formatUserChat: MessageFormatter = async ({ body }) => body;
