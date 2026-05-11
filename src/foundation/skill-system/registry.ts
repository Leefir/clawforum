/**
 * SkillSystem - 技能系统
 * 
 * 采用渐进式披露：
 * - 启动时只加载元信息（frontmatter）
 * - 调用 skill 工具时才加载完整内容
 */

import type { FileSystem } from '../../foundation/fs/types.js';
import type { AuditLog } from '../../foundation/audit/index.js';
import { ToolError } from '../../types/errors.js';
import { SKILL_AUDIT_EVENTS } from './audit-events.js';

/**
 * Parse YAML frontmatter (industry standard syntax / per practices.md §DRY reflex 反例落地 / phase 461)
 * 1:1 inline copy from deleted src/foundation/frontmatter/ / 各 caller 自治 / format schema 业务归 caller。
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  // Normalize CRLF to LF for consistent parsing
  const normalized = raw.replace(/\r\n/g, '\n');

  if (!normalized.startsWith('---\n')) return { meta: {}, body: raw };
  const afterOpen = normalized.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx < 0) {
    throw new Error('Malformed frontmatter: missing closing ---');
  }

  const meta: Record<string, string> = {};
  for (const line of afterOpen.slice(0, closeIdx).split('\n')) {
    const ci = line.indexOf(':');
    if (ci <= 0) continue;
    const key = line.slice(0, ci).trim();
    const value = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
    meta[key] = value;
  }

  // Everything after the closing --- is the body
  return { meta, body: afterOpen.slice(closeIdx + 5).trim() };
}

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  skillDir: string;
}

export class SkillSystem {
  private fs: FileSystem;
  private skillsDir: string;
  private metaMap: Map<string, SkillMeta> = new Map();
  private audit?: AuditLog;

  constructor(fs: FileSystem, skillsDir: string, audit?: AuditLog) {
    this.fs = fs;
    this.skillsDir = skillsDir;
    this.audit = audit;
  }

  /**
   * 扫描 skillsDir，加载所有技能元信息
   */
  async loadAll(): Promise<void> {
    // 检查 skills 目录是否存在
    const exists = await this.fs.exists(this.skillsDir);
    if (!exists) {
      return; // 空目录，不报错
    }

    // 列出 skills 目录下的子目录
    const entries = await this.fs.list(this.skillsDir, { includeDirs: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      
      const skillDir = `${this.skillsDir}/${entry.name}`;
      const skillMdPath = `${skillDir}/SKILL.md`;
      
      // 检查 SKILL.md 是否存在
      const hasSkillMd = await this.fs.exists(skillMdPath);
      if (!hasSkillMd) continue;

      try {
        await this.register(skillDir);
      } catch (err) {
        this.audit?.write(SKILL_AUDIT_EVENTS.LOAD_FAILED,
          `skill_dir=${skillDir}`,
          `skills_dir=${this.skillsDir}`,
          `error=${err instanceof Error ? err.message : String(err)}`,
        );
        console.warn(`[skill] Failed to load skill from ${skillDir}:`, err);
        continue;
      }
    }

    // 正常出口 audit
    this.audit?.write(SKILL_AUDIT_EVENTS.REGISTRY_LOADED,
      `skills_dir=${this.skillsDir}`,
      `count=${this.metaMap.size}`,
    );
  }

  /**
   * 手动注册单个技能
   */
  async register(skillDir: string): Promise<SkillMeta> {
    const skillMdPath = `${skillDir}/SKILL.md`;
    const content = await this.fs.read(skillMdPath);
    
    // 解析 frontmatter
    const { meta: frontmatter } = parseFrontmatter(content);
    
    // 从路径提取技能名（作为 fallback）
    const dirName = skillDir.split('/').pop() || 'unknown';
    
    const meta: SkillMeta = {
      name: frontmatter.name || dirName,
      description: frontmatter.description || '',
      version: frontmatter.version || '0.0.0',
      skillDir,
    };

    // Duplicate check: preserve first registration, skip later ones
    if (this.metaMap.has(meta.name)) {
      const existing = this.metaMap.get(meta.name)!;
      this.audit?.write(SKILL_AUDIT_EVENTS.DUPLICATE_SKIPPED,
        `name=${meta.name}`,
        `existing_skill_dir=${existing.skillDir}`,
        `attempted_skill_dir=${skillDir}`,
        `skills_dir=${this.skillsDir}`,
      );
      console.warn(`[skill] Duplicate skill "${meta.name}" skipped: ${skillDir} (existing: ${existing.skillDir})`);
      return existing;
    }
    this.metaMap.set(meta.name, meta);
    return meta;
  }

  /**
   * 获取元信息
   */
  getMeta(name: string): SkillMeta | undefined {
    return this.metaMap.get(name);
  }

  /**
   * 列出所有元信息
   */
  listMeta(): SkillMeta[] {
    return Array.from(this.metaMap.values());
  }

  /**
   * 加载完整 SKILL.md 内容
   */
  async loadFull(name: string): Promise<string> {
    const meta = this.metaMap.get(name);
    if (!meta) {
      throw new ToolError(`Skill "${name}" not found`);
    }

    const skillMdPath = `${meta.skillDir}/SKILL.md`;
    return await this.fs.read(skillMdPath);
  }

  /**
   * 生成注入到上下文的元信息摘要
   */
  formatForContext(): string {
    const metas = this.listMeta();
    if (metas.length === 0) {
      return '## Available Skills\nNo skills loaded.\n';
    }

    const lines = ['## Available Skills'];
    for (const meta of metas) {
      lines.push(`- ${meta.name}: ${meta.description || 'No description'}`);
    }
    return lines.join('\n') + '\n';
  }

}
