/**
 * ReAct loop tests
 * 
 * All tests use mock LLM - no real API calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runReact } from '../../src/core/react/loop.js';
import type { Message, ContentBlock, LLMResponse, ToolDefinition } from '../../src/types/message.js';
import type { ILLMService } from '../../src/foundation/llm/index.js';
import type { IToolExecutor, ExecContext } from '../../src/core/tools/executor.js';
import { MaxStepsExceededError } from '../../src/types/errors.js';

describe('ReAct Loop', () => {
  let mockLLM: ILLMService;
  let mockExecutor: IToolExecutor;
  let mockCtx: ExecContext;
  let llmCallCount: number;

  beforeEach(() => {
    llmCallCount = 0;
    
    mockLLM = {
      call: vi.fn(),
      stream: vi.fn(),
      close: vi.fn(),
      healthCheck: vi.fn(),
      getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'test', isFallback: false }),
    } as unknown as ILLMService;

    mockExecutor = {
      execute: vi.fn(),
      executeParallel: vi.fn(),
      validateArgs: vi.fn(),
    } as unknown as IToolExecutor;

    mockCtx = {
      clawId: 'test-claw',
      clawDir: '/test',
      profile: 'full',
      permissions: { read: true, write: true, execute: true, spawn: true, send: true, network: false, system: false },
      hasPermission: () => true,
      fs: {} as any,
      stepNumber: 0,
      maxSteps: 100,
      getElapsedMs: () => 0,
      incrementStep: vi.fn(function(this: { stepNumber: number }) { this.stepNumber++; }),
    } as unknown as ExecContext;
  });

  function createTextResponse(text: string): LLMResponse {
    return {
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    };
  }

  function createToolUseResponse(toolName: string, args: object): LLMResponse {
    return {
      content: [
        { type: 'text', text: `Using ${toolName}...` },
        {
          type: 'tool_use',
          id: `call-${llmCallCount++}`,
          name: toolName,
          input: args,
        },
      ],
      stop_reason: 'tool_use',
    };
  }

  it('should complete single tool call flow', async () => {
    // First call: LLM wants to use a tool
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'test.txt' }))
      // Second call: LLM returns final answer
      .mockResolvedValueOnce(createTextResponse('File content is "hello"'));

    // Mock tool execution
    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      content: 'hello',
    });

    const messages: Message[] = [{ role: 'user', content: 'Read the file' }];

    const result = await runReact({
      messages,
      systemPrompt: 'You are a helpful assistant',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
    });

    expect(result.finalText).toBe('File content is "hello"');
    expect(result.stepsUsed).toBe(1);
    expect(result.stopReason).toBe('end_turn');
    expect(messages.length).toBeGreaterThan(1); // messages were modified in-place
  });

  it('should handle multi-step tool chain', async () => {
    // LLM requests 3 tools sequentially
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('ls', { path: '.' }))
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'file1.txt' }))
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'file2.txt' }))
      .mockResolvedValueOnce(createTextResponse('Done reading all files'));

    (mockExecutor.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, content: 'file1.txt\nfile2.txt' })
      .mockResolvedValueOnce({ success: true, content: 'content1' })
      .mockResolvedValueOnce({ success: true, content: 'content2' });

    const messages: Message[] = [{ role: 'user', content: 'List and read files' }];

    const result = await runReact({
      messages,
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
    });

    expect(result.stepsUsed).toBe(3);
    expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
  });

  it('should handle no tool call (direct answer)', async () => {
    (mockLLM.call as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createTextResponse('Hello! How can I help?')
    );

    const messages: Message[] = [{ role: 'user', content: 'Hi' }];

    const result = await runReact({
      messages,
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
    });

    expect(result.finalText).toBe('Hello! How can I help?');
    expect(result.stepsUsed).toBe(0);
    expect(result.stopReason).toBe('end_turn');
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  it('should throw MaxStepsExceededError when limit reached', async () => {
    // LLM always wants to use tools
    (mockLLM.call as ReturnType<typeof vi.fn>).mockResolvedValue(
      createToolUseResponse('read', { path: 'test.txt' })
    );

    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      content: 'content',
    });

    const messages: Message[] = [{ role: 'user', content: 'Do something' }];

    await expect(
      runReact({
        messages,
        systemPrompt: '',
        llm: mockLLM,
        executor: mockExecutor,
        ctx: mockCtx,
        maxSteps: 3,
      })
    ).rejects.toThrow(MaxStepsExceededError);

    expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
  });

  it('should continue loop when tool execution fails', async () => {
    // First tool call fails, second succeeds
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'bad.txt' }))
      .mockResolvedValueOnce(createTextResponse('File not found, moving on'));

    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      content: 'File not found',
    });

    const messages: Message[] = [{ role: 'user', content: 'Read file' }];

    const result = await runReact({
      messages,
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
    });

    expect(result.finalText).toBe('File not found, moving on');
    // Should have received error result back to LLM
    const lastCall = (mockLLM.call as ReturnType<typeof vi.fn>).mock.lastCall;
    const lastMessages = lastCall?.[0]?.messages as Message[];
    
    // Check that error was passed back to LLM
    expect(lastMessages?.some(m => {
      const content = Array.isArray(m.content) ? m.content : [];
      return content.some((b: ContentBlock) => b.type === 'tool_result' && (b as any).is_error);
    })).toBe(true);
  });

  it('should modify messages in-place', async () => {
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'test.txt' }))
      .mockResolvedValueOnce(createTextResponse('Done'));

    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      content: 'content',
    });

    const messages: Message[] = [{ role: 'user', content: 'Read' }];
    const initialLength = messages.length;

    await runReact({
      messages,
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
    });

    expect(messages.length).toBeGreaterThan(initialLength);
    // Should have: original user, assistant with tool_use, user with tool_result, final assistant
    expect(messages.length).toBe(4);
  });

  it('should call onToolCallback for each tool execution', async () => {
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'a.txt' }))
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'b.txt' }))
      .mockResolvedValueOnce(createTextResponse('Done'));

    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      content: 'content',
    });

    const toolCalls: string[] = [];

    await runReact({
      messages: [{ role: 'user', content: 'Read files' }],
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
      onToolCall: (name) => toolCalls.push(name),
    });

    expect(toolCalls).toEqual(['read', 'read']);
  });

  it('should call onStepComplete after each step', async () => {
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'a.txt' }))
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'b.txt' }))
      .mockResolvedValueOnce(createTextResponse('Done'));

    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      content: 'content',
    });

    let stepCount = 0;

    await runReact({
      messages: [{ role: 'user', content: 'Read files' }],
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
      onStepComplete: async () => {
        stepCount++;
      },
    });

    expect(stepCount).toBe(2); // 2 tool calls
  });

  it('should continue loop even if onStepComplete fails', async () => {
    (mockLLM.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createToolUseResponse('read', { path: 'test.txt' }))
      .mockResolvedValueOnce(createTextResponse('Done'));

    (mockExecutor.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      content: 'content',
    });

    await runReact({
      messages: [{ role: 'user', content: 'Read' }],
      systemPrompt: '',
      llm: mockLLM,
      executor: mockExecutor,
      ctx: mockCtx,
      onStepComplete: async () => {
        throw new Error('Save failed');
      },
    });

    // Should complete despite onStepComplete failing
    expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
  });
});
