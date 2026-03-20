/**
 * LLMService stream failover 测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMService } from '../../src/foundation/llm/service.js';
import type { IProviderAdapter, StreamChunk } from '../../src/foundation/llm/types.js';
import { LLMError } from '../../src/types/errors.js';

// Mock provider factory
function createMockProvider(name: string, streamImpl?: () => AsyncGenerator<StreamChunk>): IProviderAdapter {
  return {
    name,
    model: 'mock-model',
    async call() {
      return {
        content: [{ type: 'text', text: `Response from ${name}` }],
        stop_reason: 'end_turn',
      };
    },
    stream: streamImpl 
      ? streamImpl 
      : async function* () {
          yield { type: 'text_delta', delta: `Chunk from ${name}` };
          yield { type: 'done' };
        },
  };
}

// Mock createProvider to inject our mocks
vi.mock('../../src/foundation/llm/anthropic.js', () => ({
  AnthropicAdapter: class MockAnthropicAdapter {
    name = 'mock-anthropic';
    model = 'mock-model';
    constructor(public config: any) {}
    async call() {
      return {
        content: [{ type: 'text', text: 'mock response' }],
        stop_reason: 'end_turn',
      };
    }
    async *stream() {
      yield { type: 'text_delta', delta: 'mock chunk' };
      yield { type: 'done' };
    }
  },
}));

describe('LLMService - stream failover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should yield chunks from primary when successful', async () => {
    const primary = createMockProvider('primary', async function* () {
      yield { type: 'text_delta', delta: 'Hello' };
      yield { type: 'text_delta', delta: ' World' };
      yield { type: 'done' };
    });

    const service = new LLMService({
      primary: { name: 'primary', apiKey: 'test', model: 'test' },
      maxAttempts: 1,
      retryDelayMs: 0,
    });
    
    // Replace internal provider with mock
    (service as any).primary = primary;

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.stream({ messages: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: 'text_delta', delta: 'Hello' });
    expect(chunks[1]).toEqual({ type: 'text_delta', delta: ' World' });
    expect(chunks[2]).toEqual({ type: 'done' });
  });

  it('should failover to fallback when primary fails', async () => {
    const primary = createMockProvider('primary', async function* () {
      yield { type: 'text_delta', delta: 'Primary start' };
      throw new Error('Primary stream failed');
    });

    const fallback = createMockProvider('fallback', async function* () {
      yield { type: 'text_delta', delta: 'Fallback chunk 1' };
      yield { type: 'text_delta', delta: 'Fallback chunk 2' };
      yield { type: 'done' };
    });

    const service = new LLMService({
      primary: { name: 'primary', apiKey: 'test', model: 'test' },
      fallbacks: [{ name: 'fallback', apiKey: 'test', model: 'test' }],
      maxAttempts: 1,
      retryDelayMs: 0,
    });

    // Replace internal providers with mocks
    (service as any).primary = primary;
    (service as any).fallbacks = [fallback];

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.stream({ messages: [] })) {
      chunks.push(chunk);
    }

    // Primary yielded one chunk before failing, then fallback took over
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toEqual({ type: 'text_delta', delta: 'Primary start' });
    expect(chunks[1]).toEqual({ type: 'text_delta', delta: 'Fallback chunk 1' });
    expect(chunks[2]).toEqual({ type: 'text_delta', delta: 'Fallback chunk 2' });
    expect(chunks[3]).toEqual({ type: 'done' });

    // currentProviderIndex !== -1 means using fallback
    expect((service as any).currentProviderIndex).not.toBe(-1);
  });

  it('should throw original error when no fallback available', async () => {
    const primary = createMockProvider('primary', async function* () {
      yield { type: 'text_delta', delta: 'Primary start' };
      throw new Error('Primary stream failed');
    });

    const service = new LLMService({
      primary: { name: 'primary', apiKey: 'test', model: 'test' },
      maxAttempts: 1,
      retryDelayMs: 0,
    });
    
    // Replace internal provider with mock (no fallback)
    (service as any).primary = primary;
    (service as any).fallback = undefined;

    const chunks: StreamChunk[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const chunk of service.stream({ messages: [] })) {
        chunks.push(chunk);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    // Should have received some chunks before failure
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: 'text_delta', delta: 'Primary start' });
    
    // Should throw with an error indicating all providers failed
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain('All providers failed');
  });

  it('should throw if stream not supported', async () => {
    const primary = {
      name: 'no-stream-provider',
      model: 'test',
      async call() {
        return { content: [], stop_reason: 'end_turn' };
      },
      // No stream method
    } as any;

    const service = new LLMService({
      primary: { name: 'primary', apiKey: 'test', model: 'test' },
      maxAttempts: 1,
      retryDelayMs: 0,
    });
    
    (service as any).primary = primary;

    let caughtError: Error | undefined;
    try {
      for await (const chunk of service.stream({ messages: [] })) {
        // should not reach here
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeInstanceOf(LLMError);
    expect(caughtError!.message).toContain('All providers failed');
  });
});
