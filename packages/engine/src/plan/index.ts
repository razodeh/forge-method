/**
 * `@forge/engine/plan` — `06` §6.2's plan-compilation rule 1: `StepNode`, and compiling a `Workflow`
 * (`@forge/engine/workflow`) plus fanout expansion down into a flat `StepNode[]`.
 *
 * @see specs/06 §6.2
 * @see specs/10 §10.1
 * @see PLAN-M5.md P10
 */
export { compilePlan, compileStepId, expandFanout } from './compile.ts';
export {
  toAgentId,
  type AgentId,
  type ArtifactRef,
  type AutonomyLevel,
  type CompileIssue,
  type CompileResult,
  type ResourceClaim,
  type StepNode,
  type StepNodeKind,
  type StepNodeLimits,
  type StepNodeOnFailure,
  type StepNodeRetryPolicy,
} from './types.ts';
