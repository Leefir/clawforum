/**
 * 公共交互式 REPL 工具 - Ink 实现
 * claw chat 和 motion chat 共用
 */

import * as React from 'react';
import { render } from 'ink';
import { App } from './ink/App.js';

// 保留原有导出接口，callers 零改动
export interface ReplCallbacks {
  onBeforeLLMCall?: () => void;
  onToolCall?: (name: string) => void;
  onToolResult?: (name: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => void;
  onTextDelta?: (delta: string) => void;  // 新增：流式文本增量
}

export interface ReplOptions {
  /** 提示符，如 '> ' 或 'motion> ' */
  prompt: string;
  /** 头部说明文字 */
  header: string;
  /** 处理单条消息，返回回复文本 */
  onMessage: (message: string, callbacks: ReplCallbacks) => Promise<string>;
  /** REPL 关闭时的清理 */
  onClose: () => Promise<void>;
  /** Ctrl+C 中断当前 LLM 调用 */
  onInterrupt?: () => void;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(App, { options }),
    { exitOnCtrlC: false }
  );
  await waitUntilExit();
  process.stdin.pause();
}
