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

describe('phase 906 Step B1: contract.ts cause chain + ENOENT narrow', () => {
  const contractPath = path.join(__dirname, '../../src/cli/commands/contract.ts');
  const sourceCode = fs.readFileSync(contractPath, 'utf-8');

  it('contractLogCommand catch 块保留 Error cause chain', () => {
    const idx = sourceCode.indexOf('readContractYamlRaw');
    expect(idx).toBeGreaterThan(-1);
    const block = sourceCode.slice(idx, idx + 800);
    // catch (err) 存在
    expect(block).toMatch(/catch\s*\(err\)\s*\{/);
    // { cause: err } 存在（ES2022 Error cause chain）
    expect(block).toContain('{ cause: err }');
    // 旧 reason 拼接模式已移除
    expect(block).not.toContain('err instanceof Error ? err.message : String(err)');
  });

  it('progress read catch narrow 到 ENOENT only', () => {
    const idx = sourceCode.indexOf('progress = await manager.getProgress');
    expect(idx).toBeGreaterThan(-1);
    const block = sourceCode.slice(idx, idx + 600);
    // catch (err) 存在
    expect(block).toMatch(/catch\s*\(err\)\s*\{/);
    // ENOENT narrow 存在
    expect(block).toContain("code !== 'ENOENT'");
    // 非 ENOENT 时 throw err
    expect(block).toContain('throw err');
  });

  it('CliError 类已 align 支持 { cause } 透传', () => {
    const errPath = path.join(__dirname, '../../src/foundation/errors.ts');
    const errCode = fs.readFileSync(errPath, 'utf-8');
    expect(errCode).toContain('cause?: unknown');
    expect(errCode).toContain('super(message, optionsOrCode)');
  });
});
