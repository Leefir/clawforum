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
import { OpenAIAdapter } from './openai.js';

/**
 * Provider factory - creates appropriate adapter for config
 */
function createProvider(config: ProviderConfig): IProviderAdapter {
  if (config.apiFormat === 'openai') {
    return new OpenAIAdapter(config);
  }
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
  private fallbacks: IProviderAdapter[];
  private config: LLMServiceConfig;
  private monitor?: IMonitor;
  private clawId?: string;
  
  // Track current provider: -1 = primary, 0..N = fallbacks[i]
  private currentProviderIndex = -1;
  
  constructor(
    config: LLMServiceConfig,
    monitor?: IMonitor,
    clawId?: string,
  ) {
    this.config = config;
    this.primary = createProvider(config.primary);
    this.fallbacks = (config.fallbacks ?? []).map(createProvider);
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
          isFallback: false,
          retryCount,
        });
        
        // Reset to primary
        this.currentProviderIndex = -1;
        return response;
        
      } catch (error) {
        lastError = error as Error;
        retryCount++;
        
        // Don't retry on user abort (would add multi-second delay)
        if (lastError.name === 'AbortError') throw lastError;
        
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
    
    // Primary failed, try fallbacks in order
    const failures: Array<{ provider: string; error: Error }> = [
      { provider: this.primary.name, error: lastError! }
    ];
    
    for (let i = 0; i < this.fallbacks.length; i++) {
      const fb = this.fallbacks[i];
      try {
        const response = await fb.call(options);
        
        // Log fallback success
        this.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: fb.name,
          model: fb.model,
          success: true,
          latencyMs: Date.now() - startTime,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          isFallback: true,
          retryCount,
        });
        
        this.currentProviderIndex = i;
        return response;
        
      } catch (fallbackError) {
        // Log fallback failure
        this.logLLMCall({
          timestamp: new Date().toISOString(),
          provider: fb.name,
          model: fb.model,
          success: false,
          latencyMs: Date.now() - startTime,
          isFallback: true,
          retryCount,
          error: (fallbackError as Error).message,
        });
        
        failures.push({ provider: fb.name, error: fallbackError as Error });
      }
    }
    
    // All providers failed
    throw new LLMAllProvidersFailedError(failures);
  }
  
  /**
   * Stream LLM response with retry and fallback support
   * 
   * - Retries with exponential backoff on connection failures (same as call())
   * - Falls back to fallback provider if all retries exhausted
   * - Note: retry only applies before stream starts; once chunks are flowing, 
   *         mid-stream errors will fail over without retry
   */
  async* stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk> {
    const providerIndex = this.currentProviderIndex;
    const provider = providerIndex === -1 
      ? this.primary 
      : this.fallbacks[providerIndex];
    
    if (!provider.stream) {
      throw new LLMError('Streaming not supported by provider', { provider: provider.name });
    }
    
    // Retry loop (aligns with call())
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      try {
        yield* provider.stream(options);
        return; // Success, exit generator
      } catch (error) {
        lastError = error as Error;
        // Don't retry on user abort (would add multi-second delay)
        if (lastError.name === 'AbortError') throw lastError;
        // Don't wait after the last attempt
        if (attempt < this.config.maxAttempts - 1) {
          const backoffMs = Math.min(
            this.config.retryDelayMs * Math.pow(2, attempt),
            30000,
          );
          await delay(backoffMs);
        }
      }
    }
    
    // Retries exhausted on primary, try fallbacks in order
    let fallbackError: Error | undefined = lastError;
    const startFallbackIndex = providerIndex === -1 ? 0 : providerIndex + 1;
    
    for (let i = startFallbackIndex; i < this.fallbacks.length; i++) {
      const fb = this.fallbacks[i];
      if (!fb.stream) continue;
      
      try {
        this.currentProviderIndex = i;
        yield* fb.stream(options);
        return;
      } catch (err) {
        fallbackError = err as Error;
        // Continue to next fallback
      }
    }
    
    throw fallbackError!;
  }
  
  /**
   * Get current provider info
   */
  getProviderInfo(): {
    name: string;
    model: string;
    isFallback: boolean;
  } {
    const provider = this.currentProviderIndex === -1
      ? this.primary
      : this.fallbacks[this.currentProviderIndex];
    
    return {
      name: provider.name,
      model: provider.model,
      isFallback: this.currentProviderIndex !== -1,
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
