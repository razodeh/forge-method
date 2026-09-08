export { scoreCoherence } from './coherence.ts';
export { scoreCandidate } from './criteria.ts';
export { filterByConstraints } from './filter.ts';
export { evaluateHardRules, isMandated } from './hard-rules.ts';
export { selectStack } from './select.ts';
export type {
  ChosenEntry,
  ChosenReason,
  FilterResult,
  HardRuleFlag,
  HardRuleId,
  ProjectLevel,
  RemovedCandidate,
  StackConstraints,
  StackSelectionInput,
  StackSelectionResult,
} from './types.ts';
