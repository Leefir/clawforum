/**
 * Skill install commands
 *
 * User mode: install skill from local path to workspace
 * Internal mode: install dispatch-skill to a specific claw
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsNative from 'fs';

/**
 * Copy directory recursively
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * User mode: install skill from local path to workspace
 * - Copy to root/skills/{skillName}/
 * - Sync to motion/clawspace/dispatch-skills/{skillName}/
 */
export async function skillInstallUserCommand(sourcePath: string): Promise<void> {
  const root = process.env.CLAWFORUM_ROOT ?? process.cwd();
  const absSource = path.resolve(sourcePath);

  // Skill name = source directory name
  const skillName = path.basename(absSource);

  // Verify SKILL.md exists
  const skillMd = path.join(absSource, 'SKILL.md');
  if (!fsNative.existsSync(skillMd)) {
    throw new Error(`No SKILL.md found in ${absSource}`);
  }

  // 1. Copy to root level skills/{skillName}/
  const destUser = path.join(root, 'skills', skillName);
  const userExists = fsNative.existsSync(destUser);
  await copyDir(absSource, destUser);
  console.log(`${userExists ? 'Updated' : 'Installed'} skills/${skillName}`);

  // 2. Sync to motion/clawspace/dispatch-skills/{skillName}/
  const motionDir = path.join(root, '.clawforum', 'motion');
  const destDispatch = path.join(motionDir, 'clawspace', 'dispatch-skills', skillName);
  const dispatchExists = fsNative.existsSync(destDispatch);
  await copyDir(absSource, destDispatch);
  console.log(`${dispatchExists ? 'Updated' : 'Synced'} dispatch-skills/${skillName}`);

  // 3. Sync to motion/skills/{skillName}/ (available to subagents spawned by motion)
  const destMotionSkills = path.join(motionDir, 'skills', skillName);
  const motionSkillsExists = fsNative.existsSync(destMotionSkills);
  await copyDir(absSource, destMotionSkills);
  console.log(`${motionSkillsExists ? 'Updated' : 'Synced'} motion/skills/${skillName}`);
}

/**
 * Internal mode: install dispatch-skill to a specific claw
 * - Copy from motion/clawspace/dispatch-skills/{skillName}/
 * - To clawDir/skills/{skillName}/
 */
export async function skillInstallClawCommand(clawId: string, skillName: string): Promise<void> {
  const root = process.env.CLAWFORUM_ROOT ?? process.cwd();
  const motionDir = path.join(root, '.clawforum', 'motion');
  const source = path.join(motionDir, 'clawspace', 'dispatch-skills', skillName);
  const clawDir = path.join(root, '.clawforum', 'claws', clawId);
  const dest = path.join(clawDir, 'skills', skillName);

  if (!fsNative.existsSync(source)) {
    throw new Error(`dispatch-skill "${skillName}" not found`);
  }
  if (!fsNative.existsSync(clawDir)) {
    throw new Error(`claw "${clawId}" does not exist`);
  }

  await copyDir(source, dest);
  console.log(`Installed ${skillName} to claw ${clawId}`);
}
