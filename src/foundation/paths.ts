/**
 * Shared path constants + runtime path resolution — system-level directory
 * structure convention (M#3 single owner).
 *
 * foundation/paths.ts is the canonical location for all path knowledge.
 */

import * as path from 'path';
// ── Runtime path resolution ──

/** Workspace root — prefers CHESTNUT_ROOT env var (inherited by exec child processes). */
export function getWorkspaceRoot(): string {
  return process.env.CHESTNUT_ROOT ?? process.cwd();
}

/**
 * Validate identifier-class param (clawId / skillName / etc) against traversal.
 * @throws Error if name contains '/', '..', is empty, '.' or starts with '.'.
 */
function assertSafeClawId(name: string): void {
  if (
    typeof name !== 'string' ||
    name === '' ||
    name === '.' ||
    name.startsWith('.') ||
    name.includes('/') ||
    name.includes('\\') ||
    /[\x00-\x1f]/.test(name) ||
    name.includes('..')
  ) {
    throw new Error(`Invalid claw id: ${JSON.stringify(name)}`);
  }
}

// ============================================================================
// phase 64: ClawId / ClawDir / ChestnutRoot branded types + resolveChestnutRoot
// 自 foundation/identity 解散迁入 paths.ts vocabulary file
// per ML#3 资源唯一归属（运行期资源 vs 架构层 vocabulary 分类澄清）
// ============================================================================

declare const ClawIdBrand: unique symbol;
export type ClawId = string & { readonly [ClawIdBrand]: true };
export function makeClawId(s: string): ClawId { return s as ClawId; }

declare const ClawDirBrand: unique symbol;
export type ClawDir = string & { readonly [ClawDirBrand]: true };
export function makeClawDir(s: string): ClawDir { return s as ClawDir; }

declare const ChestnutRootBrand: unique symbol;
export type ChestnutRoot = string & { readonly [ChestnutRootBrand]: true };
export function makeChestnutRoot(s: string): ChestnutRoot { return s as ChestnutRoot; }

/**
 * 从 clawDir 推算 chestnutRoot 的单一权威函数。
 *
 * 目录拓扑（design/architecture.md 系统拓扑节）：
 *   motion claw：`<root>/motion/`         → motion claw clawDir 的父 = root
 *   普通 claw： `<root>/claws/<id>/`     → 普通 claw clawDir 的祖父 = root
 *
 * 调用方需告知是否 motion（来自 Assembly 装配期 isMotion guard）。
 *
 * 本函数是 phase 1387/1388/1389 cluster 反复 fix 的实然终结点：
 * 所有 `path.join(*, '..')` 推算 chestnutRoot 必经此函数（lint enforce 推 Step Z）。
 *
 * @param clawDir 此 claw 的实例目录（branded ClawDir）
 * @param isMotion 是否 motion claw（拓扑差异由配置决定 / 非模块差异）
 * @returns branded ChestnutRoot
 */
export function resolveChestnutRoot(clawDir: ClawDir, isMotion: boolean): ChestnutRoot {
  return isMotion
    ? makeChestnutRoot(path.join(clawDir, '..'))  // Motion-only callsite: motion clawDir = <root>/motion → root
    : makeChestnutRoot(path.join(clawDir, '..', '..'));
}

export function getClawDir(name: string): ClawDir {
  assertSafeClawId(name);
  return makeClawDir(path.join(getWorkspaceRoot(), '.chestnut', 'claws', name));
}

export function getChestnutRoot(): string {
  return path.join(getWorkspaceRoot(), '.chestnut');
}

/**
 * Generic helper to get a named subroot dir under .chestnut/.
 * Caller side owns the name (e.g., motion reserved name).
 *
 * @param name - subroot name (caller-owned, e.g., motion, claws)
 * @returns path joined under workspaceRoot/.chestnut/<name>
 */
export function getNamedSubrootDir(name: string): string {
  return path.join(getWorkspaceRoot(), '.chestnut', name);
}

export function getClawConfigPath(name: string): string {
  return path.join(getClawDir(name), 'config.yaml');
}


