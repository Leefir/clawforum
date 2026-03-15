/**
 * Skill system tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { SkillRegistry } from '../../src/core/skill/registry.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-skill-test-${randomUUID()}`);
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

describe('Skill System', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('SkillRegistry', () => {
    it('should scan skills/ directory and load frontmatter', async () => {
      // Create skill directory and SKILL.md
      await fs.mkdir(path.join(tempDir, 'skills', 'git-workflow'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'git-workflow', 'SKILL.md'),
        `---
name: git-workflow
description: Git 工作流操作指南，包括分支管理、提交规范、PR 流程
version: 1.0.0
---

# Git Workflow

This is the full content.
`
      );

      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      const meta = registry.getMeta('git-workflow');
      expect(meta).toBeDefined();
      expect(meta?.name).toBe('git-workflow');
      expect(meta?.description).toBe('Git 工作流操作指南，包括分支管理、提交规范、PR 流程');
      expect(meta?.version).toBe('1.0.0');
    });

    it('should list all loaded skill metadata', async () => {
      // Create two skills
      await fs.mkdir(path.join(tempDir, 'skills', 'skill-a'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'skill-a', 'SKILL.md'),
        `---
name: skill-a
description: Description A
version: 1.0.0
---
`
      );

      await fs.mkdir(path.join(tempDir, 'skills', 'skill-b'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'skill-b', 'SKILL.md'),
        `---
name: skill-b
description: Description B
version: 2.0.0
---
`
      );

      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      const metas = registry.listMeta();
      expect(metas).toHaveLength(2);
      expect(metas.map(m => m.name).sort()).toEqual(['skill-a', 'skill-b']);
    });

    it('should load full SKILL.md content', async () => {
      const fullContent = `---
name: test-skill
description: Test description
version: 1.0.0
---

# Test Skill

Full content here.
More content.
`;

      await fs.mkdir(path.join(tempDir, 'skills', 'test-skill'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'test-skill', 'SKILL.md'),
        fullContent
      );

      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      const loaded = await registry.loadFull('test-skill');
      expect(loaded).toBe(fullContent);
    });

    it('should throw ToolError for non-existent skill', async () => {
      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      await expect(registry.loadFull('non-existent')).rejects.toThrow('Skill "non-existent" not found');
    });

    it('should format for context with all skills', async () => {
      await fs.mkdir(path.join(tempDir, 'skills', 'git'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'git', 'SKILL.md'),
        `---
name: git
description: Git operations
---
`
      );

      await fs.mkdir(path.join(tempDir, 'skills', 'review'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'review', 'SKILL.md'),
        `---
name: review
description: Code review guidelines
---
`
      );

      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      const formatted = registry.formatForContext();
      expect(formatted).toContain('## Available Skills');
      expect(formatted).toContain('git:');
      expect(formatted).toContain('review:');
      expect(formatted).toContain('Git operations');
      expect(formatted).toContain('Code review guidelines');
    });

    it('should gracefully handle SKILL.md without frontmatter', async () => {
      await fs.mkdir(path.join(tempDir, 'skills', 'no-frontmatter'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, 'skills', 'no-frontmatter', 'SKILL.md'),
        `# Just Content

No frontmatter here.
`
      );

      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      const meta = registry.getMeta('no-frontmatter');
      expect(meta).toBeDefined();
      expect(meta?.name).toBe('no-frontmatter'); // fallback to dir name
      expect(meta?.description).toBe(''); // empty description
      expect(meta?.version).toBe('0.0.0'); // default version
    });

    it('should handle empty skills/ directory without error', async () => {
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });

      const registry = new SkillRegistry(mockFs, 'skills');
      await expect(registry.loadAll()).resolves.not.toThrow();

      const metas = registry.listMeta();
      expect(metas).toHaveLength(0);
    });

    it('should handle non-existent skills/ directory', async () => {
      const registry = new SkillRegistry(mockFs, 'skills');
      await expect(registry.loadAll()).resolves.not.toThrow();

      const metas = registry.listMeta();
      expect(metas).toHaveLength(0);
    });

    it('should format empty skills for context', async () => {
      const registry = new SkillRegistry(mockFs, 'skills');
      await registry.loadAll();

      const formatted = registry.formatForContext();
      expect(formatted).toContain('## Available Skills');
      expect(formatted).toContain('No skills loaded');
    });
  });
});
