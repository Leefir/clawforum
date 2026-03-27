/**
 * ReAct Loop - Core reasoning and action loop
 * 
 * Implements the ReAct pattern:
 * 1. Send conversation to LLM
 * 2. LLM either returns final answer or requests tool calls
 * 3. If tool calls: execute tools, append results, repeat
 * 4. If final answer: return to user
 * 
 * Reference: Python MVP clawforum/core/react_loop.py
 */

import type { Message, ContentBlock, ToolUseBlock, ToolResultBlock, LLMResponse, ToolDefinition } from '../../types/message.js';
import type { ILLMService, LLMCallOptions } from '../../foundation/llm/index.js';
import type { StreamChunk } from '../../foundation/llm/types.js';
import type { IToolExecutor, ExecContext, ToolResult, IToolRegistry } from '../tools/executor.js';
import { MaxStepsExceededError } from '../../types/errors.js';
import { REACT_DEFAULT_MAX_TOKENS } from '../../constants.js';

/**
 * Safe callback wrappers - prevent UI callback errors from breaking the loop
 */
function safeCallback(label: string, fn: () => void): void {
  try { fn(); }
  catch (err) { console.warn(`[loop] ${label} error:`, err instanceof Error ? err.message : String(err)); }
}
async function safeCallbackAsync(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (err) { console.warn(`[loop] ${label} error:`, err instanceof Error ? err.message : String(err)); }
}

/**
 * Options for runReact
 */
export interface ReactOptions {
  /** Conversation history (modified in-place) */
  messages: Message[];
  
  /** System prompt */
  systemPrompt: string;
  
  /** LLM service */
  llm: ILLMService;
  
  /** Tool executor */
  executor: IToolExecutor;
  
  /** Execution context */
  ctx: ExecContext;
  
  /** Maximum steps before throwing MaxStepsExceededError */
  maxSteps?: number;
  
  /** Callback when a tool is called (for UI updates) */
  onToolCall?: (toolName: string) => void | Promise<void>;
  
  /** Callback before LLM call (for showing "Thinking...") */
  onBeforeLLMCall?: () => void;
  
  /** Callback after tool execution with result (for showing tool output) */
  onToolResult?: (toolName: string, result: ToolResult, step: number, maxSteps: number) => void;
  
  /** Callback after each step completes (for incremental persistence) */
  onStepComplete?: () => Promise<void>;
  
  /** Tool definitions to pass to LLM for native tool_use */
  tools?: ToolDefinition[];
  
  /** Tool registry for checking readonly property (optional, enables parallel execution) */
  registry?: IToolRegistry;
  
  /** Callback for streaming text deltas (for real-time display) */
  onTextDelta?: (delta: string) => void;
  
  /** Callback when text block ends (before tool_use or turn_end) */
  onTextEnd?: () => void;
  
  /** Callback for streaming thinking deltas (for extended thinking display) */
  onThinkingDelta?: (delta: string) => void;
}

/**
 * Result of ReAct loop
 */
export interface ReactResult {
  /** Final text response from LLM */
  finalText: string;
  
  /** Number of tool execution steps used */
  stepsUsed: number;
  
  /** Why the loop stopped */
  stopReason: 'end_turn' | 'max_steps' | 'no_tool' | 'max_tokens';
}

/**
 * Run the ReAct loop
 * 
 * This function modifies the `messages` array in-place, adding assistant
 * responses and tool results as the conversation progresses.
 */
export async function runReact(options: ReactOptions): Promise<ReactResult> {
  const {
    messages,
    systemPrompt,
    llm,
    executor,
    ctx,
    maxSteps = 20,
    onToolCall,
    onBeforeLLMCall,
    onToolResult,
    onStepComplete,
  } = options;

  let stepCount = 0;

  while (stepCount < maxSteps) {
    // Sync step counter to context
    ctx.stepNumber = stepCount;

    // Check abort signal before LLM call
    if (ctx.signal?.aborted) {
      throw new Error('Execution aborted');
    }

    // Notify before LLM call (for "Thinking..." display)
    safeCallback('onBeforeLLMCall', () => onBeforeLLMCall?.());

    // 流式调用 LLM，收集完整 response
    const response = await collectStreamResponse(llm, {
      messages,
      system: systemPrompt,
      tools: options.tools,
      maxTokens: REACT_DEFAULT_MAX_TOKENS,
      signal: ctx.signal,
    }, options.onTextDelta, options.onThinkingDelta, options.onTextEnd);

    // Handle tool_use stop reason
    if (response.stop_reason === 'tool_use') {
      // Extract tool calls from response
      const toolCalls = extractToolCalls(response.content);
      
      if (toolCalls.length === 0) {
        // No actual tool calls found (unexpected), treat as end_turn
        console.warn('[loop] stop_reason=tool_use but no tool calls found in response');
        const text = extractText(response.content);
        appendAssistantMessage(messages, response.content);
        return {
          finalText: text,
          stepsUsed: stepCount,
          stopReason: 'no_tool',
        };
      }

      // Append assistant's tool_use message
      appendAssistantMessage(messages, response.content);

      // Execute tool calls: read-only tools in parallel, write tools sequentially
      const toolResults = await executeToolCalls(
        toolCalls,
        executor,
        ctx,
        options.registry,
        onToolCall,
        onToolResult,
        stepCount,
        maxSteps
      );

      // 检查是否被中断（工具执行后）
      if (ctx.signal?.aborted) {
        throw new Error('Execution aborted');
      }

      // Append tool results as user message
      appendToolResults(messages, toolResults);

      // Increment step and continue loop
      ctx.incrementStep();
      stepCount = ctx.stepNumber;

      // Call step completion callback (audit log must succeed)
      if (onStepComplete) {
        await onStepComplete();
      }
      
      continue;
    }

    // Handle end_turn stop reason (final answer)
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop') {
      const text = extractText(response.content);
      appendAssistantMessage(messages, response.content);
      return {
        finalText: text,
        stepsUsed: stepCount,
        stopReason: 'end_turn',
      };
    }

    // Handle max_tokens stop reason
    if (response.stop_reason === 'max_tokens') {
      const text = extractText(response.content);
      appendAssistantMessage(messages, response.content);
      return {
        finalText: text + '\n\n[Response truncated due to length limit]',
        stepsUsed: stepCount,
        stopReason: 'max_tokens',
      };
    }

    // Unknown stop reason, treat as end_turn
    const text = extractText(response.content);
    appendAssistantMessage(messages, response.content);
    return {
      finalText: text,
      stepsUsed: stepCount,
      stopReason: 'end_turn',
    };
  }

  // Max steps exceeded
  throw new MaxStepsExceededError(maxSteps);
}

/**
 * Execute tool calls with parallel optimization for read-only tools
 * 
 * - Read-only tools: executed in parallel
 * - Write tools: executed sequentially
 * - Results are assembled in original order
 */
async function executeToolCalls(
  toolCalls: ToolUseBlock[],
  executor: IToolExecutor,
  ctx: ExecContext,
  registry: IToolRegistry | undefined,
  onToolCall?: (toolName: string) => void | Promise<void>,
  onToolResult?: (toolName: string, result: ToolResult, step: number, maxSteps: number) => void,
  stepCount: number = 0,
  maxSteps: number = 20,
): Promise<ToolResultBlock[]> {
  // If no registry, fall back to sequential execution
  if (!registry) {
    const toolResults: ToolResultBlock[] = [];
    for (const toolCall of toolCalls) {
      if (ctx.signal?.aborted) throw new Error('Execution aborted');
      await safeCallbackAsync('onToolCall', async () => await onToolCall?.(toolCall.name));
      const result = await executeSingleTool(toolCall, executor, ctx);
      safeCallback('onToolResult', () => onToolResult?.(toolCall.name, result, stepCount, maxSteps));
      toolResults.push(toToolResultBlock(toolCall.id, result));
    }
    return toolResults;
  }

  // Group tool calls into three categories:
  // 1. Readonly + async:true → executeSingleTool (preserves async routing)
  // 2. Readonly + sync → executeParallel (parallel optimization)
  // 3. Write → executeSingleTool (sequential, for safety)
  const readonlyAsyncCalls: { call: ToolUseBlock; index: number }[] = [];
  const readonlySyncCalls: { call: ToolUseBlock; index: number }[] = [];
  const writeCalls: { call: ToolUseBlock; index: number }[] = [];

  for (const [i, call] of toolCalls.entries()) {
    const tool = registry.get(call.name);
    const wantsAsync = (call.input as Record<string, unknown>)?.async === true;
    if (tool?.readonly === true && !wantsAsync) {
      readonlySyncCalls.push({ call, index: i });
    } else if (tool?.readonly === true && wantsAsync) {
      readonlyAsyncCalls.push({ call, index: i });
    } else {
      writeCalls.push({ call, index: i });
    }
  }

  // Results map: index -> ToolResultBlock
  const results = new Map<number, ToolResultBlock>();

  // Execute readonly + async tools sequentially (preserve async routing)
  for (const { call, index } of readonlyAsyncCalls) {
    if (ctx.signal?.aborted) throw new Error('Execution aborted');
    await safeCallbackAsync('onToolCall', async () => await onToolCall?.(call.name));
    const result = await executeSingleTool(call, executor, ctx);
    safeCallback('onToolResult', () => onToolResult?.(call.name, result, stepCount, maxSteps));
    results.set(index, toToolResultBlock(call.id, result));
  }

  // Execute readonly sync tools in parallel
  if (readonlySyncCalls.length > 0) {
    // Notify UI for all readonly calls (before parallel execution)
    for (const { call } of readonlySyncCalls) {
      await safeCallbackAsync('onToolCall', async () => await onToolCall?.(call.name));
    }

    // Prepare batch for parallel execution
    const batch = readonlySyncCalls.map(({ call }) => {
      const { async: _asyncMode, ...toolArgs } = call.input as Record<string, unknown>;
      return {
        toolName: call.name,
        args: toolArgs,
      };
    });

    // Execute parallel batch
    const parallelResults = await executor.executeParallel(batch, ctx);

    // Notify UI and store results in original order
    for (let i = 0; i < readonlySyncCalls.length; i++) {
      const { call, index } = readonlySyncCalls[i];
      const result = parallelResults[i];
      safeCallback('onToolResult', () => onToolResult?.(call.name, result, stepCount, maxSteps));
      results.set(index, toToolResultBlock(call.id, result));
    }
  }

  // Execute write tools sequentially
  for (const { call, index } of writeCalls) {
    if (ctx.signal?.aborted) throw new Error('Execution aborted');
    await safeCallbackAsync('onToolCall', async () => await onToolCall?.(call.name));
    const result = await executeSingleTool(call, executor, ctx);
    safeCallback('onToolResult', () => onToolResult?.(call.name, result, stepCount, maxSteps));
    results.set(index, toToolResultBlock(call.id, result));
  }

  // Assemble results in original order
  return toolCalls.map((_, i) => {
    const r = results.get(i);
    if (!r) throw new Error(`[loop] Missing result for tool call at index ${i}`);
    return r;
  });
}

/**
 * Execute a single tool with error handling
 */
async function executeSingleTool(
  toolCall: ToolUseBlock,
  executor: IToolExecutor,
  ctx: ExecContext,
): Promise<ToolResult> {
  try {
    // Extract async flag (meta parameter, not passed to tool)
    const { async: asyncMode, __parseError, __raw, ...toolArgs } = toolCall.input as Record<string, unknown>;

    // Input JSON failed to parse — return error immediately without calling the tool
    if (__parseError) {
      return { success: false, content: `工具输入 JSON 解析失败，无法调用工具 "${toolCall.name}"。原始输入: ${String(__raw || '').slice(0, 200)}` };
    }

    return await executor.execute({
      toolName: toolCall.name,
      args: toolArgs,
      ctx,
      async: asyncMode === true,
    });
  } catch (err) {
    const errorType = err instanceof Error ? err.constructor.name : 'Error';
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[react/loop] Tool ${toolCall.name} execution failed:`, errorMsg);
    return {
      success: false,
      content: `[${errorType}] 工具执行失败: ${errorMsg}`,
    };
  }
}

/**
 * Convert ToolResult to ToolResultBlock
 */
function toToolResultBlock(toolUseId: string, result: ToolResult): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result.content,
    is_error: !result.success,
  };
}

/**
 * Collect stream chunks into a complete response
 */
async function collectStreamResponse(
  llm: ILLMService,
  callOptions: LLMCallOptions,
  onTextDelta?: (delta: string) => void,
  onThinkingDelta?: (delta: string) => void,
  onTextEnd?: () => void,
): Promise<LLMResponse> {
  const contentBlocks: ContentBlock[] = [];
  let currentText = '';
  let currentThinking = '';
  let currentSignature = '';
  let currentToolUse: { id: string; name: string; input: string } | null = null;
  let stopReason = 'end_turn';
  let usage: { input_tokens: number; output_tokens: number } | undefined;

  for await (const chunk of llm.stream(callOptions)) {
    // 每个 chunk 后检查 signal，确保及时响应 abort
    if (callOptions.signal?.aborted) {
      throw new Error('Execution aborted');
    }
    switch (chunk.type) {
      case 'text_delta':
        // Flush thinking before text starts
        if (currentThinking) {
          contentBlocks.push({ type: 'thinking', thinking: currentThinking, signature: currentSignature } as ContentBlock);
          currentThinking = '';
          currentSignature = '';
        }
        if (chunk.delta) {
          currentText += chunk.delta;
          onTextDelta?.(chunk.delta);
        }
        break;

      case 'thinking_delta':
        if (chunk.delta) {
          currentThinking += chunk.delta;
          onThinkingDelta?.(chunk.delta);
        }
        break;

      case 'thinking_signature':
        if (chunk.signature) {
          currentSignature = chunk.signature;
        }
        break;

      case 'tool_use_start':
        // Flush thinking before tool_use
        if (currentThinking) {
          contentBlocks.push({ type: 'thinking', thinking: currentThinking, signature: currentSignature } as ContentBlock);
          currentThinking = '';
          currentSignature = '';
        }
        // 保存之前的 text block
        if (currentText) {
          contentBlocks.push({ type: 'text', text: currentText } as ContentBlock);
          currentText = '';
          onTextEnd?.();
        }
        // 保存之前的 tool_use（如果有多个）
        if (currentToolUse) {
          contentBlocks.push({
            type: 'tool_use',
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: JSON.parse(currentToolUse.input || '{}'),
          } as ContentBlock);
        }
        currentToolUse = {
          id: chunk.toolUse!.id,
          name: chunk.toolUse!.name,
          input: '',
        };
        stopReason = 'tool_use';
        break;

      case 'tool_use_delta':
        if (currentToolUse && chunk.toolUse?.partialInput) {
          currentToolUse.input += chunk.toolUse.partialInput;
        }
        break;

      case 'done':
        if (chunk.usage) {
          usage = {
            input_tokens: chunk.usage.inputTokens,
            output_tokens: chunk.usage.outputTokens,
          };
        }
        if (chunk.stopReason && chunk.stopReason !== 'end_turn') {
          stopReason = chunk.stopReason;
        }
        break;
    }
  }

  // 保存最后的 blocks
  if (currentThinking) {
    contentBlocks.push({ type: 'thinking', thinking: currentThinking, signature: currentSignature } as ContentBlock);
  }
  if (currentText) {
    contentBlocks.push({ type: 'text', text: currentText } as ContentBlock);
    onTextEnd?.();
  }
  if (currentToolUse) {
    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(currentToolUse.input || '{}');
    } catch (err) {
      console.error(`[loop] Failed to parse tool input for "${currentToolUse.name}": ${err instanceof Error ? err.message : String(err)}`);
      parsedInput = { __parseError: true, __raw: (currentToolUse.input ?? '').slice(0, 500) };
    }
    contentBlocks.push({
      type: 'tool_use',
      id: currentToolUse.id,
      name: currentToolUse.name,
      input: parsedInput,
    } as ContentBlock);
    currentToolUse = null;
  }

  return {
    content: contentBlocks,
    stop_reason: stopReason,
    usage,
  };
}

/**
 * Extract tool_use blocks from content
 */
function extractToolCalls(content: ContentBlock[]): ToolUseBlock[] {
  return content
    .filter((block): block is ToolUseBlock => block.type === 'tool_use')
    .map(block => ({
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    }));
}

/**
 * Extract text content from response
 */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => 
      block.type === 'text'
    )
    .map(block => block.text)
    .join('')
    .trim();
}

/**
 * Append assistant message to conversation
 */
function appendAssistantMessage(messages: Message[], content: ContentBlock[]): void {
  messages.push({
    role: 'assistant',
    content,
  });
}

/**
 * Append tool results as user message
 */
function appendToolResults(messages: Message[], results: ToolResultBlock[]): void {
  messages.push({
    role: 'user',
    content: results,
  });
}
