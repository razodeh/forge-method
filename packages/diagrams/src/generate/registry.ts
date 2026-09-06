/**
 * `GENERATORS`/`runGenerator` — the by-name dispatch `drift.ts` (P4) and, eventually, `@forge/cli`
 * (M6) call without knowing each generator's own function or input type.
 *
 * @see PLAN-M3.md P3
 */
import {
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
import type { GeneratedDiagram, GeneratorName } from './types.ts';

/**
 * By-name dispatch over every generator. Each entry casts its own `unknown` input to the one real
 * type that generator function actually declares — a heterogeneous registry keyed by a closed string
 * union has no way to encode "this key implies this input type" more precisely than that in a plain
 * `Record`, the same trade-off `@forge/extensions/presets`' own by-name registry already accepted for
 * the same reason. The cast itself proves nothing at runtime, which is why every generator function
 * (`generators.ts`) re-checks its own required fields at its own top and raises `ForgeError('KB-002',
 * ...)` rather than trusting the cast — the cast only has to be *type-safe enough to compile*, not
 * *runtime-safe enough to trust*, because the real safety net lives one layer in.
 */
export const GENERATORS: Readonly<Record<GeneratorName, (input: unknown) => GeneratedDiagram>> = {
  'components-to-c4': (input) => componentsToC4(input as ComponentsToC4Input),
  'interfaces-to-sequence': (input) => interfacesToSequence(input as InterfacesToSequenceInput),
  'datamodel-to-er': (input) => datamodelToEr(input as DatamodelToErInput),
  'schema-introspect-to-er': (input) => schemaIntrospectToEr(input as SchemaIntrospectToErInput),
  'specgraph-to-graph': (input) => specgraphToGraph(input as SpecgraphToGraphInput),
  'workflow-to-dag': (input) => workflowToDag(input as WorkflowToDagInput),
  'deps-to-graph': (input) => depsToGraph(input as DepsToGraphInput),
  'pipeline-to-flow': (input) => pipelineToFlow(input as PipelineToFlowInput),
};

/** Runs one generator by name. Equivalent to `GENERATORS[name](input)` — exported as its own
 * function so a caller need not import the registry object just to invoke one generator. */
export function runGenerator(name: GeneratorName, input: unknown): GeneratedDiagram {
  return GENERATORS[name](input);
}
