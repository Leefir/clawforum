import { describe, it, expect } from 'vitest';
import {
  LLMAuthError,
  LLMModelNotFoundError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMNetworkError,
} from '../../../src/foundation/llm-provider/errors.js';
import { getUserActionHint } from '../../../src/foundation/llm-orchestrator/errors.js';

// phase 1425: 反向 coverage 守 getUserActionHint 对所有 LLMError 子类返回非 null
// （除 base LLMError + 非 LLMError 错走显式 null 设计）

describe('getUserActionHint coverage (phase 1425)', () => {
  it('LLMTimeoutError → check_endpoint', () => {
    expect(getUserActionHint(new LLMTimeoutError('anthropic', 60_000))).toBe('check_endpoint');
  });

  it('LLMNetworkError → check_network', () => {
    expect(getUserActionHint(new LLMNetworkError('openai', new Error('ECONNRESET')))).toBe('check_network');
  });

  it('LLMAuthError with quota keyword → check_quota', () => {
    expect(getUserActionHint(new LLMAuthError('anthropic', 401, 'insufficient credits'))).toBe('check_quota');
  });

  it('LLMAuthError default → rotate_api_key', () => {
    expect(getUserActionHint(new LLMAuthError('anthropic', 401))).toBe('rotate_api_key');
  });

  it('LLMModelNotFoundError → switch_primary', () => {
    expect(getUserActionHint(new LLMModelNotFoundError('anthropic', 'nonexistent-model'))).toBe('switch_primary');
  });

  it('LLMRateLimitError → wait_retry_after', () => {
    expect(getUserActionHint(new LLMRateLimitError('anthropic'))).toBe('wait_retry_after');
  });

  it('non-LLM Error → null (displays as "see audit log" in CLI)', () => {
    expect(getUserActionHint(new Error('unexpected'))).toBeNull();
  });
});
