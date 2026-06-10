/**
 * Phase 233 Step B: contract progress cross-source audit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { auditProgressCrossSource } from '../../../src/core/contract/cross-source-audit.js';
import { CONTRACT_AUDIT_EVENTS } from '../../../src/core/contract/audit-events.js';
import { makeMockAudit } from '../../helpers/audit.js';
import { ContractSystem } from '../../../src/core/contract/manager.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';
import { createToolRegistry } from '../../../src/foundation/tools/index.js';
import { makeContractYaml } from '../../helpers/contract-yaml.js';

function makeProgress(overrides: Record<string, unknown> = {}): Parameters<typeof auditProgressCrossSource>[0] {
  return {
    schema_version: 1,
    contract_id: 'test-contract',
    status: 'running',
    subtasks: {
      t1: { status: 'todo' },
      t2: { status: 'in_progress' },
    },
    ...overrides,
  } as any;
}

function makeYaml(overrides: Record<string, unknown> = {}): NonNullable<Parameters<typeof auditProgressCrossSource>[1]> {
  return {
    schema_version: 1,
    id: 'test-contract',
    title: 'Test',
    goal: 'Test',
    subtasks: [
      { id: 't1', description: 'T1' },
      { id: 't2', description: 'T2' },
    ],
    ...overrides,
  } as any;
}

describe('contract progress cross-source audit (phase 233 Step B)', () => {
  describe('CS-1: completed implies all subtasks completed', () => {
    it('status=completed + all subtasks completed → 0 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'completed', subtasks: { t1: { status: 'completed' }, t2: { status: 'completed' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }), audit);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('status=completed + 1 subtask todo → emit cs1', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'completed', subtasks: { t1: { status: 'completed' }, t2: { status: 'todo' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }), audit);
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH);
      expect(call).toContainEqual(expect.stringContaining('kind=cs1_completed_but_subtasks_not'));
      expect(call).toContainEqual(expect.stringContaining('not_completed_count=1'));
      expect(call).toContainEqual(expect.stringContaining('not_completed_ids=t2'));
    });

    it('status=running → 不 trigger CS-1（独立维度）', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'running', subtasks: { t1: { status: 'todo' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      const cs1Calls = (audit.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c.some((s: string) => s.includes('cs1_')),
      );
      expect(cs1Calls).toHaveLength(0);
    });
  });

  describe('CS-2: running implies some subtask not completed', () => {
    it('status=running + 1 subtask in_progress → 0 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'running', subtasks: { t1: { status: 'in_progress' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('status=running + all subtasks completed → emit cs2', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'running', subtasks: { t1: { status: 'completed' }, t2: { status: 'completed' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }), audit);
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH);
      expect(call).toContainEqual(expect.stringContaining('kind=cs2_running_but_all_subtasks_completed'));
    });

    it('status=running + 0 subtasks → 0 emit (edge case)', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'running', subtasks: {} }), makeYaml({ subtasks: [] }), audit);
      expect(audit.write).not.toHaveBeenCalled();
    });
  });

  describe('CS-3: force_accepted implies completed', () => {
    it('force_accepted=true + status=completed → 0 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'completed', subtasks: { t1: { status: 'completed', force_accepted: true } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('force_accepted=true + status=todo → emit cs3', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'pending', subtasks: { t1: { status: 'todo', force_accepted: true } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH);
      expect(call).toContainEqual(expect.stringContaining('kind=cs3_force_accepted_but_not_completed'));
      expect(call).toContainEqual(expect.stringContaining('subtask_id=t1'));
      expect(call).toContainEqual(expect.stringContaining('actual_status=todo'));
    });
  });

  describe('CS-4: completed_at implies completed', () => {
    it('completed_at set + status=completed → 0 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'completed', subtasks: { t1: { status: 'completed', completed_at: '2024-01-01' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('completed_at set + status=in_progress → emit cs4', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ status: 'pending', subtasks: { t1: { status: 'in_progress', completed_at: '2024-01-01' } } }), makeYaml({ subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH);
      expect(call).toContainEqual(expect.stringContaining('kind=cs4_completed_at_but_not_completed'));
      expect(call).toContainEqual(expect.stringContaining('subtask_id=t1'));
      expect(call).toContainEqual(expect.stringContaining('actual_status=in_progress'));
      expect(call).toContainEqual(expect.stringContaining('completed_at=2024-01-01'));
    });
  });

  describe('yaml-dep-1: contract_id match', () => {
    it('yaml.id === progress.contract_id → 0 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ contract_id: 'cid-1', subtasks: { t1: { status: 'todo' } } }), makeYaml({ id: 'cid-1', subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('yaml.id !== progress.contract_id → emit yaml_id_mismatch', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ contract_id: 'cid-1', subtasks: { t1: { status: 'todo' } } }), makeYaml({ id: 'cid-2', subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH);
      expect(call).toContainEqual(expect.stringContaining('kind=yaml_id_mismatch'));
      expect(call).toContainEqual(expect.stringContaining('progress_contract_id=cid-1'));
      expect(call).toContainEqual(expect.stringContaining('yaml_id=cid-2'));
    });

    it('yaml.id undefined → 不 trigger（允许 yaml 不写 id）', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress({ contract_id: 'cid-1', subtasks: { t1: { status: 'todo' } } }), makeYaml({ id: undefined, subtasks: [{ id: 't1', description: 'D1' }] }), audit);
      const mismatchCalls = (audit.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      );
      expect(mismatchCalls).toHaveLength(0);
    });
  });

  describe('yaml-dep-2: subtask id set equality', () => {
    it('集合相等 → 0 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(
        makeProgress({ status: 'pending', subtasks: { t1: { status: 'todo' }, t2: { status: 'todo' } } }),
        makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }),
        audit,
      );
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('progress 多 1 subtask → emit + only_in_progress 字段', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(
        makeProgress({ status: 'pending', subtasks: { t1: { status: 'todo' }, t2: { status: 'todo' }, t3: { status: 'todo' } } }),
        makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }),
        audit,
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call).toContainEqual(expect.stringContaining('kind=yaml_subtask_id_set_mismatch'));
      expect(call).toContainEqual(expect.stringContaining('only_in_progress=t3'));
      expect(call).toContainEqual(expect.stringContaining('only_in_yaml='));
    });

    it('yaml 多 1 subtask → emit + only_in_yaml 字段', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(
        makeProgress({ status: 'pending', subtasks: { t1: { status: 'todo' } } }),
        makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }),
        audit,
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call).toContainEqual(expect.stringContaining('only_in_progress='));
      expect(call).toContainEqual(expect.stringContaining('only_in_yaml=t2'));
    });

    it('两侧各多 → both 字段 emit', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(
        makeProgress({ status: 'pending', subtasks: { t1: { status: 'todo' }, t3: { status: 'todo' } } }),
        makeYaml({ subtasks: [{ id: 't1', description: 'D1' }, { id: 't2', description: 'D2' }] }),
        audit,
      );
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call).toContainEqual(expect.stringContaining('only_in_progress=t3'));
      expect(call).toContainEqual(expect.stringContaining('only_in_yaml=t2'));
    });
  });

  describe('yaml=null skip', () => {
    it('yaml unavailable → emit cross_source_skipped + 跳 yaml-dep check', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(makeProgress(), null, audit);
      expect(audit.write).toHaveBeenCalledTimes(1);
      const call = (audit.write as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_SKIPPED);
      expect(call).toContainEqual(expect.stringContaining('reason=yaml_unavailable'));
    });

    it('yaml=null + CS-1/2/3/4 仍跑', () => {
      const audit = makeMockAudit();
      auditProgressCrossSource(
        makeProgress({ status: 'completed', subtasks: { t1: { status: 'todo' } } }),
        null,
        audit,
      );
      const calls = (audit.write as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(2); // CS-1 + skipped
      expect(calls[0][0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH);
      expect(calls[0]).toContainEqual(expect.stringContaining('kind=cs1_completed_but_subtasks_not'));
      expect(calls[1][0]).toBe(CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_SKIPPED);
    });
  });

  describe('saveProgress 集成', () => {
    let tmpDir: string;
    let clawDir: string;

    beforeEach(async () => {
      tmpDir = path.join(os.tmpdir(), `.test-phase233-b-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
      clawDir = path.join(tmpDir, 'claws', 'test-claw');
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(clawDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('合法 progress + yaml → 0 emit + 文件落盘', async () => {
      const mockAudit = makeMockAudit();
      const nodeFs = new NodeFileSystem({ baseDir: clawDir });
      const manager = new ContractSystem({
        clawDir,
        clawId: 'test-claw',
        fs: nodeFs,
        audit: mockAudit as any,
        toolRegistry: createToolRegistry(),
        fsFactory: (dir: string) => new NodeFileSystem({ baseDir: dir }),
        clawsDir: '/tmp/test/claws',
        notifyClaw: vi.fn(),
      });

      const contractId = await manager.create(makeContractYaml({
        title: 'Test',
        goal: 'Test',
        subtasks: [{ id: 't1', description: 'T1' }],
        verification: [],
      }));

      // saveProgress 会调用 cross-source audit，合法数据应 0 emit
      const badCalls = (mockAudit.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH
          || c[0] === CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_SKIPPED,
      );
      expect(badCalls).toHaveLength(0);
    });

    it('CS-1 违例 progress → 文件仍落盘 + audit emit', async () => {
      const mockAudit = makeMockAudit();
      const nodeFs = new NodeFileSystem({ baseDir: clawDir });
      const manager = new ContractSystem({
        clawDir,
        clawId: 'test-claw',
        fs: nodeFs,
        audit: mockAudit as any,
        toolRegistry: createToolRegistry(),
        fsFactory: (dir: string) => new NodeFileSystem({ baseDir: dir }),
        clawsDir: '/tmp/test/claws',
        notifyClaw: vi.fn(),
      });

      const contractId = await manager.create(makeContractYaml({
        title: 'Test',
        goal: 'Test',
        subtasks: [{ id: 't1', description: 'T1' }],
        verification: [],
      }));

      const progressPath = path.join(clawDir, 'contract', 'active', contractId, 'progress.json');
      await fs.writeFile(progressPath, JSON.stringify({
        schema_version: 1,
        contract_id: contractId,
        status: 'completed',
        subtasks: { t1: { status: 'todo' } },
      }), 'utf-8');

      const progress = await manager.getProgress(contractId);
      expect(progress).not.toBeNull();
      await manager.saveProgress(contractId, progress as any);

      const mismatchCalls = (mockAudit.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_MISMATCH,
      );
      expect(mismatchCalls.length).toBeGreaterThanOrEqual(1);
      expect(mismatchCalls.some((c: any[]) => c.some((s: string) => s.includes('kind=cs1_completed_but_subtasks_not')))).toBe(true);

      const saved = JSON.parse(await fs.readFile(progressPath, 'utf-8'));
      expect(saved.status).toBe('completed');
    });

    it('yaml load fail → emit _skipped + 文件仍落盘', async () => {
      const mockAudit = makeMockAudit();
      const nodeFs = new NodeFileSystem({ baseDir: clawDir });
      const manager = new ContractSystem({
        clawDir,
        clawId: 'test-claw',
        fs: nodeFs,
        audit: mockAudit as any,
        toolRegistry: createToolRegistry(),
        fsFactory: (dir: string) => new NodeFileSystem({ baseDir: dir }),
        clawsDir: '/tmp/test/claws',
        notifyClaw: vi.fn(),
      });

      const contractId = await manager.create(makeContractYaml({
        title: 'Test',
        goal: 'Test',
        subtasks: [{ id: 't1', description: 'T1' }],
        verification: [],
      }));

      // 删除 contract.yaml 使 yaml load 失败
      const yamlPath = path.join(clawDir, 'contract', 'active', contractId, 'contract.yaml');
      await fs.rm(yamlPath);

      const progress = await manager.getProgress(contractId);
      expect(progress).not.toBeNull();
      await manager.saveProgress(contractId, progress as any);

      const skippedCalls = (mockAudit.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_SKIPPED,
      );
      expect(skippedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('ctx 未注入 getContractYaml → 自动 skip + 跳 yaml-dep check', async () => {
      const mockAudit = makeMockAudit();
      const { saveProgress } = await import('../../../src/core/contract/persistence.js');
      const fsMock = {
        writeAtomic: vi.fn(),
      };
      await saveProgress(
        {
          fs: fsMock as any,
          audit: mockAudit as any,
          contractDir: async () => '/tmp/contracts',
          getProgress: async () => null,
          // 未注入 getContractYaml
        },
        'test-contract',
        makeProgress() as any,
      );

      const skippedCalls = (mockAudit.write as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[0] === CONTRACT_AUDIT_EVENTS.CONTRACT_PROGRESS_CROSS_SOURCE_SKIPPED,
      );
      expect(skippedCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
