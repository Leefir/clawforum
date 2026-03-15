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
import type { ILLMService } from '../../foundation/llm/index.js';
import type { IToolExecutor, ExecContext, ToolResult } from '../tools/executor.js';
import { MaxStepsExceededError } from '../../types/errors.js';

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
  onToolCall?: (toolName: string) => void;
  
  /** Callback after each step completes (for incremental persistence) */
  onStepComplete?: () => Promise<void>;
  
  /** Tool definitions to pass to LLM for native tool_use */
  tools?: ToolDefinition[];
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
  stopReason: 'end_turn' | 'max_steps' | 'no_tool';
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

    // Call LLM
    const response = await llm.call({
      messages,
      system: systemPrompt,
      tools: options.tools,
      maxTokens: 4096,
      signal: ctx.signal,
    });

    // Handle tool_use stop reason
    if (response.stop_reason === 'tool_use') {
      // Extract tool calls from response
      const toolCalls = extractToolCalls(response.content);
      
      if (toolCalls.length === 0) {
        // No actual tool calls found (unexpected), treat as end_turn
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

      // Execute each tool call sequentially
      const toolResults: ToolResultBlock[] = [];
      
      for (const toolCall of toolCalls) {
        // Notify UI
        onToolCall?.(toolCall.name);

        // Execute tool
        const result = await executor.execute({
          toolName: toolCall.name,
          args: toolCall.input,
          ctx,
        });

        // Format result as ToolResultBlock
        const resultBlock: ToolResultBlock = {
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.content,
          is_error: !result.success,
        };
        toolResults.push(resultBlock);
      }

      // Append tool results as user message
      appendToolResults(messages, toolResults);

      // Increment step and continue loop
      ctx.incrementStep();
      stepCount = ctx.stepNumber;

      // Call step completion callback (don't let it break the loop)
      if (onStepComplete) {
        try {
          await onStepComplete();
        } catch {
          // Ignore callback errors
        }
      }

      continue;
    }

    // Handle end_turn stop reason
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop') {
      const text = extractText(response.content);
      appendAssistantMessage(messages, response.content);
      
      return {
        finalText: text,
        stepsUsed: stepCount,
        stopReason: 'end_turn',
      };
    }

    // Handle max_tokens (treat as end_turn with partial response)
    if (response.stop_reason === 'max_tokens') {
      const text = extractText(response.content);
      appendAssistantMessage(messages, response.content);
      
      return {
        finalText: text + '\n[Response truncated due to length]',
        stepsUsed: stepCount,
        stopReason: 'end_turn',
      };
    }

    // Unknown stop reason - treat as end_turn
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
 * Extract tool_use blocks from content
 */
function extractToolCalls(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => 
    block.type === 'tool_use'
  );
}

/**
 * Extract text from content blocks
 */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => 
      block.type === 'text'
    )
    .map(block => block.text)
    .join('\n');
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
