/**
 * `@forge/extensions/workflows` — workflow, gate-check, framework, and template overlays, per
 * `15` §15.7.
 *
 * @see specs/15 §15.7
 * @see PLAN-M2.md P6
 */
export { checkBuiltInThreshold, gateCheckSchema, type GateCheck } from './gate-check.ts';
export {
  checkFrameworkRemovalStillReferenced,
  frameworkOverlaySchema,
  type FrameworkOverlay,
} from './framework.ts';
export {
  checkTemplateRequiredFields,
  requiredFieldsFor,
  templateOverlaySchema,
} from './template.ts';
export {
  type FrameworkReferenceFinding,
  type InsertAfterDirective,
  type StepKind,
  type TemplateFieldFinding,
  type ThresholdCheckInput,
  type ThresholdFinding,
  type WorkflowGuardrailCode,
  type WorkflowGuardrailFinding,
  type WorkflowStepSummary,
} from './types.ts';
export {
  applyInsertAfter,
  checkInsertAfterAnchors,
  checkWorkflowStepRemoval,
  workflowOverlaySchema,
  workflowStepsFieldSchema,
  type WorkflowOverlay,
  type WorkflowStepsDirective,
} from './workflow.ts';
