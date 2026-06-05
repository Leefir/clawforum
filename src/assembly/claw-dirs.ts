/**
 * @module L6.Assembly.ClawDirs
 * chestnut claw 目录命名约定（顶层 segment）。
 *
 * phase 75 自 foundation/paths.ts 整迁 → L6 Assembly 真业务 owner（claw 实例化目录
 * 结构由装配根决定、与 spawn-entry / claw-subdirs 同模块）。
 *
 * cluster L1-L4 去 claw 化 / paths.ts 解散第五步、详
 * `coding plan/cluster-claw-decoupling-roadmap.md`。
 */

export const CLAWS_DIR = 'claws' as const;
export const CLAWSPACE_DIR = 'clawspace' as const;
