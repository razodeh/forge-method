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
