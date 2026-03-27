/**
 * Anthropic API Adapter
 * 
 * Implements IProviderAdapter for Anthropic's Claude API
 * Reference: https://docs.anthropic.com/claude/reference/messages_post
 */

import type {
  LLMResponse,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
} from '../../types/message.js';
import {
  LLMError,
  LLMRateLimitError,
  LLMTimeoutError,
} from '../../types/errors.js';
import type {
  ProviderConfig,
  LLMCallOptions,
  IProviderAdapter,
  StreamChunk,
} from './types.js';
import { THINKING_TOKEN_RESERVE, STREAM_MAX_DURATION_MS } from '../../constants.js';

/**
 * Anthropic API request body
 */
interface AnthropicRequest {
  model: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  max_tokens: number;
  temperature?: number;
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
  stream?: boolean;
  thinking?: { type: 'enabled'; budget_tokens: number };
}

/**
 * Anthropic API response
 */
interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; [key: string]: unknown }>;
  model: string;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic adapter implementation
 */
export class AnthropicAdapter implements IProviderAdapter {
  readonly name: string;
  readonly model: string;
  
  private readonly config: ProviderConfig;
  private readonly baseUrl: string;
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.name = config.name;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
  }
  
  /**
   * Build request body for Anthropic API
   * Shared logic between call() and stream()
   */
  private buildRequestBody(options: LLMCallOptions): AnthropicRequest {
    const { messages, system, tools, maxTokens, temperature } = options;
    const body: AnthropicRequest = {
      model: options.model ?? this.config.model,
      messages: this.formatMessages(messages),
      max_tokens: maxTokens ?? this.config.maxTokens,
    };

    if (system !== undefined) {
      body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    }

    if (temperature !== undefined) {
      body.temperature = temperature;
    } else if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      }));
    }

    // Extended thinking (requires no temperature)
    if (this.config.thinking) {
      const budget = this.config.thinkingBudgetTokens ?? Math.max(1, body.max_tokens - THINKING_TOKEN_RESERVE);
      body.thinking = { type: 'enabled', budget_tokens: budget };
      delete body.temperature;
    }

    return body;
  }

  /**
   * Make a single LLM call
   */
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const { timeoutMs, signal } = options;
    const body = this.buildRequestBody(options);
    
    // Setup timeout
    const timeout = timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Combine with external signal if provided
    const onAbort = signal ? () => controller.abort() : undefined;
    if (signal && onAbort) {
      signal.addEventListener('abort', onAbort);
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }
      
      const data = await response.json() as AnthropicResponse;
      return this.parseResponse(data);
      
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // 区分用户主动中断（Ctrl+C）和内部超时
        if (signal?.aborted) {
          // 用户主动中断
          const err = new Error('Execution aborted');
          err.name = 'AbortError';
          throw err;
        }
        // 内部超时
        throw new LLMTimeoutError(this.name, timeout);
      }
      
      if (error instanceof LLMError) {
        throw error;
      }
      
      throw new LLMError(
        `LLM call failed: ${(error as Error).message}`,
        { provider: this.name }
      );
    } finally {
      clearTimeout(timeoutId);
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }
  
  /**
   * Stream LLM response with true SSE parsing
   */
  async* stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk> {
    const { timeoutMs, signal } = options;
    const body: AnthropicRequest & { stream: boolean } = {
      ...this.buildRequestBody(options),
      stream: true,
    };

    // fetch 阶段保留初始 timeout（等待服务器首次响应）
    const timeout = timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    let timeoutId = setTimeout(() => controller.abort(), timeout);
    const onAbort = signal ? () => controller.abort() : undefined;
    if (signal && onAbort) signal.addEventListener('abort', onAbort);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) await this.handleErrorResponse(response);

      // fetch 成功，清除初始 timeout，由 parseSSEStream 管理 idle timeout
      clearTimeout(timeoutId);

      // 总超时兜底：无论 idle timer 是否生效，N 分钟后强制 abort
      const maxTimer = setTimeout(() => controller.abort(), STREAM_MAX_DURATION_MS);
      try {
        yield* this.parseSSEStream(response, controller, timeout);
      } finally {
        clearTimeout(maxTimer);
      }
    } catch (error) {
      // 与 call() 相同的错误处理
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (signal?.aborted) {
          const err = new Error('Execution aborted');
          err.name = 'AbortError';
          throw err;
        }
        throw new LLMTimeoutError(this.name, timeout);
      }
      if (error instanceof LLMError) throw error;
      throw new LLMError(`LLM stream failed: ${(error as Error).message}`, { provider: this.name });
    } finally {
      clearTimeout(timeoutId);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Parse Anthropic SSE stream
   */
  private async* parseSSEStream(
    response: Response,
    controller: AbortController,
    idleTimeoutMs: number,
  ): AsyncIterableIterator<StreamChunk> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
    let currentToolId = '';
    let currentToolName = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        clearTimeout(idleTimer);
        if (done) break;
        idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(data);
          } catch (err) {
            console.warn(`[anthropic] Failed to parse SSE event, skipping. data="${data.slice(0, 100)}" err=${err instanceof Error ? err.message : String(err)}`);
            continue;
          }

          if (event.type === 'content_block_start') {
            const block = event.content_block as Record<string, unknown>;
            if (block.type === 'tool_use') {
              currentToolId = block.id as string ?? '';
              currentToolName = block.name as string ?? '';
              yield {
                type: 'tool_use_start',
                toolUse: {
                  id: currentToolId,
                  name: currentToolName,
                  partialInput: '',
                },
              };
            }
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown>;
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', delta: delta.text as string };
            } else if (delta.type === 'thinking_delta') {
              yield { type: 'thinking_delta', delta: delta.thinking as string };
            } else if (delta.type === 'signature_delta') {
              yield { type: 'thinking_signature', signature: delta.signature as string };
            } else if (delta.type === 'input_json_delta') {
              yield {
                type: 'tool_use_delta',
                toolUse: { id: currentToolId, name: currentToolName, partialInput: delta.partial_json as string },
              };
            }
          } else if (event.type === 'message_delta') {
            const usage = event.usage as Record<string, number> | undefined;
            const delta = event.delta as Record<string, unknown> | undefined;
            yield {
              type: 'done',
              usage: usage ? {
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
              } : undefined,
              stopReason: delta?.stop_reason as string | undefined,
            };
          }
        }
      }
    } finally {
      clearTimeout(idleTimer);
      try {
        reader.releaseLock();
      } catch {
        // Ignore: pending read during timeout/abort; stream will be GC'd
      }
    }
  }
  
  /**
   * Format messages for Anthropic API
   * 
   * CRITICAL: This logic was refined through 5 iterations (hotfix #1, #2, #5).
   * DO NOT simplify to pass-through without understanding the consequences.
   * 
   * History:
   * - v1: Filter text only → lost tool blocks
   * - v2: Pass-through all → MiniMax rejected pure arrays for text-only messages
   * - v3: Conditional: tool blocks→array, text→string → correct
   * - v4 (Step 20): Pass-through all → REGRESSION: pure thinking blocks caused empty responses
   * - v5 (hotfix #5): Restore v3 logic with better comments
   * - v6: Add cache_control for prompt caching (last user message gets array with cache_control)
   * 
   * Requirements:
   * - Non-last user messages with pure text → string (MiniMax compatibility)
   * - Last user message → array with cache_control (prompt caching)
   * - Messages with tool_use/tool_result → must keep array format
   * - Messages with only thinking blocks → extract text, skip thinking blocks
   * 
   * Smart conversion:
   * - Non-last user message: string content → string
   * - Last user message: any format → array with cache_control on last block
   * - Assistant messages with tool blocks → array
   * - Text-only/think-only messages → extract text → string (unless last user)
   * 
   * This prevents pure think/thinking blocks from being sent to API without text,
   * which can cause empty responses from some LLM providers (e.g., MiniMax).
   * Cache_control on last user message enables incremental caching within a session.
   */
  private formatMessages(messages: Array<{ role: string; content: unknown }>): Array<{ role: string; content: string | unknown[] }> {
    // Find last user message index for cache_control (同一会话内增量缓存)
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }

    return messages.map((m, idx) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const addCache = idx === lastUserIdx;

      // String content: add cache_control by converting to array
      if (!Array.isArray(m.content)) {
        if (addCache) {
          return { role, content: [{ type: 'text', text: m.content as string, cache_control: { type: 'ephemeral' } }] };
        }
        return { role, content: m.content as string };
      }

      const blocks = m.content as Array<{type?: string}>;

      // Check if message contains structured blocks (tool_use, tool_result, or thinking)
      const hasStructuredBlocks = blocks.some(
        b => b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking'
      );

      if (hasStructuredBlocks) {
        if (addCache) {
          // Copy last block with cache_control
          const copy: unknown[] = [...blocks];
          copy[copy.length - 1] = { ...(copy[copy.length - 1] as Record<string, unknown>), cache_control: { type: 'ephemeral' } };
          return { role, content: copy };
        }
        // Keep array format for structured messages
        return { role, content: blocks as unknown[] };
      }

      // Text-only or think-only
      const text = (blocks as Array<{type?: string; text?: string}>)
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('');

      if (addCache) {
        return { role, content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] };
      }
      return { role, content: text };
    });
  }
  
  /**
   * Parse Anthropic response to our LLMResponse format
   */
  private parseResponse(data: AnthropicResponse): LLMResponse {
    // Store raw content blocks including unknown types (think, reasoning, etc.)
    // This aligns with MVP behavior - don't filter, let LLM handle its own blocks
    const content = data.content as ContentBlock[];
    
    return {
      content,
      stop_reason: data.stop_reason ?? 'end_turn',
      usage: data.usage,
      model: data.model,
    };
  }
  
  /**
   * Handle HTTP error responses
   */
  private async handleErrorResponse(response: Response): Promise<void> {
    const status = response.status;
    let errorText: string;
    
    try {
      const errorData = await response.json();
      errorText = (errorData as { error?: { message?: string } }).error?.message ?? JSON.stringify(errorData);
    } catch {
      errorText = await response.text();
    }
    
    if (status === 429) {
      // Try to extract retry-after header
      const retryAfter = response.headers.get('retry-after');
      throw new LLMRateLimitError(
        this.name,
        retryAfter ? parseInt(retryAfter, 10) : undefined
      );
    }
    
    if (status >= 500) {
      throw new LLMError(
        `Provider ${this.name} server error (${status}): ${errorText}`,
        { provider: this.name, status }
      );
    }
    
    throw new LLMError(
      `Provider ${this.name} error (${status}): ${errorText}`,
      { provider: this.name, status }
    );
  }
}
