/**
 * ReAct loop - backwards-compat shim over AgentExecutor + StepExecutor
 *
 * 对外保持原 runReact 签名不变。内部把旧的 11 个平铺回调 + onStepComplete
 * 适配到新契约：StepCallbacks（给 StepExecutor） + onAfterStep（给 AgentExecutor）。
 *
 * 真实实现见 step-executor.ts 和 agent-executor.ts。
 */

import type { Message, ToolDefinition } from '../../types/message.js';
import type { LLMService } from '../../foundation/llm/index.js';
import type { IToolExecutor, ExecContext, ToolResult, ToolRegistry } from '../tools/executor.js';
import { runAgent } from './agent-executor.js';
import type { StepCallbacks, LLMCallInfo } from './step-executor.js';

export interface ReactOptions {
  messages: Message[];
  systemPrompt: string;
  llm: LLMService;
  executor: IToolExecutor;
  ctx: ExecContext;
  maxSteps?: number;
  idleTimeoutMs?: number;
  onToolCall?: (toolName: string, toolUseId: string) => void | Promise<void>;
  onBeforeLLMCall?: () => void;
  onToolResult?: (toolName: string, toolUseId: string, result: ToolResult, step: number, maxSteps: number) => void;
  onStepComplete?: () => Promise<void>;
  tools?: ToolDefinition[];
  registry?: ToolRegistry;
  onTextDelta?: (delta: string) => void;
  onTextEnd?: () => void;
  onThinkingDelta?: (delta: string) => void;
  onReset?: (provider: string, timeoutMs: number) => void;
  onProviderFailed?: (provider: string, model: string, error: string) => void;
  onLLMResult?: (info: LLMCallInfo) => void;
}

export interface ReactResult {
  finalText: string;
  stepsUsed: number;
  stopReason: 'end_turn' | 'max_steps' | 'no_tool' | 'max_tokens';
}

export async function runReact(options: ReactOptions): Promise<ReactResult> {
  const {
    messages, systemPrompt, llm, executor, ctx,
    maxSteps = 20,
    idleTimeoutMs,
    onToolCall, onBeforeLLMCall, onToolResult, onStepComplete,
    tools = [],
    registry,
    onTextDelta, onTextEnd, onThinkingDelta,
    onReset, onProviderFailed, onLLMResult,
  } = options;

  // 用闭包捕获 stepCount（适配旧 onToolResult 签名的 step/maxSteps 参数）
  let stepCount = 0;

  const stepCallbacks: StepCallbacks = {
    onBeforeLLMCall,
    onLLMResult,
    onTextDelta,
    onTextEnd,
    onThinkingDelta,
    onToolCall,
    onToolResult: onToolResult
      ? (name, toolUseId, result) => onToolResult(name, toolUseId, result, stepCount, maxSteps)
      : undefined,
    onReset,
    onProviderFailed,
  };

  const result = await runAgent({
    messages, systemPrompt, llm, tools, executor, registry, ctx,
    maxSteps,
    idleTimeoutMs,
    stepCallbacks,
    onAfterStep: async () => {
      stepCount = ctx.stepNumber;  // incrementStep 已被 AgentExecutor 执行
      if (onStepComplete) await onStepComplete();
    },
    // sessionStore 不传：shim 不依赖 SessionStore（由调用方通过 onStepComplete 自己处理）
  });

  return {
    finalText: result.finalText,
    stepsUsed: result.stepsUsed,
    stopReason: mapStopReason(result.stopReason),
  };
}

function mapStopReason(
  r: 'end_turn' | 'max_tokens_text' | 'no_tool' | 'unknown'
): 'end_turn' | 'no_tool' | 'max_tokens' {
  if (r === 'max_tokens_text') return 'max_tokens';
  if (r === 'no_tool') return 'no_tool';
  return 'end_turn';  // 'unknown' 和 'end_turn' 归一到 'end_turn'
}
