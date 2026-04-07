/**
 * Anthropic API Adapter
 * 
 * Implements IProviderAdapter for Anthropic's Claude API
 * Reference: https://docs.anthropic.com/claude/reference/messages_post
 */

import Anthropic from '@anthropic-ai/sdk';
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

  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'adaptive'; effort: 'low' | 'medium' | 'high' };
}



/**
 * Anthropic adapter implementation
 */
export class AnthropicAdapter implements IProviderAdapter {
  readonly name: string;
  readonly model: string;
  
  private readonly config: ProviderConfig;
  private readonly baseUrl: string;
  private readonly client: Anthropic;
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.name = config.name;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: this.baseUrl,
      defaultHeaders: config.extraHeaders,
      maxRetries: 0,
    });
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
      const mode = this.config.thinkingMode ?? 'adaptive';
      if (mode === 'adaptive') {
        body.thinking = { type: 'adaptive', effort: this.config.thinkingEffort ?? 'high' };
      } else {
        const budget = this.config.thinkingBudgetTokens
          ?? Math.max(1, body.max_tokens - THINKING_TOKEN_RESERVE);
        body.thinking = { type: 'enabled', budget_tokens: budget };
      }
      delete body.temperature;
    }

    return body;
  }

  /**
   * Build request options with beta headers for enabled thinking mode
   */
  private buildRequestOptions(): Anthropic.RequestOptions {
    if (this.config.thinking && (this.config.thinkingMode ?? 'adaptive') === 'enabled') {
      return { headers: { 'anthropic-beta': 'interleaved-thinking-2025-05-14' } };
    }
    return {};
  }

  /**
   * Map SDK errors to our error types
   */
  private mapSDKError(error: unknown, timeoutMs: number, signal?: AbortSignal): Error {
    // Use name check for mock compatibility in tests
    const errName = (error as Error)?.constructor?.name;
    if (errName === 'APIUserAbortError') {
      const err = new Error('Execution aborted');
      err.name = 'AbortError';
      return err;
    }
    if (errName === 'RateLimitError') {
      const retryAfter = (error as { headers?: Headers })?.headers?.get?.('retry-after');
      return new LLMRateLimitError(this.name, retryAfter ? parseInt(retryAfter, 10) : undefined);
    }
    if (errName === 'APIConnectionTimeoutError') {
      return new LLMTimeoutError(this.name, timeoutMs);
    }
    if (errName === 'APIError') {
      const apiErr = error as { status?: number; message: string };
      return new LLMError(
        `Provider ${this.name} error (${apiErr.status ?? 'unknown'}): ${apiErr.message}`,
        { provider: this.name, status: apiErr.status },
      );
    }
    if (error instanceof LLMError) return error;
    return new LLMError(
      `LLM call failed: ${(error as Error).message}`,
      { provider: this.name },
    );
  }

  /**
   * Make a single LLM call
   */
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const body = this.buildRequestBody(options);
    const requestOptions: Anthropic.RequestOptions = {
      ...this.buildRequestOptions(),
      timeout: options.timeoutMs ?? this.config.timeoutMs,
      signal: options.signal,
    };
    try {
      const response = await this.client.messages.create(
        body as Anthropic.MessageCreateParamsNonStreaming,
        requestOptions,
      );
      return this.parseResponse(response);
    } catch (error) {
      throw this.mapSDKError(error, options.timeoutMs ?? this.config.timeoutMs, options.signal);
    }
  }
  
  /**
   * Stream LLM response using SDK
   */
  async* stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk> {
    const body = this.buildRequestBody(options);
    const requestOptions: Anthropic.RequestOptions = {
      ...this.buildRequestOptions(),
      timeout: STREAM_MAX_DURATION_MS,
      signal: options.signal,
    };
    try {
      const sdkStream = this.client.messages.stream(
        body as Anthropic.MessageStreamParams,
        requestOptions,
      );
      yield* this.parseSDKStream(sdkStream);
    } catch (error) {
      throw this.mapSDKError(error, STREAM_MAX_DURATION_MS, options.signal);
    }
  }

  /**
   * Parse SDK stream events to StreamChunk format
   */
  private async* parseSDKStream(
    stream: ReturnType<Anthropic['messages']['stream']>,
  ): AsyncIterableIterator<StreamChunk> {
    let currentToolId = '';
    let currentToolName = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          currentToolId = block.id;
          currentToolName = block.name;
          yield { type: 'tool_use_start', toolUse: { id: block.id, name: block.name, partialInput: '' } };
        }
        // thinking / redacted_thinking block_start: 无需 yield
      } else if (event.type === 'content_block_delta') {
        const d = event.delta;
        if (d.type === 'text_delta') {
          yield { type: 'text_delta', delta: d.text };
        } else if (d.type === 'thinking_delta') {
          yield { type: 'thinking_delta', delta: d.thinking };
        } else if (d.type === 'signature_delta') {
          yield { type: 'thinking_signature', signature: d.signature };
        } else if (d.type === 'input_json_delta') {
          yield { type: 'tool_use_delta', toolUse: { id: currentToolId, name: currentToolName, partialInput: d.partial_json } };
        }
      } else if (event.type === 'message_delta') {
        yield {
          type: 'done',
          stopReason: event.delta.stop_reason ?? 'end_turn',
          usage: event.usage
            ? { inputTokens: event.usage.input_tokens ?? 0, outputTokens: event.usage.output_tokens ?? 0 }
            : undefined,
        };
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

    const dropThinking = this.config.dropThinkingBlocks ?? false;

    return messages.flatMap((m, idx): Array<{ role: string; content: string | unknown[] }> => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const addCache = idx === lastUserIdx;

      // String content: add cache_control by converting to array
      if (!Array.isArray(m.content)) {
        if (addCache) {
          return [{ role, content: [{ type: 'text', text: m.content as string, cache_control: { type: 'ephemeral' } }] }];
        }
        return [{ role, content: m.content as string }];
      }

      const blocks = m.content as Array<{type?: string}>;

      // Filter thinking blocks if dropThinkingBlocks is enabled (for MiniMax and other providers)
      const effectiveBlocks = dropThinking
        ? blocks.filter(b => b.type !== 'thinking')
        : blocks;

      // Check if message contains structured blocks (tool_use, tool_result, or thinking)
      const hasStructuredBlocks = effectiveBlocks.some(
        b => b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking'
      );

      if (hasStructuredBlocks) {
        if (addCache) {
          // Copy last block with cache_control
          const copy: unknown[] = [...effectiveBlocks];
          copy[copy.length - 1] = { ...(copy[copy.length - 1] as Record<string, unknown>), cache_control: { type: 'ephemeral' } };
          return [{ role, content: copy }];
        }
        // Keep array format for structured messages
        return [{ role, content: effectiveBlocks as unknown[] }];
      }

      // Text-only or think-only
      const text = (effectiveBlocks as Array<{type?: string; text?: string}>)
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('');

      // Skip messages that become empty after dropping thinking blocks.
      // This happens when an assistant message contained only thinking blocks.
      if (!text && !addCache) return [];

      if (addCache) {
        return [{ role, content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] }];
      }
      return [{ role, content: text }];
    });
  }
  
  /**
   * Parse Anthropic response to our LLMResponse format
   */
  private parseResponse(data: Anthropic.Message): LLMResponse {
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
  

}
