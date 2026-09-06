/**
 * Types for `@forge/diagrams/generate` — `08` §8.11.6's eight generators.
 *
 * @see specs/08 §8.11.6
 * @see PLAN-M3.md P3
 */
import type { DiagramKind } from '../parse/index.ts';

/** The eight generators `08` §8.11.6's table names, by their own generator-name spelling (the same
 * spelling a `Diagram`'s `generator` front-matter field carries). */
export type GeneratorName =
  | 'components-to-c4'
  | 'interfaces-to-sequence'
  | 'datamodel-to-er'
  | 'schema-introspect-to-er'
  | 'specgraph-to-graph'
  | 'workflow-to-dag'
  | 'deps-to-graph'
  | 'pipeline-to-flow';

/** `GENERATOR_NAMES` as data, so a test can assert every generator is registered without drift. */
export const GENERATOR_NAMES: readonly GeneratorName[] = [
  'components-to-c4',
  'interfaces-to-sequence',
  'datamodel-to-er',
  'schema-introspect-to-er',
  'specgraph-to-graph',
  'workflow-to-dag',
  'deps-to-graph',
  'pipeline-to-flow',
];

/** One generator's output: the Mermaid source itself, its kind, and the domain ids it depicts —
 * enough to populate a `Diagram`'s `source`/`kind`/`depicts` front-matter fields directly. */
export interface GeneratedDiagram {
  readonly source: string;
  readonly kind: DiagramKind;
  readonly depicts: readonly string[];
}
