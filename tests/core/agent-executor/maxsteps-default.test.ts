/**
 * AgentExecutor maxSteps fallback — reverse test for phase 883 B3
 *
 * When caller omits maxSteps, the fallback must be DEFAULT_MAX_STEPS (1000)
 * not the stale 20.
 *
 * phase 221: replaced 23s-per-run "infinite-loop-1000-iterations" assertion with
 * (a) vi.mock that shrinks DEFAULT_MAX_STEPS to 5 → exercises the fallback wiring
 *     (runReact's destructuring default `maxSteps = DEFAULT_MAX_STEPS` is invoked
 *     and the loop terminates after 5 iterations) at ~100ms cost
 * (b) a separate vi.importActual assertion that the real production constant is 1000.
 *
 * Either edit alone passes; both together catch the regressions the original test
 * caught (value drift, fallback unwired, loop ignoring cap) without the 23s cost.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/core/agent-executor/defaults.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/core/agent-executor/defaults.js')>(
    '../../../src/core/agent-executor/defaults.js',
  );
  return { ...actual, DEFAULT_MAX_STEPS: 5 };
});

import { runReact } from '../../../src/core/agent-executor/index.js';
import { MaxStepsExceededError } from '../../../src/core/agent-executor/errors.js';
import type { LLMOrchestrator } from '../../../src/foundation/llm-orchestrator/index.js';
import type { IToolExecutor } from '../../../src/foundation/tools/executor.js';
import { makeExecContext } from '../../helpers/exec-context.js';

function makeInfiniteToolUseLLM(): LLMOrchestrator {
  async function* stream(): AsyncIterableIterator<unknown> {
    yield {
      type: 'tool_use_start',
      toolUse: { id: 't1', name: 'noop', partialInput: '' },
    };
    yield {
      type: 'tool_use_delta',
      toolUse: { id: '', name: '', partialInput: '{}' },
    };
    yield { type: 'done', stopReason: 'tool_use' };
  }
  return {
    call: vi.fn(),
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

describe('AgentExecutor maxSteps fallback (phase 883 B3)', () => {
  it('omitted maxSteps falls back to DEFAULT_MAX_STEPS (mocked to 5; fallback wiring verified)', async () => {
    const llm = makeInfiniteToolUseLLM();

    await expect(
      runReact({
        messages: [],
        systemPrompt: '',
        llm,
        tools: [],
        executor: makeNoopExecutor(),
        ctx: makeExecContext(),
        // intentionally omit maxSteps → exercises the `= DEFAULT_MAX_STEPS` destructuring default
      }),
    ).rejects.toThrow(MaxStepsExceededError);

    // With DEFAULT_MAX_STEPS mocked to 5, the loop must hit exactly the mocked cap.
    expect(llm.stream).toHaveBeenCalledTimes(5);
  });

  it('production DEFAULT_MAX_STEPS value is 1000', async () => {
    const actual = await vi.importActual<typeof import('../../../src/core/agent-executor/defaults.js')>(
      '../../../src/core/agent-executor/defaults.js',
    );
    expect(actual.DEFAULT_MAX_STEPS).toBe(1000);
  });
});
