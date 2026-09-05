/**
 * `@forge/schemas/artifacts` — zod schemas for all 21 registry artifact types.
 *
 * @see specs/09 §9.3
 * @see specs/09 §9.6
 * @see specs/08 §8.4
 * @see specs/08 §8.11.5
 * @see specs/13-frameworks-testing-and-debugging.md §13
 * @see specs/14-frameworks-delivery-and-operations.md §14
 * @see specs/16 §16.5
 */
export { acceptanceCriterionSchema, type AcceptanceCriterion } from './acceptance-criterion.ts';
export { adrSchema, type ADR } from './adr.ts';
export { assumptionSchema, type Assumption } from './assumption.ts';
export { capabilitySchema, type Capability } from './capability.ts';
export { dataModelSchema, type DataModel } from './data-model.ts';
export { defectSchema, SEVERITIES, type Defect } from './defect.ts';
export { diagramSchema, DIAGRAM_NOTATIONS, type Diagram } from './diagram.ts';
export { environmentSchema, type Environment } from './environment.ts';
export { epicSchema, type Epic } from './epic.ts';
export { gateReportSchema, type GateReport } from './gate-report.ts';
export { handoffRecordSchema, type HandoffRecord } from './handoff-record.ts';
export { interfaceContractSchema, type InterfaceContract } from './interface-contract.ts';
export { nfrSchema, type NFR } from './nfr.ts';
export { openQuestionSchema, type OpenQuestion } from './open-question.ts';
export { rcaSchema, type RCA } from './rca.ts';
export { riskSchema, type Risk } from './risk.ts';
export { runbookSchema, type Runbook } from './runbook.ts';
export { sessionRecordSchema, type SessionRecord } from './session-record.ts';
export { storySchema, type Story } from './story.ts';
export { taskSchema, type Task } from './task.ts';
export { visionSchema, type Vision } from './vision.ts';
export { waiverSchema, type Waiver } from './waiver.ts';
