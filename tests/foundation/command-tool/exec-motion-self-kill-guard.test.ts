/**
 * exec tool motion-chain self-kill guard (phase 1473).
 *
 * Reject `chestnut stop` / `chestnut motion stop` when ctx.isMotionChain
 * is true. Without the guard, motion would SIGTERM itself, lose the
 * in-flight tool result, and re-issue the command on restart → infinite loop.
 */
import { describe, it, expect, vi } from 'vitest';
import { execTool } from '../../../src/foundation/command-tool/exec.js';
import { makeExecContext } from '../../helpers/exec-context.js';
import { makeMockAudit } from '../../helpers/audit.js';

const BLOCKED_MESSAGE = 'motion-chain cannot exec `chestnut stop`';

describe('phase 1473 exec motion-chain self-kill guard', () => {
  it('blocks `chestnut stop` for motion-chain caller', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: true, auditWriter: audit });

    const result = await execTool.execute({ command: 'chestnut stop' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toContain(BLOCKED_MESSAGE);
    expect(audit.write).toHaveBeenCalledWith(
      'exec_motion_self_kill_blocked',
      'clawId=test-claw',
      'command=chestnut stop',
    );
  });

  it('blocks `chestnut motion stop` for motion-chain caller', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: true, auditWriter: audit });

    const result = await execTool.execute({ command: 'chestnut motion stop' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toContain(BLOCKED_MESSAGE);
    expect(audit.write).toHaveBeenCalledOnce();
  });

  it('blocks even when wrapped (e.g. `pnpm exec chestnut stop`, leading args)', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: true, auditWriter: audit });

    const result = await execTool.execute(
      { command: 'pnpm exec chestnut stop' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(audit.write).toHaveBeenCalledOnce();
  });

  it('does NOT block `chestnut watchdog stop` (out of guard scope)', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: true, auditWriter: audit });

    const result = await execTool.execute(
      { command: 'chestnut watchdog stop' },
      ctx,
    );

    // guard did not fire → no audit emit for blocked event + not the guard message
    expect(audit.write).not.toHaveBeenCalledWith(
      'exec_motion_self_kill_blocked',
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).not.toContain(BLOCKED_MESSAGE);
  });

  it('does NOT block `chestnut status` (read-only)', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: true, auditWriter: audit });

    const result = await execTool.execute({ command: 'chestnut status' }, ctx);

    expect(audit.write).not.toHaveBeenCalledWith(
      'exec_motion_self_kill_blocked',
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).not.toContain(BLOCKED_MESSAGE);
  });

  it('does NOT block non-motion claw (only motion-chain is in scope)', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: false, auditWriter: audit });

    const result = await execTool.execute({ command: 'chestnut stop' }, ctx);

    expect(audit.write).not.toHaveBeenCalledWith(
      'exec_motion_self_kill_blocked',
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).not.toContain(BLOCKED_MESSAGE);
  });

  it('delegates long command truncation to auditWriter.message (cap 200 chars)', async () => {
    const audit = makeMockAudit();
    const ctx = makeExecContext({ isMotionChain: true, auditWriter: audit });
    const longSuffix = 'a'.repeat(500);
    const longCommand = `chestnut stop ${longSuffix}`;

    await execTool.execute({ command: longCommand }, ctx);

    expect(audit.message).toHaveBeenCalledWith(longCommand);
    const writeCall = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall[0]).toBe('exec_motion_self_kill_blocked');
  });
});
