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
  parseEscalations,
  type CreatePromptAssemblyInput,
} from './assembly-context.ts';
export { runShellCommand, type ShellCommandResult } from './shell.ts';
export type { AgentWorkOptions } from './steps.ts';
export type {
  ExecuteStepContext,
  GateEvaluator,
  KbAccess,
  LaneHandle,
  MergeCandidateChecks,
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
