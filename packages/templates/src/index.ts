/**
 * `@forge/templates` — a static, hand-editable stub file for every `18` §18.7 registry artifact
 * type, per `PLAN-M1.md` P11.
 *
 * This package cannot import `@forge/schemas` (`02` §2.2: `templates: []`, zero `@forge/*`
 * dependencies), so `TemplateArtifactTypeId` is its own, independently declared 21-member union
 * rather than `@forge/schemas`'s `ArtifactTypeId` — the two are kept in sync by a test at the
 * repository root (`test/templates.test.ts`), the one place allowed to depend on both packages.
 * See `SPEC-QUESTIONS.md` Q28.
 *
 * @see specs/18 §18.7
 * @see PLAN-M1.md P11
 * @see SPEC-QUESTIONS.md Q28
 */

/** The 21 artifact type names `specs/18` §18.7 registers, transcribed independently — see above. */
export type TemplateArtifactTypeId =
  | 'Vision'
  | 'Capability'
  | 'NFR'
  | 'Epic'
  | 'Story'
  | 'Task'
  | 'ADR'
  | 'InterfaceContract'
  | 'DataModel'
  | 'Diagram'
  | 'Risk'
  | 'Assumption'
  | 'OpenQuestion'
  | 'Waiver'
  | 'SessionRecord'
  | 'RCA'
  | 'Defect'
  | 'Environment'
  | 'Runbook'
  | 'GateReport'
  | 'HandoffRecord';

/**
 * Resolves a type to its template file, as a path relative to this package's own root
 * (`packages/templates/`) — a caller resolves it against wherever `@forge/templates` is actually
 * installed, since this package does not know its own filesystem location at the point this module
 * evaluates.
 */
/** `10` §10.5's own 20-row "Built-in workflows" table, transcribed independently for the identical
 * "this package has no `@forge/engine` edge" reason `TemplateArtifactTypeId` above already documents —
 * `specs/22` M6's own Build line says "the ten lifecycle workflows," but `10` §10.5's own table names
 * twenty (`PLAN-M6.md` T1, `SPEC-QUESTIONS.md` Q88: shipping all twenty is the correct reading, "ten
 * lifecycle workflows" is `22`'s own loose paraphrase of the ten `10` §10.2 phases, not a literal
 * subset instruction). */
export type WorkflowId =
  | 'intake'
  | 'discover'
  | 'define-product'
  | 'shape-solution'
  | 'initialize-project'
  | 'plan-stages'
  | 'plan-stage'
  | 'build-stage'
  | 'implement-story'
  | 'quick-fix'
  | 'verify-stage'
  | 'debug'
  | 'harden'
  | 'refactor'
  | 'deliver-stage'
  | 'operate'
  | 'adopt'
  | 'migrate'
  | 'retro'
  | 'replan';

/** Resolves a workflow id to its `.workflow.yaml` file, as a path relative to this package's own root
 * — the identical "caller resolves against wherever `@forge/templates` is actually installed" contract
 * `TEMPLATE_INDEX` below already documents. */
export const WORKFLOW_INDEX: Readonly<Record<WorkflowId, string>> = {
  intake: 'templates/workflows/intake.workflow.yaml',
  discover: 'templates/workflows/discover.workflow.yaml',
  'define-product': 'templates/workflows/define-product.workflow.yaml',
  'shape-solution': 'templates/workflows/shape-solution.workflow.yaml',
  'initialize-project': 'templates/workflows/initialize-project.workflow.yaml',
  'plan-stages': 'templates/workflows/plan-stages.workflow.yaml',
  'plan-stage': 'templates/workflows/plan-stage.workflow.yaml',
  'build-stage': 'templates/workflows/build-stage.workflow.yaml',
  'implement-story': 'templates/workflows/implement-story.workflow.yaml',
  'quick-fix': 'templates/workflows/quick-fix.workflow.yaml',
  'verify-stage': 'templates/workflows/verify-stage.workflow.yaml',
  debug: 'templates/workflows/debug.workflow.yaml',
  harden: 'templates/workflows/harden.workflow.yaml',
  refactor: 'templates/workflows/refactor.workflow.yaml',
  'deliver-stage': 'templates/workflows/deliver-stage.workflow.yaml',
  operate: 'templates/workflows/operate.workflow.yaml',
  adopt: 'templates/workflows/adopt.workflow.yaml',
  migrate: 'templates/workflows/migrate.workflow.yaml',
  retro: 'templates/workflows/retro.workflow.yaml',
  replan: 'templates/workflows/replan.workflow.yaml',
};

export const TEMPLATE_INDEX: Readonly<Record<TemplateArtifactTypeId, string>> = {
  Vision: 'templates/artifacts/Vision.md',
  Capability: 'templates/artifacts/Capability.md',
  NFR: 'templates/artifacts/NFR.md',
  Epic: 'templates/artifacts/Epic.md',
  Story: 'templates/artifacts/Story.md',
  Task: 'templates/artifacts/Task.md',
  ADR: 'templates/artifacts/ADR.md',
  InterfaceContract: 'templates/artifacts/InterfaceContract.md',
  DataModel: 'templates/artifacts/DataModel.md',
  Diagram: 'templates/artifacts/Diagram.md',
  Risk: 'templates/artifacts/Risk.md',
  Assumption: 'templates/artifacts/Assumption.md',
  OpenQuestion: 'templates/artifacts/OpenQuestion.md',
  Waiver: 'templates/artifacts/Waiver.md',
  SessionRecord: 'templates/artifacts/SessionRecord.md',
  RCA: 'templates/artifacts/RCA.md',
  Defect: 'templates/artifacts/Defect.md',
  Environment: 'templates/artifacts/Environment.md',
  Runbook: 'templates/artifacts/Runbook.md',
  GateReport: 'templates/artifacts/GateReport.md',
  HandoffRecord: 'templates/artifacts/HandoffRecord.md',
};
