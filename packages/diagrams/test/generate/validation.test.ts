/**
 * `KB-002` — every generator's own shallow input-shape validation.
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
} from '@forge/diagrams';
import { isForgeError } from '@forge/core';
import { describe, expect, it } from 'vitest';

function throwsKB002(fn: () => void): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(isForgeError(thrown) && thrown.code === 'KB-002').toBe(true);
}

describe('generator input validation (KB-002)', () => {
  it('componentsToC4 rejects a missing components array', () => {
    throwsKB002(() => componentsToC4({} as unknown as ComponentsToC4Input));
  });

  it('interfacesToSequence rejects a missing steps array', () => {
    throwsKB002(() =>
      interfacesToSequence({ flowName: 'x' } as unknown as InterfacesToSequenceInput),
    );
  });

  it('datamodelToEr rejects a missing entities array', () => {
    throwsKB002(() => datamodelToEr({ relationships: [] } as unknown as DatamodelToErInput));
  });

  it('datamodelToEr rejects a missing relationships array', () => {
    throwsKB002(() => datamodelToEr({ entities: [] } as unknown as DatamodelToErInput));
  });

  it('schemaIntrospectToEr rejects a missing tables array', () => {
    throwsKB002(() =>
      schemaIntrospectToEr({ foreignKeys: [] } as unknown as SchemaIntrospectToErInput),
    );
  });

  it('schemaIntrospectToEr rejects a missing foreignKeys array', () => {
    throwsKB002(() => schemaIntrospectToEr({ tables: [] } as unknown as SchemaIntrospectToErInput));
  });

  it('specgraphToGraph rejects a graph field with no nodes()/edges() methods', () => {
    throwsKB002(() =>
      specgraphToGraph({ graph: { nodes: [] } } as unknown as SpecgraphToGraphInput),
    );
  });

  it('specgraphToGraph rejects a completely absent graph field', () => {
    throwsKB002(() => specgraphToGraph({} as unknown as SpecgraphToGraphInput));
  });

  it('workflowToDag rejects a missing steps array', () => {
    throwsKB002(() => workflowToDag({} as unknown as WorkflowToDagInput));
  });

  it('depsToGraph rejects a missing modules array', () => {
    throwsKB002(() => depsToGraph({} as unknown as DepsToGraphInput));
  });

  it('pipelineToFlow rejects a missing stages array', () => {
    throwsKB002(() => pipelineToFlow({} as unknown as PipelineToFlowInput));
  });

  it('rejects input that is not an object at all', () => {
    throwsKB002(() => componentsToC4(null as unknown as ComponentsToC4Input));
    throwsKB002(() => componentsToC4(undefined as unknown as ComponentsToC4Input));
  });
});
