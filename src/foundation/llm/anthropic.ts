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

/**
 * Anthropic API request body
 */
interface AnthropicRequest {
  model: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  max_tokens: number;
  temperature?: number;
  system?: string;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
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
   * Make a single LLM call
   */
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const { messages, system, tools, maxTokens, temperature, timeoutMs, signal } = options;
    
    // Build request body
    const body: AnthropicRequest = {
      model: options.model ?? this.config.model,
      messages: this.formatMessages(messages),
      max_tokens: maxTokens ?? this.config.maxTokens,
    };
    
    if (system !== undefined) {
      body.system = system;
    }
    
    if (temperature !== undefined) {
      body.temperature = temperature;
    } else if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }
    
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }
    
    // Setup timeout
    const timeout = timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Combine with external signal if provided
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
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
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }
      
      const data = await response.json() as AnthropicResponse;
      return this.parseResponse(data);
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new LLMTimeoutError(this.name, timeout);
      }
      
      if (error instanceof LLMError) {
        throw error;
      }
      
      throw new LLMError(
        `LLM call failed: ${(error as Error).message}`,
        { provider: this.name }
      );
    }
  }
  
  /**
   * Stream LLM response
   * Note: SSE streaming implementation - simplified for Phase 0
   */
  async* stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk> {
    // For Phase 0, we'll use non-streaming and yield a single chunk
    // Full SSE implementation can be added in Phase 1
    const response = await this.call(options);
    
    for (const block of response.content) {
      if (block.type === 'text') {
        yield {
          type: 'text_delta',
          delta: (block as TextBlock).text,
        };
      } else if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        yield {
          type: 'tool_use_start',
          toolUse: {
            id: toolBlock.id,
            name: toolBlock.name,
            partialInput: JSON.stringify(toolBlock.input),
          },
        };
      }
    }
    
    yield { type: 'done' };
  }
  
  /**
   * Format messages for Anthropic API
   * 
   * ⚠️ CRITICAL: This logic was refined through 5 iterations (hotfix #1, #2, #5).
   * DO NOT simplify to pass-through without understanding the consequences.
   * 
   * History:
   * - v1: Filter text only → lost tool blocks
   * - v2: Pass-through all → MiniMax rejected pure arrays for text-only messages
   * - v3: Conditional: tool blocks→array, text→string → ✅ correct
   * - v4 (Step 20): Pass-through all → REGRESSION: pure thinking blocks caused empty responses
   * - v5 (hotfix #5): Restore v3 logic with better comments
   * 
   * Requirements:
   * - Pure text messages → must be string (MiniMax compatibility)
   * - Messages with tool_use/tool_result → must keep array format
   * - Messages with only thinking blocks → extract text, skip thinking blocks
   * 
   * Smart conversion:
   * - string content → string (user messages)
   * - array with tool blocks → array (assistant messages with tool_use/tool_result)
   * - array without tool blocks (text-only or think-only) → extract text → string
   * 
   * This prevents pure think/thinking blocks from being sent to API without text,
   * which can cause empty responses from some LLM providers (e.g., MiniMax).
   */
  private formatMessages(messages: Array<{ role: string; content: unknown }>): Array<{ role: string; content: string | unknown[] }> {
    return messages.map(m => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      
      // String content stays string
      if (!Array.isArray(m.content)) {
        return { role, content: m.content as string };
      }
      
      const blocks = m.content as Array<{type?: string}>;
      
      // Check if message contains tool-related blocks
      const hasToolBlocks = blocks.some(
        b => b.type === 'tool_use' || b.type === 'tool_result'
      );
      
      if (hasToolBlocks) {
        // Keep array format for tool messages
        return { role, content: blocks as unknown[] };
      }
      
      // Text-only or think-only: extract text blocks and join to string
      const text = (blocks as Array<{type?: string; text?: string}>)
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('');
      
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
      errorText = JSON.stringify(errorData);
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
