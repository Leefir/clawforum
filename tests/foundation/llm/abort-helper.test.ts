import { describe, it, expect, vi } from 'vitest';
import { withCombinedAbortSignal } from '../../../src/foundation/llm/abort-helper.js';

describe('withCombinedAbortSignal', () => {
  it('aborts when timeout elapses', async () => {
    const [handle, cleanup] = withCombinedAbortSignal(undefined, 10);
    await new Promise(r => setTimeout(r, 20));
    expect(handle.signal.aborted).toBe(true);
    cleanup();
  });

  it('aborts when external signal triggers', () => {
    const external = new AbortController();
    const [handle, cleanup] = withCombinedAbortSignal(external.signal, 10_000);
    external.abort();
    expect(handle.signal.aborted).toBe(true);
    cleanup();
  });

  it('does not abort if neither fires', () => {
    const [handle, cleanup] = withCombinedAbortSignal(undefined, 10_000);
    expect(handle.signal.aborted).toBe(false);
    cleanup();
  });

  it('cleanup removes listener from external signal', () => {
    const external = new AbortController();
    const addSpy = vi.spyOn(external.signal, 'addEventListener');
    const removeSpy = vi.spyOn(external.signal, 'removeEventListener');
    const [, cleanup] = withCombinedAbortSignal(external.signal, 10_000);
    expect(addSpy).toHaveBeenCalledTimes(1);
    cleanup();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('cleanup clears timeout (no abort after cleanup)', async () => {
    const [handle, cleanup] = withCombinedAbortSignal(undefined, 10);
    cleanup();
    await new Promise(r => setTimeout(r, 20));
    expect(handle.signal.aborted).toBe(false);
  });

  it('manual abort() triggers signal', () => {
    const [handle, cleanup] = withCombinedAbortSignal(undefined, 10_000);
    handle.abort();
    expect(handle.signal.aborted).toBe(true);
    cleanup();
  });

  it('clearInternalTimeout prevents timeout abort', async () => {
    const [handle, cleanup] = withCombinedAbortSignal(undefined, 10);
    handle.clearInternalTimeout();
    await new Promise(r => setTimeout(r, 20));
    expect(handle.signal.aborted).toBe(false);
    cleanup();
  });
});
