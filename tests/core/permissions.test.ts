/**
 * Permission matrix tests
 * 
 * Tests tool permissions across different profiles:
 * - readonly: only read tools allowed
 * - subagent: no send/done/spawn
 * - dream: read-only tools only
 * - full: all tools allowed
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { ToolRegistry } from '../../src/core/tools/registry.js';
import { ExecContextImpl } from '../../src/core/tools/context.js';
import { registerBuiltinTools } from '../../src/core/tools/builtins/index.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';
import type { ToolProfile } from '../../src/types/config.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-perm-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Permission Matrix', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;
  let registry: ToolRegistry;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    registry = new ToolRegistry();
    registerBuiltinTools(registry);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  function createContext(profile: ToolProfile): ExecContextImpl {
    return new ExecContextImpl({
      clawId: 'test-claw',
      clawDir: tempDir,
      profile,
      callerType: 'claw',
      fs: mockFs,
    });
  }

  describe('readonly profile', () => {
    it('should allow read tool', () => {
      const ctx = createContext('readonly');
      expect(ctx.hasPermission('read')).toBe(true);
    });

    it('should deny write tool', () => {
      const ctx = createContext('readonly');
      expect(ctx.hasPermission('write')).toBe(false);
    });

    it('should deny exec tool', () => {
      const ctx = createContext('readonly');
      expect(ctx.hasPermission('execute')).toBe(false);
    });

    it('should deny send tool', () => {
      const ctx = createContext('readonly');
      expect(ctx.hasPermission('send')).toBe(false);
    });

    it('should deny spawn tool', () => {
      const ctx = createContext('readonly');
      expect(ctx.hasPermission('spawn')).toBe(false);
    });

    it('should deny done tool', () => {
      const ctx = createContext('readonly');
      // done requires contract management permission
      expect(ctx.hasPermission('system')).toBe(false);
    });
  });

  describe('subagent profile', () => {
    it('should allow read tool', () => {
      const ctx = createContext('subagent');
      expect(ctx.hasPermission('read')).toBe(true);
    });

    it('should allow write tool', () => {
      const ctx = createContext('subagent');
      expect(ctx.hasPermission('write')).toBe(true);
    });

    it('should allow exec tool via TOOL_PROFILES', () => {
      // Note: PERMISSION_PRESETS.subagent has execute: false,
      // but TOOL_PROFILES.subagent includes 'exec'
      // The actual check is done via TOOL_PROFILES in getForProfile
      const subagentTools = registry.getForProfile('subagent');
      const toolNames = subagentTools.map(t => t.name);
      expect(toolNames).toContain('exec');
    });

    it('should allow skill tool', () => {
      const ctx = createContext('subagent');
      expect(ctx.hasPermission('read')).toBe(true); // skill requires read
    });

    it('should not include send in subagent profile tools', () => {
      const subagentTools = registry.getForProfile('subagent');
      const toolNames = subagentTools.map(t => t.name);
      expect(toolNames).not.toContain('send');
    });

    it('should deny done tool (system permission)', () => {
      const ctx = createContext('subagent');
      expect(ctx.hasPermission('system')).toBe(false);
    });

    it('should deny spawn tool', () => {
      const ctx = createContext('subagent');
      expect(ctx.hasPermission('spawn')).toBe(false);
    });
  });

  describe('dream profile', () => {
    it('should allow read tool', () => {
      const ctx = createContext('dream');
      expect(ctx.hasPermission('read')).toBe(true);
    });

    it('should allow search tool', () => {
      const ctx = createContext('dream');
      expect(ctx.hasPermission('read')).toBe(true); // search requires read
    });

    it('should allow ls tool', () => {
      const ctx = createContext('dream');
      expect(ctx.hasPermission('read')).toBe(true); // ls requires read
    });

    it('should allow write tool (for dream logging)', () => {
      const ctx = createContext('dream');
      expect(ctx.hasPermission('write')).toBe(true);
    });

    it('should deny exec tool', () => {
      const ctx = createContext('dream');
      expect(ctx.hasPermission('execute')).toBe(false);
    });

    it('should deny spawn tool', () => {
      const ctx = createContext('dream');
      expect(ctx.hasPermission('spawn')).toBe(false);
    });
  });

  describe('full profile', () => {
    it('should allow all tools', () => {
      const ctx = createContext('full');
      expect(ctx.hasPermission('read')).toBe(true);
      expect(ctx.hasPermission('write')).toBe(true);
      expect(ctx.hasPermission('execute')).toBe(true);
      expect(ctx.hasPermission('spawn')).toBe(true);
      expect(ctx.hasPermission('send')).toBe(true);
    });
  });

  describe('tool registry profile filtering', () => {
    it('should return correct tools for readonly profile', () => {
      const readonlyTools = registry.getForProfile('readonly');
      const toolNames = readonlyTools.map(t => t.name);
      
      expect(toolNames).toContain('read');
      expect(toolNames).toContain('search');
      expect(toolNames).toContain('ls');
      expect(toolNames).toContain('status');
      expect(toolNames).toContain('memory_search');
      
      expect(toolNames).not.toContain('write');
      expect(toolNames).not.toContain('exec');
      expect(toolNames).not.toContain('spawn');
    });

    it('should return correct tools for subagent profile', () => {
      const subagentTools = registry.getForProfile('subagent');
      const toolNames = subagentTools.map(t => t.name);
      
      expect(toolNames).toContain('read');
      expect(toolNames).toContain('write');
      expect(toolNames).toContain('exec');
      expect(toolNames).toContain('skill');
      
      expect(toolNames).not.toContain('send');
      expect(toolNames).not.toContain('spawn');
    });

    it('should return all tools for full profile', () => {
      const fullTools = registry.getForProfile('full');
      const toolNames = fullTools.map(t => t.name);
      
      expect(toolNames).toContain('read');
      expect(toolNames).toContain('write');
      expect(toolNames).toContain('exec');
      expect(toolNames).toContain('spawn');
      expect(toolNames).toContain('send');
      expect(toolNames).toContain('skill');
    });
  });
});
