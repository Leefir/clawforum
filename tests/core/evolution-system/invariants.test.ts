import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { assertEvolutionStateShape } from '../../../src/core/evolution-system/invariants.js';
import { EvolutionSystem } from '../../../src/core/evolution-system/system.js';
import { RETRO_AUDIT_EVENTS } from '../../../src/core/evolution-system/retro-audit-events.js';
import { NodeFileSystem } from '../../../src/foundation/fs/node-fs.js';

// ============================================================================
// Helpers
// ============================================================================
function createMockAudit() {
  return {
    write: vi.fn(),
    preview: vi.fn((s: string) => s),
    message: vi.fn((s: string) => s),
    summary: vi.fn((s: string) => s),
    __brand: 'AuditLog' as const,
  };
}

async function setupEvolutionSystem(overrides?: {
  stateFileContent?: string;
  processedContractIds?: Set<string>;
}) {
  const tmpBase = path.join(os.tmpdir(), `phase253-${randomUUID()}`);
  const motionDir = path.join(tmpBase, 'motion');
  await fs.mkdir(path.join(motionDir, 'clawspace', 'pending-retrospective', 'by-contract'), { recursive: true });
  await fs.mkdir(path.join(motionDir, 'clawspace', 'dispatch-skills'), { recursive: true });

  if (overrides?.stateFileContent !== undefined) {
    await fs.writeFile(path.join(motionDir, '.evolution-system-state.json'), overrides.stateFileContent);
  }

  const motionFs = new NodeFileSystem({ baseDir: motionDir });
  const mockAudit = createMockAudit();
  const evolutionSystem = new EvolutionSystem({
    fs: motionFs,
    audit: mockAudit as any,
    taskSystem: { schedule: vi.fn().mockResolvedValue('mock-task-id') } as any,
    contractManager: {} as any,
  });

  // 允许通过反射注入 processedContractIds（用于测试非法状态）
  if (overrides?.processedContractIds) {
    (evolutionSystem as any).processedContractIds = overrides.processedContractIds;
  }

  return { motionDir, evolutionSystem, mockAudit };
}

async function cleanup(tmpBase: string) {
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
}

// ============================================================================
// Unit tests: assertEvolutionStateShape
// ============================================================================
describe('evolution-system state save invariant (phase 253 Step A)', () => {
  let mockAudit: ReturnType<typeof createMockAudit>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockAudit = createMockAudit();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('state 根 check', () => {
    it('state=null → emit kind=state_not_object', () => {
      assertEvolutionStateShape(null, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=state_not_object`, `actual=object`,
      );
    });

    it('state=undefined → emit kind=state_not_object', () => {
      assertEvolutionStateShape(undefined, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=state_not_object`, `actual=undefined`,
      );
    });

    it('state=string → emit kind=state_not_object', () => {
      assertEvolutionStateShape('bad', mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=state_not_object`, `actual=string`,
      );
    });
  });

  describe('version', () => {
    it('version=1 → 0 emit', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      const calls = mockAudit.write.mock.calls.filter(c => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED);
      expect(calls).toHaveLength(0);
    });

    it('version="1" 字符串 → emit kind=version_not_number', () => {
      assertEvolutionStateShape({ version: '1', processedContractIds: [], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=version_not_number`, `actual=string`,
      );
    });

    it('version=2 → emit kind=version_mismatch', () => {
      assertEvolutionStateShape({ version: 2, processedContractIds: [], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=version_mismatch`, `actual=2`, `expected=1`,
      );
    });

    it('version=undefined → emit kind=version_not_number', () => {
      assertEvolutionStateShape({ processedContractIds: [], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=version_not_number`, `actual=undefined`,
      );
    });
  });

  describe('processedContractIds', () => {
    it('空数组 → 0 emit', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      const calls = mockAudit.write.mock.calls.filter(c => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED);
      expect(calls).toHaveLength(0);
    });

    it('合法 string[] → 0 emit', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: ['a', 'b'], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      const calls = mockAudit.write.mock.calls.filter(c => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED);
      expect(calls).toHaveLength(0);
    });

    it('非数组 → emit kind=processedContractIds_not_array', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: 'oops', lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=processedContractIds_not_array`, `actual=string`,
      );
    });

    it('含非 string → emit kind=processedContractIds_element_not_string + idx', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: ['a', 123, 'b'], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=processedContractIds_element_not_string`,
        `idx=1`, `actual=number`,
      );
    });

    it('含 1 个 duplicate → emit kind=processedContractIds_duplicate', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: ['a', 'a'], lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=processedContractIds_duplicate`,
        `dup_ids=a`, `dup_count=1`,
      );
    });

    it('含多个 duplicate → emit + dup_ids 截断前 5', () => {
      const ids = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd', 'e', 'e', 'f', 'f'];
      assertEvolutionStateShape({ version: 1, processedContractIds: ids, lastProcessedAt: new Date().toISOString() }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=processedContractIds_duplicate`,
        `dup_ids=a,b,c,d,e`, `dup_count=6`,
      );
    });
  });

  describe('lastProcessedAt', () => {
    it('合法 ISO timestamp → 0 emit', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: '2026-06-10T12:00:00Z' }, mockAudit as any);
      const calls = mockAudit.write.mock.calls.filter(c => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED);
      expect(calls).toHaveLength(0);
    });

    it('合法带毫秒 ISO → 0 emit', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: '2026-06-10T12:00:00.123Z' }, mockAudit as any);
      const calls = mockAudit.write.mock.calls.filter(c => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED);
      expect(calls).toHaveLength(0);
    });

    it('合法带时区 ISO → 0 emit', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: '2026-06-10T12:00:00+08:00' }, mockAudit as any);
      const calls = mockAudit.write.mock.calls.filter(c => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED);
      expect(calls).toHaveLength(0);
    });

    it('非 string → emit kind=lastProcessedAt_not_string', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: 123 }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=lastProcessedAt_not_string`, `actual=number`,
      );
    });

    it('错格式 "2026-01-01" → emit kind=lastProcessedAt_not_iso', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: '2026-01-01' }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=lastProcessedAt_not_iso`, `actual=2026-01-01`,
      );
    });

    it('错格式 "abc" → emit kind=lastProcessedAt_not_iso', () => {
      assertEvolutionStateShape({ version: 1, processedContractIds: [], lastProcessedAt: 'abc' }, mockAudit as any);
      expect(mockAudit.write).toHaveBeenCalledWith(
        RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED,
        `kind=lastProcessedAt_not_iso`, `actual=abc`,
      );
    });
  });

  describe('_saveState 集成', () => {
    let fixtures: Awaited<ReturnType<typeof setupEvolutionSystem>>;

    afterEach(async () => {
      if (fixtures?.motionDir) {
        await cleanup(path.dirname(fixtures.motionDir));
      }
    });

    it('合法路径（构造 data 后调）→ 0 emit + 文件落盘', async () => {
      fixtures = await setupEvolutionSystem();
      const { motionDir, evolutionSystem, mockAudit } = fixtures;

      // 通过 _saveState 的公开触发路径：反射调用
      await (evolutionSystem as any)._saveState();

      const statePath = path.join(motionDir, '.evolution-system-state.json');
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content);
      expect(state.version).toBe(1);
      expect(state.processedContractIds).toEqual([]);

      const invariantCalls = mockAudit.write.mock.calls.filter(
        (c: any[]) => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED
      );
      expect(invariantCalls).toHaveLength(0);
    });

    it('非法 state（手动 mutate processedContractIds 注入非 string）→ 文件仍落盘 + audit emit', async () => {
      fixtures = await setupEvolutionSystem({
        processedContractIds: new Set(['a', 'b']),
      });
      const { motionDir, evolutionSystem, mockAudit } = fixtures;

      // 通过反射将 processedContractIds 改成非法值
      const badSet = new Set<any>(['a', 123, 'b']);
      (evolutionSystem as any).processedContractIds = badSet;

      await (evolutionSystem as any)._saveState();

      // 文件仍落盘
      const statePath = path.join(motionDir, '.evolution-system-state.json');
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content);
      expect(state.processedContractIds).toContain('a');

      // audit emit
      const invariantCalls = mockAudit.write.mock.calls.filter(
        (c: any[]) => c[0] === RETRO_AUDIT_EVENTS.EVOLUTION_STATE_INVARIANT_VIOLATED
      );
      expect(invariantCalls.length).toBeGreaterThanOrEqual(1);
      expect(invariantCalls.some((c: any[]) =>
        c.some((arg: any) => String(arg).includes('processedContractIds_element_not_string'))
      )).toBe(true);
    });
  });
});
