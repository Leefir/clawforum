/**
 * dispatch-skills 路径 const — SummonSystem own per phase 1119 ratify。
 *
 * 历史：phase 1354 物理迁 foundation/paths.ts 切 evolution↔summon 2-cycle；phase 68
 * 实测 cycle 消失（summon 不再 import evolution）、归回真业务 owner。
 *
 * cluster L1-L4 去 claw 化 / paths.ts 解散第一步：应然唯一 admit 路径归位。
 * 详 coding plan/cluster-claw-decoupling-roadmap.md。
 */

export const DISPATCH_SKILLS_SUBDIR = 'dispatch-skills' as const;
// phase 75: inline 'clawspace' 字面避 L4 → L6 反向 import
// (CLAWSPACE_DIR own = L6 Assembly assembly/claw-dirs.ts、L4 dispatch-skills-paths
// 不可反向 import L6、字面冗余 = chestnut 拓扑 vocabulary 不漂移)
export const DISPATCH_SKILLS_PATH = `clawspace/${DISPATCH_SKILLS_SUBDIR}` as const;
