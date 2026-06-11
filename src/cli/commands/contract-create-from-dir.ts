/**
 * Create a contract from a directory containing contract.yaml + verification/
 */

import * as path from 'path';
import { resolveChestnutRoot } from '../../foundation/install-paths.js';
import { CONTRACT_DIR } from '../../core/contract/index.js';
import type { ContractSystem } from '../../core/contract/index.js';
import { ContractCreatePolicyViolationError } from '../../core/contract/types.js';
import { getClawDir } from '../../foundation/config/index.js';
import type { AuditLog } from '../../foundation/audit/index.js';
import { CLI_AUDIT_EVENTS } from '../audit-events.js';
import type { FileSystem } from '../../foundation/fs/types.js';
import { makeContractId } from '../../core/contract/types.js';
import { parseAndValidateContractYaml, notifyContractCreated } from './contract-helpers.js';
import { CliError } from '../errors.js';

export async function contractCreateFromDirCommand(
  deps: { fsFactory: (baseDir: string) => FileSystem; contractSystem: ContractSystem },
  clawId: string,
  dirPath: string,
  extraDeps?: { audit?: AuditLog },
): Promise<void> {
  const audit = extraDeps?.audit;
  const absDir = path.resolve(dirPath);
  const srcFs = deps.fsFactory(absDir);

  const yamlContent = srcFs.readSync('contract.yaml');
  const contract = parseAndValidateContractYaml(yamlContent);

  // Phase 230: delegate to ContractSystem.create with policy iteration
  let contractId: string;
  try {
    contractId = await deps.contractSystem.create({
      contract,
      subagentTaskId: process.env.CHESTNUT_SUBAGENT_TASK_ID,
      clawDir: clawId,
    });
  } catch (err) {
    if (err instanceof ContractCreatePolicyViolationError) {
      throw new CliError(
        `Contract create rejected by policy '${err.policyName}': ${err.cause}`,
        err.details,
      );
    }
    throw err;
  }

  audit?.write(CLI_AUDIT_EVENTS.CONTRACT_CREATE, `claw=${clawId}`, `contract=${contractId}`, `mode=dir`);
  console.log(`Contract created: ${contractId} for claw ${clawId}`);

  // Copy verification/ 目录（若存在；回退读取旧版 acceptance/）
  const srcDir = srcFs.existsSync('verification') ? 'verification' : srcFs.existsSync('acceptance') ? 'acceptance' : undefined;
  if (srcDir) {
    const clawDir = getClawDir(clawId);
    const clawFs = deps.fsFactory(clawDir);
    const destRel = path.join(CONTRACT_DIR, 'active', contractId, 'verification');
    await clawFs.ensureDir(destRel);
    const entries = await srcFs.list(srcDir);
    for (const entry of entries) {
      const srcRel = path.join(srcDir, entry.name);
      const srcStat = await srcFs.stat(srcRel);
      if (!srcStat.isFile) continue;   // 跳过子目录和符号链接
      const destFileRel = path.join(destRel, entry.name);
      const content = await srcFs.read(srcRel);
      await clawFs.writeAtomic(destFileRel, content);
      // .sh files get 0o755 via writeAtomic default 0o644; skipping chmod as per plan
    }
  }

  const clawDir = getClawDir(clawId);
  const chestnutRoot = resolveChestnutRoot(clawDir, /* isMotion */ false);
  notifyContractCreated(deps, clawDir, clawId, makeContractId(contractId), contract, chestnutRoot);
}
