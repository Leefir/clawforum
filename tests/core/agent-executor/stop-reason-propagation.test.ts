/**
 * ReactResult.stopReason propagation — phase 1483
 *
 * 守护：loop.mapStopReason 把 step-executor 的 FinalStopReason 正确投射到 ReactResult.stopReason，
 * 其中 'content_filter' 字面单独保留（不再折叠为 'unknown'）— audit-2026-05-30 finding #3 修复。
 */

import { describe, it, expect, vi } from 'vitest';
import { runReact } from '../../../src/core/agent-executor/index.js';
import type { LLMOrchestrator } from '../../../src/foundation/llm-orchestrator/index.js';
import type { LLMResponse } from '../../../src/foundation/llm-provider/types.js';
import type { IToolExecutor } from '../../../src/foundation/tools/executor.js';
import { makeExecContext } from '../../helpers/exec-context.js';

function makeLLMWithStopReason(stopReason: string): LLMOrchestrator {
  async function* stream(): AsyncIterableIterator<unknown> {
    yield { type: 'text_delta', delta: 'hi' };
    yield { type: 'done', stopReason };
  }
  return {
    call: vi.fn(async () => ({
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: stopReason,
      usage: { input_tokens: 1, output_tokens: 1 },
    } satisfies LLMResponse)),
    stream: vi.fn(() => stream()),
    healthCheck: vi.fn(async () => true),
    getProviderInfo: vi.fn(() => ({ name: 'mock', model: 'mock-model', isFallback: false })),
    close: vi.fn(),
  } as unknown as LLMOrchestrator;
}

function makeNoopExecutor(): IToolExecutor {
  return {
    execute: vi.fn(async () => ({ success: true, content: 'ok' })),
    executeParallel: vi.fn(),
    validateArgs: vi.fn(),
  } as unknown as IToolExecutor;
}

async function runWithStopReason(stopReason: string): Promise<string> {
  const result = await runReact({
    messages: [],
    systemPrompt: '',
    llm: makeLLMWithStopReason(stopReason),
    tools: [],
    executor: makeNoopExecutor(),
    ctx: makeExecContext(),
    onUnparseableToolUse: () => {},
  });
  return result.stopReason;
}

describe('ReactResult.stopReason propagation (phase 1483 #3 content_filter 不折叠)', () => {
  it('LLM unrecognized stop_reason → step-executor 映射 content_filter → ReactResult 保留 content_filter', async () => {
    // step-executor.ts:65 把任何 unrecognized stop_reason 映射为 'content_filter'；
    // phase 1483 前 loop.mapStopReason 把 content_filter 折叠为 'unknown'、丢信息；
    // phase 1483 后保留 'content_filter' 字面。
    expect(await runWithStopReason('refusal')).toBe('content_filter');
  });

  it('end_turn → end_turn', async () => {
    expect(await runWithStopReason('end_turn')).toBe('end_turn');
  });

  it('stop → end_turn（向后兼容 shim）', async () => {
    expect(await runWithStopReason('stop')).toBe('end_turn');
  });
});
