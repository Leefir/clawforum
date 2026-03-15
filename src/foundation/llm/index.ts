/**
 * LLM Service interface (F2)
 * Phase 0: Interface definitions only
 * 
 * Design principles:
 * - Unified interface for multiple providers (Anthropic, OpenAI, etc.)
 * - Failover support via primary + fallback
 * - Streaming support for real-time responses
 */

import type { 
  Message, 
  ToolDefinition, 
  LLMResponse,
  LLMProvider,
  LLMConfig 
} from '../../types/index.js';

// Re-export types for convenience
export type { Message, ToolDefinition, LLMResponse, LLMProvider, LLMConfig };

/**
 * Options for a single LLM call
 */
export interface LLMCallOptions {
  /** Conversation messages */
  messages: Message[];
  
  /** System prompt (optional) */
  system?: string;
  
  /** Available tools for function calling */
  tools?: ToolDefinition[];
  
  /** Maximum tokens to generate */
  maxTokens?: number;
  
  /** Temperature (0-2) */
  temperature?: number;
  
  /** Override model for this call */
  model?: string;
  
  /** Timeout in milliseconds */
  timeoutMs?: number;
  
  /** Signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Streaming chunk from LLM
 */
export interface LLMStreamChunk {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'done';
  content?: string;
  toolUse?: {
    id: string;
    name: string;
    input?: Record<string, unknown>;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * LLM Service interface - Unified LLM calling
 * 
 * Implementation notes:
 * - Handles provider-specific formatting internally
 * - Implements retry logic with exponential backoff
 * - Supports failover to backup provider
 */
export interface ILLMService {
  /**
   * Make a single LLM call
   * @param options - Call options
   * @returns LLM response
   * @throws LLMError subclasses for various failure modes
   */
  call(options: LLMCallOptions): Promise<LLMResponse>;
  
  /**
   * Stream LLM response
   * @param options - Call options
   * @returns Async iterable of chunks
   */
  stream(options: LLMCallOptions): AsyncIterableIterator<LLMStreamChunk>;
  
  /**
   * Get current provider info
   */
  getProviderInfo(): {
    name: string;
    model: string;
    isFallback: boolean;
  };
  
  /**
   * Close connections and cleanup resources
   */
  close(): Promise<void>;
  
  /**
   * Check if service is healthy
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Provider adapter interface - For implementing new LLM providers
 */
export interface ILLMProviderAdapter {
  readonly name: string;
  
  /**
   * Convert generic options to provider-specific request format
   */
  formatRequest(options: LLMCallOptions): unknown;
  
  /**
   * Parse provider response to generic format
   */
  parseResponse(response: unknown): LLMResponse;
  
  /**
   * Parse streaming chunk
   */
  parseStreamChunk(chunk: unknown): LLMStreamChunk | null;
  
  /**
   * Get default headers for API calls
   */
  getHeaders(apiKey: string): Record<string, string>;
  
  /**
   * Get API endpoint URL
   */
  getEndpoint(baseUrl?: string): string;
}

/**
 * Factory function type for creating LLM service
 */
export type LLMServiceFactory = (config: LLMConfig) => ILLMService;

// LLMCallEvent is defined in monitor module to avoid circular imports
// Import from '../monitor/index.js' when needed for monitoring
