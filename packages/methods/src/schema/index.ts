/**
 * `@forge/methods/schema` — `11` §11.0's own framework definition shape: schema, loader, types.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */
export { loadFramework, readFramework } from './load.ts';
export { frameworkSchema } from './schema.ts';
export type {
  FrameworkCriterion,
  FrameworkDefinition,
  FrameworkDerivedInput,
  FrameworkFollowOn,
  FrameworkInputs,
  FrameworkIssue,
  FrameworkOption,
  FrameworkParseResult,
  FrameworkProduces,
  FrameworkQuestion,
  FrameworkRule,
  FrameworkRuleThen,
  FrameworkScoring,
} from './types.ts';
