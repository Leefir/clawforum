/**
 * ask-caller LATENT阻断 reverse tests (phase 1182 / r129 C fork)
 *
 * Per phase 1182 Step B plan §4.2:
 * - reverse 1: success:false + error=latent_not_implemented + content 含 LATENT / 不含 <TODO
 * - reverse 2: content 含 sunset triggers reference
 */
import { describe, it, expect, vi } from 'vitest';
import { createAskCallerTool } from '../../../../src/core/async-task-system/tools/ask-caller.js';
import type { ExecContext } from '../../../../src/foundation/tool-protocol/index.js';
import type { DialogStore } from '../../../../src/foundation/dialog-store/index.js';

function makeCtx(overrides: Partial<ExecContext> = {}): ExecContext {
  return { ...overrides } as ExecContext;
}

describe('phase 1182 r129 C fork: ask_caller LATENT阻断', () => {
  it('reverse 1: ask_caller 调用返 success:false + error=latent_not_implemented', async () => {
    const mainDialogStore = { restorePrefix: vi.fn().mockResolvedValue({ systemPrompt: '', messages: [] }) };
    const tool = createAskCallerTool({
      mainDialogStore: mainDialogStore as unknown as DialogStore,
      mainContextSnapshot: { clawId: 'claw-1', toolUseId: 'tu-1' },
    });
    const result = await tool.execute({ question: 'test' }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toBe('latent_not_implemented');
    expect(result.content).toMatch(/LATENT/);
    expect(result.content).not.toMatch(/<TODO/); // 确保不再返字面 TODO
  });

  it('reverse 2: ask_caller 返 content 含 sunset triggers reference', async () => {
    const mainDialogStore = { restorePrefix: vi.fn().mockResolvedValue({ systemPrompt: '', messages: [] }) };
    const tool = createAskCallerTool({
      mainDialogStore: mainDialogStore as unknown as DialogStore,
      mainContextSnapshot: { clawId: 'claw-1', toolUseId: 'tu-1' },
    });
    const result = await tool.execute({ question: 'test' }, makeCtx());
    expect(result.content).toMatch(/sunset|behavior\.md|phase1182/i);
  });
});
