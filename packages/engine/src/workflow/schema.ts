/**
 * The zod schema mirroring `types.ts`'s own `Workflow`/`WorkflowStep` shape, field for field — what
 * `parseWorkflow` runs a parsed YAML document's value through to decide whether it structurally *is* a
 * `Workflow`, and to collect every shape violation at once rather than stopping at the first one.
 *
 * Every object schema is `.strict()`, not `.passthrough()`: unlike `@forge/extensions/workflows`'s own
 * `stepItemSchema` (`PLAN-M2.md` P6, deliberately permissive — it validates a *patch fragment* that may
 * legitimately carry "whatever kind-specific fields exist"), this piece validates a complete, freshly-
 * authored base workflow document, and `PLAN-M5.md` P8's own mandate is specifically rigorous structural
 * validation — a typo'd field name (`angent` for `agent`) should surface as a clear issue, not be
 * silently accepted as unknown extra data.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P8
 */
import { z } from 'zod';

import type { Workflow, WorkflowStep } from './types.ts';

const nonBlank = () => z.string().min(1);

const outputContractSchema = z
  .object({
    type: nonBlank(),
    cardinality: z.enum(['one', 'many']).optional(),
    subtype: nonBlank().optional(),
  })
  .strict();

const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().positive(),
    retryOn: z.array(nonBlank()),
  })
  .strict();

const stepLimitsSchema = z
  .object({
    maxTurns: z.number().int().positive().optional(),
    maxCostUsd: z.number().nonnegative().optional(),
  })
  .strict();

/** A question's `name` is an identifier: it names the answer in the run's `answers` (`PLAN-M13.md` P20) and the
 * environment variable a `command` step reads it from (`FORGE_ANSWER_<name>`), so it is letters, digits and
 * underscores, starting with a letter. */
export const ELICIT_QUESTION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const elicitQuestionSchema = z
  .object({
    name: z.string().regex(ELICIT_QUESTION_NAME),
    prompt: nonBlank(),
    // An answer is trimmed before it is compared, so a choice with surrounding space could never be answered, and a
    // repeated one is a mistake.
    choices: z
      .array(nonBlank())
      .min(1)
      .refine((list) => list.every((choice) => choice === choice.trim()), {
        message: 'a choice must not start or end with whitespace',
      })
      .refine((list) => new Set(list).size === list.length, {
        message: 'a choice is listed twice',
      })
      .optional(),
  })
  .strict();

const mergePolicySchema = z
  .object({
    conflict: nonBlank(),
    preChecks: nonBlank().optional(),
    postChecks: nonBlank().optional(),
  })
  .strict();

const baseStepFields = {
  id: nonBlank().optional(),
  dependsOn: z.array(nonBlank()).optional(),
};

const agentStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('agent'),
    agent: nonBlank(),
    brief: nonBlank().optional(),
    mode: nonBlank().optional(),
    perspectives: z.array(nonBlank()).optional(),
    inputs: z.array(nonBlank()).optional(),
    outputs: z.array(outputContractSchema).optional(),
    gateEvidence: z.array(nonBlank()).optional(),
    produces: z.union([nonBlank(), z.array(nonBlank())]).optional(),
    limits: stepLimitsSchema.optional(),
    retry: retryPolicySchema.optional(),
    onFailure: nonBlank().optional(),
    // `20` §20.5 point 3 / `15` §15.5.4: the only value either spec passage names (`types.ts`'s own
    // `AgentStep.taint` doc comment); `'external'` is the sole literal accepted, not any non-blank
    // string, so an author's typo (`taint: External`) is a real, located schema error, not a silently
    // accepted no-op (`PLAN-M14.md` P27).
    taint: z.literal('external').optional(),
  })
  .strict();

const commandStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('command'),
    run: nonBlank(),
    inline: z.boolean().optional(),
    // `06` §6.2's canonical `StepNode` shape gives every kind its own `produces` (`PLAN-M14.md` P2):
    // a non-inline command step that writes a tracked file in its lane declares it here, the identical
    // shape (a bare string or an array) `agentStepSchema.produces` already accepts.
    produces: z.union([nonBlank(), z.array(nonBlank())]).optional(),
  })
  .strict();

const gateStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('gate'),
    gate: nonBlank(),
  })
  .strict();

const elicitStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('elicit'),
    questions: z.array(elicitQuestionSchema).min(1),
  })
  .strict();

const sessionStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('session'),
    sessionType: nonBlank(),
    question: nonBlank().optional(),
    when: nonBlank().optional(),
  })
  .strict();

// `z.lazy` with an explicit return-type annotation at every recursive call site (rather than inferring
// from `workflowStepSchema` directly) breaks the circular-inference problem a self-referencing schema
// would otherwise hit: these three schemas are defined *before* `workflowStepSchema` is assigned below,
// and TypeScript cannot infer a forward reference's type, only trust an explicit one.
const lazyWorkflowStep = (): z.ZodType<WorkflowStep> => workflowStepSchema;

const fanoutStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('fanout'),
    over: nonBlank(),
    itemKey: nonBlank().optional(),
    step: z.lazy(lazyWorkflowStep),
  })
  .strict();

const mergeStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('merge'),
    over: nonBlank(),
    policy: mergePolicySchema,
  })
  .strict();

const subworkflowStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('subworkflow'),
    workflow: nonBlank(),
  })
  .strict();

const checkpointStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('checkpoint'),
  })
  .strict();

// `.min(1)`, matching `workflowSchema.steps`'s own reasoning below: an empty group is exactly as inert
// as a workflow with zero steps, and nothing else in this file catches it otherwise.
const parallelStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('parallel'),
    steps: z.array(z.lazy(lazyWorkflowStep)).min(1),
  })
  .strict();

const sequenceStepSchema = z
  .object({
    ...baseStepFields,
    kind: z.literal('sequence'),
    steps: z.array(z.lazy(lazyWorkflowStep)).min(1),
  })
  .strict();

export const workflowStepSchema: z.ZodType<WorkflowStep> = z.discriminatedUnion('kind', [
  agentStepSchema,
  commandStepSchema,
  gateStepSchema,
  elicitStepSchema,
  sessionStepSchema,
  fanoutStepSchema,
  mergeStepSchema,
  subworkflowStepSchema,
  checkpointStepSchema,
  parallelStepSchema,
  sequenceStepSchema,
]);

const workflowInputSchema = z
  .object({
    name: nonBlank(),
    type: nonBlank(),
    required: z.boolean(),
  })
  .strict();

const workflowRequiresSchema = z
  .object({
    gates_passed: z.array(nonBlank()).optional(),
    artifacts: z.array(nonBlank()).optional(),
  })
  .strict();

const onFailureEscalationSchema = z
  .object({
    when: nonBlank(),
    do: z.lazy(lazyWorkflowStep),
  })
  .strict();

const workflowOnFailureSchema = z
  .object({
    default: nonBlank(),
    escalations: z.array(onFailureEscalationSchema).optional(),
  })
  .strict();

/** Explicitly typed against `Workflow` (the same reason `workflowStepSchema` is above): catches this
 * schema drifting out of sync with `types.ts`'s own hand-written interface at compile time, rather than
 * only at the moment some future field mismatch actually gets exercised by a test.
 *
 * `steps` requires at least one entry: a workflow with zero steps does nothing, a structural defect
 * worth catching here rather than leaving for `validateStructure` to notice (or not) later. */
export const workflowSchema: z.ZodType<Workflow> = z
  .object({
    id: nonBlank(),
    name: nonBlank(),
    version: nonBlank(),
    description: nonBlank(),
    levels: z.array(nonBlank()).optional(),
    requires: workflowRequiresSchema.optional(),
    inputs: z.array(workflowInputSchema).optional(),
    vars: z.record(z.string(), z.string()).optional(),
    steps: z.array(workflowStepSchema).min(1),
    onFailure: workflowOnFailureSchema.optional(),
    onComplete: z.array(workflowStepSchema).optional(),
  })
  .strict();
