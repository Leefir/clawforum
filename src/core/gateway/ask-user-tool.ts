/**
 * ask_user 工具 wrapper
 *
 * 薄包装：不藏状态，不反向依赖 Gateway 内部。
 * 注册归调用方（phase146）。
 */

import type { Gateway } from './types.js';
import type { Tool } from '../tools/index.js';

export function createAskUserTool(gateway: Gateway): Tool {
  return {
    name: 'ask_user',
    description: '向用户提问并等待回复；若无实时连接立即失败。',
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
      },
      required: ['question'],
    },
    readonly: false,
    idempotent: false,
    execute: (args, ctx) => gateway.askUser(String(args.question ?? ''), ctx),
  };
}
