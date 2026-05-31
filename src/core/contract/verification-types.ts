/**
 * @module L4.ContractSystem.Verification.Types
 * Verification type exports to break circular imports within contract verification cluster.
 * Extracted in phase 1314 (cluster #3 of 5 cleanup roadmap).
 */

import type { LLMOrchestrator } from '../../foundation/llm-orchestrator/index.js';
import type { ToolRegistry } from '../../foundation/tools/index.js';
import type { ContractYaml, ProgressData, VerificationResult, VerifierConfig, VerifierResult, SubtaskId } from './types.js';
import { type LockContext } from './lock.js';
import type { ClawId } from '../../foundation/identity/index.js';
import type { ContractId, ChestnutRoot } from '../../foundation/identity/index.js';
import { type ClawDir } from '../../foundation/identity/index.js';
import type { VerificationMutex } from './verification-mutex.js';



export interface VerificationContext extends LockContext {
  clawDir: ClawDir;
  clawId: ClawId;
  llm?: LLMOrchestrator;
  contractDir: (contractId: ContractId) => Promise<string>;
  loadContractYaml: (contractId: ContractId) => Promise<ContractYaml>;
  getProgress: (contractId: ContractId) => Promise<ProgressData>;
  saveProgress: (contractId: ContractId, progress: ProgressData) => Promise<void>;
  checkAllSubtasksCompleted: (contractId: ContractId, progress: ProgressData) => Promise<boolean>;
  moveContractToArchive: (contractId: ContractId) => Promise<void>;
  emitContractCompleted: (contractId: ContractId) => Promise<void>;
  onNotify?: (type: string, data: Record<string, unknown>) => void;
  runScriptVerification: (scriptFile: string, contractAbsDir: ClawDir) => Promise<VerificationResult>;
  runLLMVerification: (
    promptFile: string,
    contractAbsDir: ClawDir,
    contractId: ContractId,
    subtaskId: SubtaskId,
    subtaskDesc: string,
    evidence: string,
    artifacts: string[],
  ) => Promise<VerificationResult>;
  withProgressLock: <T>(contractId: ContractId, fn: () => Promise<T>) => Promise<T>;
  toolRegistry: ToolRegistry;
  runVerifierWithCancel: (contractId: ContractId, config: Omit<VerifierConfig, 'signal' | 'chestnutRoot'>) => Promise<VerifierResult>;
  toolTimeoutMs?: number;
  /** phase 1389: ctx-injected chestnutRoot (single truth source, no heuristic derivation) */
  chestnutRoot: ChestnutRoot;
  /** phase 1465: per-ContractSystem instance race guard for verification pipeline (ML#3 + Tier 1 flaky_test_zero_tolerance) */
  verificationMutex: VerificationMutex;
}
