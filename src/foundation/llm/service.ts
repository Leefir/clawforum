/**
 * LLM Service - Main implementation with failover and retry
 * 
 * Implements ILLMService interface
 * - Retry with exponential backoff
 * - Failover to fallback provider
 * - Monitor integration for logging
 */

import type { IMonitor, LLMCallEvent } from '../monitor/types.js';
import type { LLMResponse } from '../../types/message.js';
import {
  LLMError,
  LLMAllProvidersFailedError,
} from '../../types/errors.js';
import type {
  ProviderConfig,
  LLMServiceConfig,
  LLMCallOptions,
  IProviderAdapter,
  StreamChunk,
} from './types.js';
import type { ILLMService } from './index.js';
import { AnthropicAdapter } from './anthropic.js';

/**
 * Provider factory - creates appropriate adapter for config
 */
function createProvider(config: ProviderConfig): IProviderAdapter {
  // Currently only Anthropic is supported
  // Could be extended to detect provider type from config
  return new AnthropicAdapter(config);
}

/**
 * Delay helper for retry backoff
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * LLM Service implementation
 */
export class LLMService implements ILLMService {
  private primary: IProviderAdapter;
  private fallback?: IProviderAdapter;
  private config: LLMServiceConfig;
  private monitor?: IMonitor;
  private clawId?: string;
  
  // Track if we're using fallback
  private usingFallback = false;
  
  constructor(
    config: LLMServiceConfig,
    monitor?: IMonitor,
    clawId?: string,
  ) {
    this.config = config;
    this.primary = createProvider(config.primary);
    this.fallback = config.fallback ? createProvider(config.fallback) : undefined;
    this.monitor = monitor;
    this.clawId = clawId;
  }
  
  /**
   * Make an LLM call with retry and failover
   */
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    let lastError: Error | undefined;
    let retryCount = 0;
    
    // Try primary provider with retries
    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      try {
        const response = await this.primary.call(options);
        
        // Log successful call
        this.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: this.primary.name,
          model: this.primary.model,
          success: true,
          latencyMs: Date.now() - startTime,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          isFallback: this.usingFallback,
          retryCount,
        });
        
        // Reset fallback status on primary success
        this.usingFallback = false;
        return response;
        
      } catch (error) {
        lastError = error as Error;
        retryCount++;
        
        // Don't retry on certain errors (client errors)
        if (error instanceof LLMError) {
          const code = (error as LLMError & { code?: string }).code;
          if (code === 'LLM_INVALID_RESPONSE') {
            break; // Don't retry invalid response
          }
        }
        
        // Wait before retry (exponential backoff with 30s max)
        if (attempt < this.config.maxAttempts - 1) {
          const backoffMs = Math.min(
            this.config.retryDelayMs * Math.pow(2, attempt),
            30_000  // Max 30 seconds
          );
          await delay(backoffMs);
        }
      }
    }
    
    // Primary failed, try fallback if available
    if (this.fallback) {
      try {
        const response = await this.fallback.call(options);
        
        // Log fallback success
        this.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: this.fallback.name,
          model: this.fallback.model,
          success: true,
          latencyMs: Date.now() - startTime,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          isFallback: true,
          retryCount,
        });
        
        this.usingFallback = true;
        return response;
        
      } catch (fallbackError) {
        // Log fallback failure
        this.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: this.fallback.name,
          model: this.fallback.model,
          success: false,
          latencyMs: Date.now() - startTime,
          isFallback: true,
          retryCount,
          error: (fallbackError as Error).message,
        });
        
        // Both failed
        throw new LLMAllProvidersFailedError([
          { provider: this.primary.name, error: lastError! },
          { provider: this.fallback.name, error: fallbackError as Error },
        ]);
      }
    }
    
    // No fallback, primary failed
    // Log failure
    this.logLLMCall({
      timestamp: new Date().toISOString(),
      provider: this.primary.name,
      model: this.primary.model,
      success: false,
      latencyMs: Date.now() - startTime,
      isFallback: false,
      retryCount,
      error: lastError!.message,
    });
    
    throw new LLMAllProvidersFailedError([
      { provider: this.primary.name, error: lastError! },
    ]);
  }
  
  /**
   * Stream LLM response with fallback support
   * If primary fails mid-stream, attempts to failover to fallback provider
   * Note: fallback restarts from beginning (may duplicate content), but better than total failure
   */
  async* stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk> {
    const provider = this.usingFallback && this.fallback 
      ? this.fallback 
      : this.primary;
    
    if (!provider.stream) {
      throw new LLMError('Streaming not supported by provider', { provider: provider.name });
    }
    
    try {
      yield* provider.stream(options);
    } catch (error) {
      // 尝试 fallback provider
      if (this.fallback && provider !== this.fallback && this.fallback.stream) {
        this.usingFallback = true;
        yield* this.fallback.stream(options);
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Get current provider info
   */
  getProviderInfo(): {
    name: string;
    model: string;
    isFallback: boolean;
  } {
    const provider = this.usingFallback && this.fallback
      ? this.fallback
      : this.primary;
    
    return {
      name: provider.name,
      model: provider.model,
      isFallback: this.usingFallback,
    };
  }
  
  /**
   * Health check - quick validation that provider is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Make a minimal request (low token count)
      await this.primary.call({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1,
      });
      return true;
    } catch (err) {
      console.warn('[llm] healthCheck failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }
  
  /**
   * Close/cleanup - no-op for fetch-based implementation
   */
  async close(): Promise<void> {
    // No persistent connections to close
  }
  
  /**
   * Log LLM call to monitor (if configured)
   */
  private logLLMCall(event: LLMCallEvent): void {
    if (this.monitor) {
      // Inject clawId if available
      const eventWithClawId = this.clawId ? { ...event, clawId: this.clawId } : event;
      this.monitor.logLLMCall(eventWithClawId);
    }
  }
}
