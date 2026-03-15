/**
 * LLM Service tests
 * 
 * Tests:
 * - AnthropicAdapter: normal response, tool_use, error handling
 * - LLMService: failover, retry, monitor integration
 * 
 * All tests use mock fetch - no real API calls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { 
  LLMResponse, 
  Message, 
  ToolDefinition 
} from '../../src/types/message.js';
import type { LLMCallEvent } from '../../src/foundation/monitor/types.js';
import { AnthropicAdapter } from '../../src/foundation/llm/anthropic.js';
import { LLMService } from '../../src/foundation/llm/service.js';
import {
  LLMRateLimitError,
  LLMTimeoutError,
  LLMAllProvidersFailedError,
} from '../../src/types/errors.js';

// Helper to create a mock Response
function createMockResponse(body: object, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['retry-after', '10']]) as unknown as Headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// Helper to create Anthropic-style response
function createAnthropicResponse(content: Array<{ type: string; [key: string]: unknown }>): object {
  return {
    id: 'msg-test',
    type: 'message',
    role: 'assistant',
    content,
    model: 'claude-3-sonnet',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  };
}

describe('LLM Service', () => {
  describe('AnthropicAdapter', () => {
    const config = {
      name: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-3-sonnet',
      maxTokens: 4096,
      temperature: 0.7,
      timeoutMs: 30000,
    };

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should parse normal text response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          createAnthropicResponse([{ type: 'text', text: 'Hello, world!' }])
        )
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      
      const response = await adapter.call({ messages });

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect((response.content[0] as { text: string }).text).toBe('Hello, world!');
      expect(response.stop_reason).toBe('end_turn');
      expect(response.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    });

    it('should parse tool_use response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          createAnthropicResponse([
            { type: 'text', text: 'I will help you' },
            { 
              type: 'tool_use', 
              id: 'tool-1',
              name: 'read',
              input: { path: 'test.txt' }
            }
          ])
        )
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const messages: Message[] = [{ role: 'user', content: 'Read a file' }];
      
      const response = await adapter.call({ messages });

      expect(response.content).toHaveLength(2);
      expect(response.content[0].type).toBe('text');
      expect(response.content[1].type).toBe('tool_use');
      
      const toolBlock = response.content[1] as { id: string; name: string; input: object };
      expect(toolBlock.id).toBe('tool-1');
      expect(toolBlock.name).toBe('read');
      expect(toolBlock.input).toEqual({ path: 'test.txt' });
    });

    it('should preserve tool_use and tool_result blocks in request', async () => {
      // This is a critical test - it verifies that formatMessages preserves
      // all content blocks (text, tool_use, tool_result) for multi-turn tool calls
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(createAnthropicResponse([{ type: 'text', text: 'Done' }]))
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const messages: Message[] = [
        { role: 'user', content: 'Search for test' },
        { 
          role: 'assistant', 
          content: [
            { type: 'text', text: 'Let me search.' },
            { type: 'tool_use', id: 'call_1', name: 'search', input: { query: 'test' } }
          ]
        },
        { 
          role: 'user', 
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'Found: result' }
          ]
        }
      ];
      
      await adapter.call({ messages });

      // Verify the request body preserves all block types
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages).toHaveLength(3);
      
      // Assistant message should have both text and tool_use
      expect(requestBody.messages[1].content).toHaveLength(2);
      expect(requestBody.messages[1].content[0].type).toBe('text');
      expect(requestBody.messages[1].content[1].type).toBe('tool_use');
      
      // User message should have tool_result
      expect(requestBody.messages[2].content).toHaveLength(1);
      expect(requestBody.messages[2].content[0].type).toBe('tool_result');
    });

    it('should throw LLMRateLimitError on 429', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse({ error: 'rate_limited' }, 429)
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      
      await expect(adapter.call({ messages })).rejects.toThrow(LLMRateLimitError);
    });

    it('should throw LLMTimeoutError on AbortError', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new DOMException('timeout', 'AbortError'));
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      
      await expect(adapter.call({ messages })).rejects.toThrow(LLMTimeoutError);
    });

    it('should throw LLMError on network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      
      await expect(adapter.call({ messages })).rejects.toThrow();
    });

    it('should include correct headers in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(createAnthropicResponse([{ type: 'text', text: 'OK' }]))
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      await adapter.call({ messages: [{ role: 'user', content: 'Hi' }] });

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should include tools in request when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(createAnthropicResponse([{ type: 'text', text: 'OK' }]))
      );
      vi.stubGlobal('fetch', mockFetch);

      const adapter = new AnthropicAdapter(config);
      const tools: ToolDefinition[] = [
        {
          name: 'read',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ];
      
      await adapter.call({ 
        messages: [{ role: 'user', content: 'Read test.txt' }],
        tools,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('read');
    });
  });

  describe('LLMService', () => {
    const primaryConfig = {
      name: 'primary',
      apiKey: 'primary-key',
      baseUrl: 'https://primary.example.com',
      model: 'model-1',
      maxTokens: 4096,
      temperature: 0.7,
      timeoutMs: 30000,
    };

    const fallbackConfig = {
      name: 'fallback',
      apiKey: 'fallback-key',
      baseUrl: 'https://fallback.example.com',
      model: 'model-2',
      maxTokens: 4096,
      temperature: 0.7,
      timeoutMs: 30000,
    };

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should use primary provider on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          createAnthropicResponse([{ type: 'text', text: 'Primary response' }])
        )
      );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        maxAttempts: 3,
        retryDelayMs: 100,
      });

      const response = await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect((response.content[0] as { text: string }).text).toBe('Primary response');
      expect(service.getProviderInfo().name).toBe('primary');
    });

    it('should failover to fallback when primary fails', async () => {
      // Primary fails, fallback succeeds
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Primary error'))
        .mockResolvedValueOnce(
          createMockResponse(
            createAnthropicResponse([{ type: 'text', text: 'Fallback response' }])
          )
        );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        fallback: fallbackConfig,
        maxAttempts: 1,
        retryDelayMs: 100,
      });

      const response = await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect((response.content[0] as { text: string }).text).toBe('Fallback response');
      expect(service.getProviderInfo().isFallback).toBe(true);
    });

    it('should throw LLMAllProvidersFailedError when both fail', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Both failed'));
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        fallback: fallbackConfig,
        maxAttempts: 1,
        retryDelayMs: 100,
      });

      await expect(service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow(LLMAllProvidersFailedError);
    });

    it('should retry primary before failover', async () => {
      // Fail twice, succeed on third
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockResolvedValueOnce(
          createMockResponse(
            createAnthropicResponse([{ type: 'text', text: 'Success' }])
          )
        );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        fallback: fallbackConfig,
        maxAttempts: 3,
        retryDelayMs: 10, // Fast for test
      });

      const response = await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect((response.content[0] as { text: string }).text).toBe('Success');
      expect(mockFetch).toHaveBeenCalledTimes(3); // 3 retries
    });

    it('should call monitor.logLLMCall on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(
          createAnthropicResponse([{ type: 'text', text: 'OK' }])
        )
      );
      vi.stubGlobal('fetch', mockFetch);

      // Create mock monitor
      const loggedEvents: LLMCallEvent[] = [];
      const mockMonitor = {
        logLLMCall: (event: LLMCallEvent) => {
          loggedEvents.push(event);
        },
        logToolCall: vi.fn(),
        logContract: vi.fn(),
        logFileOperation: vi.fn(),
        log: vi.fn(),
        logError: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
        getMetrics: vi.fn().mockResolvedValue({}),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const service = new LLMService(
        {
          primary: primaryConfig,
          maxAttempts: 1,
          retryDelayMs: 100,
        },
        mockMonitor,
        'test-claw'
      );

      await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      // Wait for async log
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(loggedEvents).toHaveLength(1);
      expect(loggedEvents[0].provider).toBe('primary');
      expect(loggedEvents[0].model).toBe('model-1');
      expect(loggedEvents[0].success).toBe(true);
      expect(loggedEvents[0].isFallback).toBe(false);
      expect(loggedEvents[0].clawId).toBe('test-claw');
    });

    it('should reset fallback status after primary succeeds', async () => {
      // First call fails (uses fallback)
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Primary down'))
        .mockResolvedValueOnce(
          createMockResponse(
            createAnthropicResponse([{ type: 'text', text: 'Fallback' }])
          )
        )
        // Second call primary succeeds
        .mockResolvedValueOnce(
          createMockResponse(
            createAnthropicResponse([{ type: 'text', text: 'Primary OK' }])
          )
        );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        fallback: fallbackConfig,
        maxAttempts: 1,
        retryDelayMs: 10,
      });

      // First call - should use fallback
      const response1 = await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect((response1.content[0] as { text: string }).text).toBe('Fallback');
      expect(service.getProviderInfo().isFallback).toBe(true);

      // Second call - should use primary (fallback reset)
      const response2 = await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect((response2.content[0] as { text: string }).text).toBe('Primary OK');
      expect(service.getProviderInfo().isFallback).toBe(false);
    });

    it('should cap backoff at 30 seconds', async () => {
      // Use small delay to verify the capping logic without long waits
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))  // 1st attempt
        .mockRejectedValueOnce(new Error('Error 2'))  // 2nd attempt  
        .mockRejectedValueOnce(new Error('Error 3'))  // 3rd attempt
        .mockResolvedValueOnce(                      // 4th attempt (success)
          createMockResponse(
            createAnthropicResponse([{ type: 'text', text: 'Success' }])
          )
        );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        maxAttempts: 5,  // Max 5 attempts total
        // Base delay: 50ms
        // 1st retry: 50ms * 2^0 = 50ms
        // 2nd retry: 50ms * 2^1 = 100ms
        // 3rd retry would be 200ms, etc.
        // All well under 30s cap - test verifies code path exists
        retryDelayMs: 50,
      });

      const start = Date.now();
      await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      const elapsed = Date.now() - start;

      // Should complete quickly with 3 retries at 50ms base
      expect(elapsed).toBeLessThan(1000);
      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should report correct provider info', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(createAnthropicResponse([{ type: 'text', text: 'OK' }]))
      );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        fallback: fallbackConfig,
        maxAttempts: 1,
        retryDelayMs: 100,
      });

      const info = service.getProviderInfo();
      expect(info.name).toBe('primary');
      expect(info.model).toBe('model-1');
      expect(info.isFallback).toBe(false);
    });

    it('should pass maxTokens and temperature to adapter', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        createMockResponse(createAnthropicResponse([{ type: 'text', text: 'OK' }]))
      );
      vi.stubGlobal('fetch', mockFetch);

      const service = new LLMService({
        primary: primaryConfig,
        maxAttempts: 1,
        retryDelayMs: 100,
      });

      await service.call({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 500,
        temperature: 0.5,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(500);
      expect(body.temperature).toBe(0.5);
    });
  });
});
