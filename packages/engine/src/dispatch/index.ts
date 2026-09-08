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
  runCheckpointStep,
  runCommandStep,
  runGateStep,
  runMergeStep,
} from './steps.ts';
export { runShellCommand, type ShellCommandResult } from './shell.ts';
export type {
  ExecuteStepContext,
  GateEvaluator,
  LaneHandle,
  MergeCandidateChecks,
  MergeCandidateLike,
  MergeOutcome,
  MergeQueueFacade,
  NewDispatchEvent,
  StepFailureInfo,
  StepOutcome,
  StepOutcomeDetail,
  TelemetryFacade,
  VcsFacade,
} from './types.ts';
