/**
 * `@forge/diagrams/generate` — `08` §8.11.6's eight generators.
 *
 * @see PLAN-M3.md P3
 */
export {
  componentsToC4,
  datamodelToEr,
  depsToGraph,
  interfacesToSequence,
  pipelineToFlow,
  schemaIntrospectToEr,
  specgraphToGraph,
  workflowToDag,
  type ComponentsToC4Input,
  type DatamodelToErInput,
  type DepsToGraphInput,
  type InterfacesToSequenceInput,
  type PipelineToFlowInput,
  type SchemaIntrospectToErInput,
  type SpecgraphToGraphInput,
  type WorkflowToDagInput,
} from './generators.ts';
export {
  renderErDiagram,
  VALID_ER_CARDINALITIES,
  type ErCardinality,
  type ErEntity,
  type ErRelationship,
} from './render-er.ts';
export { renderFlowchart, type FlowEdge, type FlowNode } from './render-flowchart.ts';
export { renderSequenceDiagram, type SequenceStep } from './render-sequence.ts';
export { GENERATORS, runGenerator } from './registry.ts';
export { buildSanitizedIdMap, sanitizeMermaidId, sanitizeMermaidLabel } from './sanitize.ts';
export { GENERATOR_NAMES, type GeneratedDiagram, type GeneratorName } from './types.ts';
