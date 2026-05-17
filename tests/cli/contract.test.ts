import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../src/cli/utils/factories.js', () => ({
  createDirContext: vi.fn(() => ({
    fs: {
      appendSync: vi.fn(() => { throw new Error('disk full'); }),
    },
    audit: { write: vi.fn() },
  })),
}));

vi.mock('../../src/foundation/messaging/index.js', () => ({
  notifySystem: vi.fn(),
}));

import { notifyContractCreated } from '../../src/cli/commands/contract.js';
import { createDirContext } from '../../src/cli/utils/factories.js';

describe('notifyContractCreated audit observability', () => {
  it('audit includes contractId on append failure', () => {
    const audit = { write: vi.fn() };
    (createDirContext as any).mockReturnValue({
      fs: {
        appendSync: vi.fn(() => { throw new Error('disk full'); }),
      },
      audit,
    });

    const contract = {
      title: 'Test Contract',
      goal: 'test goal',
      subtasks: [{ id: 't1', description: 'd1' }],
    } as any;

    notifyContractCreated('/tmp/claw', 'claw-1', 'test-contract-001', contract);

    expect(audit.write).toHaveBeenCalledWith(
      'stream_append_failed',
      'context=contract_notify',
      'contractId=test-contract-001',
      expect.stringMatching(/reason=disk full/),
    );
  });
});

describe('phase 904 site 3: contract show catch err 含原因', () => {
  it('contractLogCommand catch 块将原 err.message 拼入 CliError message', () => {
    const contractPath = path.join(__dirname, '../../src/cli/commands/contract.ts');
    const sourceCode = fs.readFileSync(contractPath, 'utf-8');
    // 定位 readContractYamlRaw 段
    const idx = sourceCode.indexOf('readContractYamlRaw');
    expect(idx).toBeGreaterThan(-1);
    const block = sourceCode.slice(idx, idx + 800);
    // catch (err) 存在
    expect(block).toMatch(/catch\s*\(err\)\s*\{/);
    // err.message 被提取并拼入 CliError
    expect(block).toContain('err instanceof Error ? err.message : String(err)');
    expect(block).toContain('not found or unreadable');
  });
});
