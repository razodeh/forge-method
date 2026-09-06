/**
 * A shared `flowchart` renderer — backs every generator whose output is a node/dependency graph
 * (`components-to-c4`, `specgraph-to-graph`, `workflow-to-dag`, `deps-to-graph`, `pipeline-to-flow`).
 *
 * @see PLAN-M3.md P3
 */
import { buildSanitizedIdMap, quotedLabel, sanitizeMermaidLabel } from './sanitize.ts';

/** One drawn box. `id` is the domain id (`component:api`, ...) — sanitized internally, never
 * required to already be a valid bare Mermaid identifier. */
export interface FlowNode {
  readonly id: string;
  readonly label: string;
}

/** One connection between two `FlowNode.id`s. `label`, when given, becomes the arrow's own label
 * (`-->|label|`); omitted or empty renders a plain, unlabelled arrow. */
export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Renders `nodes`/`edges` as a Mermaid `flowchart`. Deterministic regardless of input order (R10):
 * both lists are sorted by id before rendering. Every id (a node's own, and both ends of every edge)
 * is funnelled through one shared `buildSanitizedIdMap` call, so two distinct domain ids can never
 * collide into the same Mermaid identifier and a reserved word or empty id can never reach the
 * output bare (`SPEC-QUESTIONS.md` Q46).
 */
export function renderFlowchart(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  direction: 'TB' | 'LR' = 'TB',
): string {
  const allIds = [
    ...nodes.map((node) => node.id),
    ...edges.flatMap((edge) => [edge.from, edge.to]),
  ];
  const idFor = buildSanitizedIdMap(allIds);

  const lines = [`flowchart ${direction}`];

  for (const node of [...nodes].sort((a, b) => compareIds(a.id, b.id))) {
    lines.push(`  ${idFor(node.id)}${quotedLabel(node.label, ['[', ']'])}`);
  }

  const sortedEdges = [...edges].sort(
    (a, b) =>
      compareIds(a.from, b.from) ||
      compareIds(a.to, b.to) ||
      compareIds(a.label ?? '', b.label ?? ''),
  );
  for (const edge of sortedEdges) {
    const arrow =
      edge.label !== undefined && edge.label !== ''
        ? `-->|${sanitizeMermaidLabel(edge.label)}|`
        : '-->';
    lines.push(`  ${idFor(edge.from)} ${arrow} ${idFor(edge.to)}`);
  }

  return lines.join('\n');
}
