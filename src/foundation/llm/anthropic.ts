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
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
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
      signal.addEventListener('abort', () => controller.abort());
    }
    
    try {
      console.log('[LLM body]', JSON.stringify(body, null, 2));
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
   */
  private formatMessages(messages: Array<{ role: string; content: unknown }>): Array<{ role: string; content: string | unknown[] }> {
    return messages.map(m => {
      // Map 'assistant' to 'assistant', 'user' to 'user'
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      
      // Check if content has tool blocks
      const hasToolBlocks = Array.isArray(m.content) && m.content.some(
        (b: { type?: string }) => b.type === 'tool_use' || b.type === 'tool_result'
      );
      
      // MiniMax/Anthropic API compatibility:
      // - Pure text messages: content must be string (MiniMax requirement)
      // - Messages with tool_use/tool_result: content must be array (Anthropic format)
      if (hasToolBlocks) {
        // Keep array format for tool calls (required for tool history)
        return { role, content: m.content as unknown[] };
      } else if (Array.isArray(m.content)) {
        // Pure text blocks - merge to string for compatibility
        const text = m.content
          .filter((b: { type?: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text || '')
          .join('');
        return { role, content: text };
      } else {
        // Already a string
        return { role, content: m.content as string };
      }
    });
  }
  
  /**
   * Parse Anthropic response to our LLMResponse format
   */
  private parseResponse(data: AnthropicResponse): LLMResponse {
    // Only process known block types, filter out unknown ones (e.g., reasoning, think)
    const content: ContentBlock[] = data.content
      .filter(block => block.type === 'text' || block.type === 'tool_use')
      .map(block => {
        if (block.type === 'text') {
          return {
            type: 'text',
            text: block.text,
          } as TextBlock;
        }
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        } as ToolUseBlock;
      });
    
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
