/**
 * phase 320 Step A: LLMOrchestratorImpl.reloadConfig — 原地替换 primary/fallbacks/breakers，对象引用不变。
 */

import { describe, it, expect } from 'vitest';
import { LLMOrchestratorImpl } from '../../../src/foundation/llm-orchestrator/orchestrator.js';
import type {
  LLMEventSink,
  LLMEvent,
  LLMResponse,
} from '../../../src/foundation/llm-orchestrator/types.js';

function createSink() {
  const emitted: LLMEvent[] = [];
  const sink: LLMEventSink = { emit(e: LLMEvent) { emitted.push(e); } };
  return { sink, emitted };
}

describe('phase 320 Step A: reloadConfig', () => {
  it('reload 后 primary 指向新 provider config', async () => {
    const { sink } = createSink();
    const orch = new LLMOrchestratorImpl({
      primary: { name: 'p1', apiKey: 'k1', model: 'm1', apiFormat: 'anthropic' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    const beforePrimary = (orch as any).primary;
    expect(beforePrimary.name).toBe('p1');

    orch.reloadConfig({
      primary: { name: 'p2', apiKey: 'k2', model: 'm2', apiFormat: 'openai' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    const afterPrimary = (orch as any).primary;
    expect(afterPrimary.name).toBe('p2');
    expect(afterPrimary).not.toBe(beforePrimary);
  });

  it('reload 不换 orchestrator 对象引用（持有引用的调用方自动看到新 provider）', () => {
    const { sink } = createSink();
    const orch = new LLMOrchestratorImpl({
      primary: { name: 'p1', apiKey: 'k1', model: 'm1', apiFormat: 'anthropic' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    const ref: { llm: LLMOrchestratorImpl } = { llm: orch };

    ref.llm.reloadConfig({
      primary: { name: 'p2', apiKey: 'k2', model: 'm2', apiFormat: 'openai' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    expect(ref.llm).toBe(orch);
    expect((ref.llm as any).primary.name).toBe('p2');
  });

  it('fallbacks 数量变更：1 → 0', () => {
    const { sink } = createSink();
    const orch = new LLMOrchestratorImpl({
      primary: { name: 'p1', apiKey: 'k1', model: 'm1', apiFormat: 'anthropic' },
      fallbacks: [
        { name: 'fb1', apiKey: 'kfb', model: 'mfb', apiFormat: 'openai' },
      ],
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    expect((orch as any).fallbacks.length).toBe(1);

    orch.reloadConfig({
      primary: { name: 'p1', apiKey: 'k1', model: 'm1', apiFormat: 'anthropic' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    expect((orch as any).fallbacks.length).toBe(0);
  });

  it('circuitBreaker 重建：reload 后 breakers 数 = 1 + fallbacks 数', () => {
    const { sink } = createSink();
    const orch = new LLMOrchestratorImpl({
      primary: { name: 'p1', apiKey: 'k1', model: 'm1', apiFormat: 'anthropic' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000 },
    });

    expect((orch as any).breakers.length).toBe(1);

    orch.reloadConfig({
      primary: { name: 'p2', apiKey: 'k2', model: 'm2', apiFormat: 'openai' },
      fallbacks: [
        { name: 'fb1', apiKey: 'kfb1', model: 'mfb1', apiFormat: 'anthropic' },
        { name: 'fb2', apiKey: 'kfb2', model: 'mfb2', apiFormat: 'openai' },
      ],
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1000 },
    });

    expect((orch as any).breakers.length).toBe(3);
  });

  it('events sink 引用保持（reload 不换 events）', () => {
    const { sink } = createSink();
    const orch = new LLMOrchestratorImpl({
      primary: { name: 'p1', apiKey: 'k1', model: 'm1', apiFormat: 'anthropic' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });

    const eventsBefore = (orch as any).events;
    orch.reloadConfig({
      primary: { name: 'p2', apiKey: 'k2', model: 'm2', apiFormat: 'openai' },
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });
    const eventsAfter = (orch as any).events;
    expect(eventsAfter).toBe(eventsBefore);
  });

  it('sdkClientCache 命中：reload 切回旧 config 时 cache hit、复用同一 provider 实例', () => {
    const { sink, emitted } = createSink();
    const cfgA = { name: 'pA', apiKey: 'kA', model: 'mA', apiFormat: 'anthropic' as const };
    const cfgB = { name: 'pB', apiKey: 'kB', model: 'mB', apiFormat: 'openai' as const };

    const orch = new LLMOrchestratorImpl({
      primary: cfgA,
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });
    const pA = (orch as any).primary;

    orch.reloadConfig({
      primary: cfgB,
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });
    const pB = (orch as any).primary;
    expect(pB).not.toBe(pA);

    orch.reloadConfig({
      primary: cfgA,
      maxAttempts: 1,
      retryDelayMs: 0,
      events: sink,
    });
    const pA2 = (orch as any).primary;
    expect(pA2).toBe(pA);  // 同实例（cache hit）

    const hits = emitted.filter(e => e.type === 'sdk_client_cache_hit');
    expect(hits.length).toBeGreaterThan(0);
  });
});
