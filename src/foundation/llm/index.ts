/**
 * LLM Service module (F2)
 * Phase 0: Anthropic adapter + failover service
 * 
 * Exports: ILLMService interface, LLMService implementation, AnthropicAdapter
 */

// Re-export from central types
export type {
  Message,
  ToolDefinition,
  LLMResponse,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '../../types/message.js';

// Internal types
export type {
  ProviderConfig,
  LLMServiceConfig,
  LLMCallOptions,
  StreamChunk,
  IProviderAdapter,
} from './types.js';

// Import for interface definition
import type { LLMResponse, LLMCallOptions, StreamChunk } from './types.js';

// Implementation
export { LLMService } from './service.js';
export { AnthropicAdapter } from './anthropic.js';

/**
 * ILLMService interface
 * 
 * Implemented by LLMService class.
 */
export interface ILLMService {
  call(options: LLMCallOptions): Promise<LLMResponse>;
  stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk>;
  healthCheck(): Promise<boolean>;
  getProviderInfo(): { name: string; model: string; isFallback: boolean };
  close(): Promise<void>;
}
