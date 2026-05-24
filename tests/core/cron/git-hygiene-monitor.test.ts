import { describe, it, expect, vi } from 'vitest';
import { runGitHygieneMonitor } from '../../../src/core/cron/jobs/git-hygiene-monitor.js';
import { CRON_AUDIT_EVENTS } from '../../../src/core/cron/audit-events.js';

const mockExec = vi.fn();

vi.mock('../../../src/foundation/process-exec/index.js', () => ({
  exec: (...args: any[]) => mockExec(...args),
}));

describe('phase 1204 git-hygiene-monitor cron job', () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  // 反向 1：snapshot emit 必发
  it('emits GIT_HYGIENE_SNAPSHOT every run', async () => {
    mockExec.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'worktree') return Promise.resolve({ output: '/tmp/test\n', stderr: '' });
      if (args[0] === 'branch') return Promise.resolve({ output: 'main\nfeature\n', stderr: '' });
      if (args[0] === 'stash') return Promise.resolve({ output: 'stash@{0}\n', stderr: '' });
      return Promise.resolve({ output: '', stderr: '' });
    });

    const audit = { write: vi.fn() };
    await runGitHygieneMonitor({ clawforumDir: '/test', audit: audit as any });
    expect(audit.write).toHaveBeenCalledWith(
      CRON_AUDIT_EVENTS.GIT_HYGIENE_SNAPSHOT,
      expect.stringMatching(/worktree=\d+/),
      expect.stringMatching(/branch=\d+/),
      expect.stringMatching(/stash=\d+/),
      expect.stringMatching(/claude_worktrees=\d+/),
    );
  });

  // 反向 2：超阈值 emit threshold + motion notify
  it('emits threshold event + notifies motion when worktree > 50', async () => {
    // 构造 60 行 worktree list (模拟 60 个 worktree)
    const worktreeLines = Array.from({ length: 60 }, (_, i) => `/tmp/wt${i}`).join('\n') + '\n';
    mockExec.mockImplementation((cmd: string, args: string[]) => {
      if (args[0] === 'worktree') return Promise.resolve({ output: worktreeLines, stderr: '' });
      if (args[0] === 'branch') return Promise.resolve({ output: 'main\n', stderr: '' });
      if (args[0] === 'stash') return Promise.resolve({ output: '', stderr: '' });
      return Promise.resolve({ output: '', stderr: '' });
    });

    const audit = { write: vi.fn() };
    const inbox = { writeSync: vi.fn() };
    await runGitHygieneMonitor({
      clawforumDir: '/test',
      audit: audit as any,
      motionInbox: inbox as any,
      worktreeThreshold: 50,
    });
    expect(audit.write).toHaveBeenCalledWith(
      CRON_AUDIT_EVENTS.GIT_HYGIENE_WORKTREE_THRESHOLD,
      expect.stringContaining('count=60'),
      expect.stringContaining('threshold=50'),
    );
    expect(inbox.writeSync).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('git worktree count 60 > 50'),
    }));
  });

  // 反向 3：git command 失败 best-effort + 不 throw
  it('best-effort on git exec failure (silent fallback)', async () => {
    mockExec.mockRejectedValue(new Error('git not found'));

    const audit = { write: vi.fn() };
    await expect(runGitHygieneMonitor({
      clawforumDir: '/test',
      audit: audit as any,
    })).resolves.not.toThrow();
    // snapshot 仍 emit (0 counts)
    expect(audit.write).toHaveBeenCalledWith(
      CRON_AUDIT_EVENTS.GIT_HYGIENE_SNAPSHOT,
      'worktree=0', 'branch=0', 'stash=0', 'claude_worktrees=0',
    );
  });
});
