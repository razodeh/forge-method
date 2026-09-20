/**
 * `@forge/engine/plan` — `06` §6.2's plan-compilation rules 1–6: `StepNode`, compiling a `Workflow`
 * (`@forge/engine/workflow`) plus fanout expansion into a flat `StepNode[]` (P10), then implicit
 * dependencies, cycle rejection, and critical path (P11) via the one entry point everything downstream
 * calls, `compileRunPlan`.
 *
 * @see specs/06 §6.2, §6.6, §6.7, §6.8, §6.9
 * @see specs/10 §10.1, §10.2
 * @see PLAN-M5.md P10, P11
 */
export { compilePlan, compileStepId, expandFanout } from './compile.ts';
export { computeCriticalPath, safeCost } from './critical-path.ts';
export { detectCycles, renderCycleAsMermaid } from './cycles.ts';
export {
  applyClaimOverlaps,
  buildClaimIntervalMap,
  globsOverlap,
  insertContractDependencies,
} from './dependencies.ts';
export { compileRunPlan } from './run-plan.ts';
export {
  MAX_REPORTED_OVERLAPS,
  compileStageRunPlan,
  type OutsideStageStatus,
  type StageFindingSeverity,
  type StageRunPlan,
  type StageRunPlanFinding,
  type StageRunPlanOptions,
  type StageStory,
  type StoryOverlap,
} from './stage-plan.ts';
export {
  toAgentId,
  type AgentId,
  type ArtifactRef,
  type AutonomyLevel,
  type ClaimIntervalMap,
  type ClaimOverlap,
  type CompileIssue,
  type CompileResult,
  type CriticalPathResult,
  type CycleResult,
  type ResourceClaim,
  type RetryableFailureClass,
  type RunPlanResult,
  type StepNode,
  type StepNodeKind,
  type StepNodeLimits,
  type StepNodeOnFailure,
  type StepNodeRetryPolicy,
} from './types.ts';
