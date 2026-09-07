/**
 * `@forge/engine/workflow` — `10` §10.1's workflow DSL: types, YAML parsing with source-position
 * retention, and structural/referential validation.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P8
 */
export { parseValueAgainstSchema, parseWorkflow, yamlErrorToParseIssue } from './parse.ts';
export { workflowSchema, workflowStepSchema } from './schema.ts';
export {
  type AgentStep,
  type CheckpointStep,
  type CommandStep,
  type ElicitQuestion,
  type ElicitStep,
  type FanoutStep,
  type GateStep,
  type MergePolicy,
  type MergeStep,
  type OnFailureEscalation,
  type OutputContract,
  type ParallelStep,
  type ParseIssue,
  type ParseResult,
  type RetryPolicy,
  type SequenceStep,
  type SessionStep,
  type StepKind,
  type StepLimits,
  type SubworkflowStep,
  type ValidationIssue,
  type Workflow,
  type WorkflowExistenceOracle,
  type WorkflowInput,
  type WorkflowOnFailure,
  type WorkflowRequires,
  type WorkflowStep,
} from './types.ts';
export { validateStructure, validateWorkflow } from './validate.ts';
