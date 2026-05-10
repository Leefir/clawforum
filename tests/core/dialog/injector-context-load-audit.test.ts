/**
 * ContextInjector — context load audit (phase 646 P1.3)
 *
 * Tests:
 * - FNF silent: AGENTS.md/MEMORY.md not found → 0 audit
 * - non-FNF audit: AGENTS.md read throws PermissionError → audit LOAD_FAILED
 * - contractManager.loadActive throws non-FNF → audit LOAD_FAILED file=contract
 */

import { describe, it, expect, vi } from 'vitest';
import { ContextInjector } from '../../../src/core/dialog/injector.js';
import { FileNotFoundError, PermissionError } from '../../../src/types/errors.js';
import { DIALOG_AUDIT_EVENTS } from '../../../src/foundation/dialog-store/audit-events.js';

describe('ContextInjector — context load audit (phase 646 P1.3)', () => {
  it('FNF silent: AGENTS.md not found → 0 audit', async () => {
    const mockAudit = { write: vi.fn() };
    const mockFs = {
      read: vi.fn().mockRejectedValue(new FileNotFoundError('AGENTS.md')),
    };
    const injector = new ContextInjector({ fs: mockFs as any, audit: mockAudit as any });

    const parts = await injector.buildParts();

    expect(mockAudit.write).not.toHaveBeenCalled();
    expect(parts.agents).toBe('');
  });

  it('non-FNF audit: AGENTS.md read throws PermissionError → audit LOAD_FAILED', async () => {
    const mockAudit = { write: vi.fn() };
    const mockFs = {
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === 'AGENTS.md') throw new PermissionError('denied');
        if (path === 'MEMORY.md') throw new FileNotFoundError('MEMORY.md');
        return '';
      }),
    };
    const injector = new ContextInjector({ fs: mockFs as any, audit: mockAudit as any });

    const parts = await injector.buildParts();

    expect(mockAudit.write).toHaveBeenCalledTimes(1);
    expect(mockAudit.write).toHaveBeenCalledWith(
      DIALOG_AUDIT_EVENTS.LOAD_FAILED,
      'file=AGENTS.md',
      expect.stringContaining('reason='),
    );
    expect(parts.agents).toBe('');
  });

  it('FNF silent: MEMORY.md not found → 0 audit', async () => {
    const mockAudit = { write: vi.fn() };
    const mockFs = {
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === 'AGENTS.md') return '';
        if (path === 'MEMORY.md') throw new FileNotFoundError('MEMORY.md');
        return '';
      }),
    };
    const injector = new ContextInjector({ fs: mockFs as any, audit: mockAudit as any });

    const parts = await injector.buildParts();

    expect(mockAudit.write).not.toHaveBeenCalled();
    expect(parts.memory).toBe('');
  });

  it('non-FNF audit: MEMORY.md read throws PermissionError → audit LOAD_FAILED', async () => {
    const mockAudit = { write: vi.fn() };
    const mockFs = {
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === 'AGENTS.md') return '';
        if (path === 'MEMORY.md') throw new PermissionError('denied');
        return '';
      }),
    };
    const injector = new ContextInjector({ fs: mockFs as any, audit: mockAudit as any });

    const parts = await injector.buildParts();

    expect(mockAudit.write).toHaveBeenCalledTimes(1);
    expect(mockAudit.write).toHaveBeenCalledWith(
      DIALOG_AUDIT_EVENTS.LOAD_FAILED,
      'file=MEMORY.md',
      expect.stringContaining('reason='),
    );
    expect(parts.memory).toBe('');
  });

  it('contractManager.loadActive throws non-FNF → audit LOAD_FAILED file=contract', async () => {
    const mockAudit = { write: vi.fn() };
    const mockFs = {
      read: vi.fn().mockResolvedValue(''),
    };
    const mockContractManager = {
      loadActive: vi.fn().mockRejectedValue(new Error('disk corrupted')),
    };
    const injector = new ContextInjector({
      fs: mockFs as any,
      contractManager: mockContractManager as any,
      audit: mockAudit as any,
    });

    const parts = await injector.buildParts();

    expect(mockAudit.write).toHaveBeenCalledTimes(1);
    expect(mockAudit.write).toHaveBeenCalledWith(
      DIALOG_AUDIT_EVENTS.LOAD_FAILED,
      'file=contract',
      expect.stringContaining('reason='),
    );
    expect(parts.contract).toBe('');
  });

  it('contractManager.loadActive throws FileNotFoundError → silent (0 audit)', async () => {
    const mockAudit = { write: vi.fn() };
    const mockFs = {
      read: vi.fn().mockResolvedValue(''),
    };
    const mockContractManager = {
      loadActive: vi.fn().mockRejectedValue(new FileNotFoundError('contract')),
    };
    const injector = new ContextInjector({
      fs: mockFs as any,
      contractManager: mockContractManager as any,
      audit: mockAudit as any,
    });

    const parts = await injector.buildParts();

    expect(mockAudit.write).not.toHaveBeenCalled();
    expect(parts.contract).toBe('');
  });
});
