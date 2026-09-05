/**
 * `@forge/schemas/artifacts` — zod schemas for the eight spec-side artifact types.
 *
 * @see specs/09 §9.3
 * @see specs/09 §9.6
 */
export { acceptanceCriterionSchema, type AcceptanceCriterion } from './acceptance-criterion.ts';
export { capabilitySchema, type Capability } from './capability.ts';
export { dataModelSchema, type DataModel } from './data-model.ts';
export { epicSchema, type Epic } from './epic.ts';
export { interfaceContractSchema, type InterfaceContract } from './interface-contract.ts';
export { nfrSchema, type NFR } from './nfr.ts';
export { storySchema, type Story } from './story.ts';
export { taskSchema, type Task } from './task.ts';
export { visionSchema, type Vision } from './vision.ts';
