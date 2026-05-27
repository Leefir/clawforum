/**
 * @module L4.ContractSystem.Verification.Types
 * Verification type exports to break circular imports within contract verification cluster.
 * Extracted in phase 1314 (cluster #3 of 5 cleanup roadmap).
 */

import type { LLMOrchestrator } from '../../foundation/llm-orchestrator/index.js';
import type { ToolRegistry } from '../../foundation/tools/index.js';
import type { ContractYaml, ProgressData, VerificationResult, VerifierConfig, VerifierResult } from './types.js';
import { type LockContext } from './lock.js';
import type { ClawId } from '../../foundation/identity/index.js';


export interface VerificationContext extends LockContext {
  clawDir: string;
  clawId: ClawId;
  llm?: LLMOrchestrator;
  contractDir: (contractId: string) => Promise<string>;
  loadContractYaml: (contractId: string) => Promise<ContractYaml>;
  getProgress: (contractId: string) => Promise<ProgressData>;
  saveProgress: (contractId: string, progress: ProgressData) => Promise<void>;
  checkAllSubtasksCompleted: (contractId: string, progress: ProgressData) => Promise<boolean>;
  moveContractToArchive: (contractId: string) => Promise<void>;
  emitContractCompleted: (contractId: string) => Promise<void>;
  onNotify?: (type: string, data: Record<string, unknown>) => void;
  runScriptVerification: (scriptFile: string, contractAbsDir: string) => Promise<VerificationResult>;
  runLLMVerification: (
    promptFile: string,
    contractAbsDir: string,
    contractId: string,
    subtaskId: string,
    subtaskDesc: string,
    evidence: string,
    artifacts: string[],
  ) => Promise<VerificationResult>;
  withProgressLock: <T>(contractId: string, fn: () => Promise<T>) => Promise<T>;
  toolRegistry: ToolRegistry;
  runVerifierWithCancel: (contractId: string, config: Omit<VerifierConfig, 'signal'>) => Promise<VerifierResult>;
  toolTimeoutMs?: number;
}
