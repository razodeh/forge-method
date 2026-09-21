/**
 * `@forge/engine/dispatch` — `10` §10.1's step-kind table made runnable, wiring together `@forge/vcs`,
 * `@forge/telemetry`, `@forge/adapter-kit`, and `@forge/engine/gates` (P14) into one `executeStep` call.
 *
 * @see specs/06 §6.4, §6.7, §6.8
 * @see specs/10 §10.1
 * @see PLAN-M5.md P15
 */
export { executeStep } from './execute.ts';
export {
  createGateEvaluator,
  createMergeQueueFacade,
  createTelemetryFacade,
  createVcsFacade,
  GateNotFoundError,
  MERGE_CHECK_LIMITS,
  type CommandLauncherOptions,
  type MergeQueueOptions,
} from './facades.ts';
export {
  runAgentStep,
  runAgentWork,
  runCheckpointStep,
  runCommandStep,
  runGateStep,
  runLaneLifecycle,
  runMergeStep,
} from './steps.ts';
export {
  assembleAgentSession,
  isAssemblyRefusal,
  markRefusal,
  refusalFailure,
  tryResolveSessionModel,
  kickoffPrompt,
  promptRecordDirName,
  resumePrompt,
  tryAssemble,
  type AssembleInput,
  type AssembledSession,
} from './assemble.ts';
export {
  createPromptAssemblyContext,
  listProjectAgents,
  parseEscalations,
  readProjectAgent,
  type CreatePromptAssemblyInput,
} from './assembly-context.ts';
export {
  MAX_RESULT_BYTES,
  sanitizeResultText,
  writeResultRecord,
  type ResultRecordRef,
  type SanitizedResult,
} from './result-record.ts';
export {
  checkDeclaredOutputs,
  docRootsOf,
  outputClaimGlobs,
  outputGlob,
  outputPathCoveredBy,
  PROTECTED_CLAIM_EXCLUSION,
  resolveStepClaim,
  verifyDeclaredOutputs,
  type OutputCheckInput,
  type StepClaim,
} from './outputs.ts';
export {
  CHECK_SETS,
  isCheckSetName,
  resolveMergeChecks,
  type ResolvedMergeChecks,
} from './merge-checks.ts';
export { checkElicitAnswer, sanitizeAnswer } from './elicit.ts';
export { runShellCommand, type ShellCommandResult, type ShellLimits } from './shell.ts';
export type { AgentWorkOptions } from './steps.ts';
export type {
  AskPort,
  AskRequest,
  DocRoots,
  ExecuteStepContext,
  GateEvaluator,
  KbAccess,
  LaneHandle,
  MergeCandidateChecks,
  MergeCheckCommand,
  MergeCandidateLike,
  MergeOutcome,
  MergeQueueFacade,
  NewDispatchEvent,
  PromptAssemblyContext,
  StepFailureInfo,
  StepOutcome,
  StepOutcomeDetail,
  TelemetryFacade,
  VcsFacade,
} from './types.ts';
