/**
 * `parseDiagram` — `08` §8.11.1/§8.11.2: syntax-check Mermaid source and extract a typed structural
 * model, the one parse call every later diagrams check reads through.
 *
 * @see specs/08 §8.11.3
 * @see SPEC-QUESTIONS.md Q45
 * @see PLAN-M3.md P1
 */
import './dom-shim.ts';

import { ForgeError } from '@forge/core';
// `mermaid`'s default export is a real ESM default (not a CJS-interop synthetic one), so a plain
// default import works under this repo's `verbatimModuleSyntax`/`NodeNext` settings.
import mermaid from 'mermaid';

import type { C4Db, SequenceDb, UnifiedDataDb } from './mermaid-db.ts';
import {
  DIAGRAM_KINDS,
  type DiagramEdge,
  type DiagramKind,
  type DiagramNode,
  type DiagramSubgraph,
  type ParsedDiagram,
} from './types.ts';

let initialized = false;

/** Idempotent, mirroring `installDomShim` — `mermaid.initialize` is not safe to call per-parse. */
function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({ startOnLoad: false });
}

/**
 * The `08` §8.11.3 taxonomy's own keyword for each kind, matched against the first non-blank,
 * non-comment (`%%`) line of the source (after any leading YAML frontmatter — see
 * `stripLeadingFrontmatter`) — not Mermaid's own internal `diagram.type` string, which collapses all
 * four C4 variants to one value (`'c4'`) and so cannot distinguish them.
 */
const KEYWORD_KINDS: readonly (readonly [RegExp, DiagramKind])[] = [
  [/^flowchart\b/, 'flowchart'],
  [/^graph\b/, 'flowchart'],
  [/^sequenceDiagram\b/, 'sequenceDiagram'],
  [/^stateDiagram-v2\b/, 'stateDiagram-v2'],
  [/^stateDiagram\b/, 'stateDiagram-v2'],
  [/^erDiagram\b/, 'erDiagram'],
  [/^gantt\b/, 'gantt'],
  [/^C4Context\b/, 'C4Context'],
  [/^C4Container\b/, 'C4Container'],
  [/^C4Component\b/, 'C4Component'],
  [/^C4Deployment\b/, 'C4Deployment'],
  [/^quadrantChart\b/, 'quadrantChart'],
];

/**
 * Mermaid supports a `---`-delimited YAML frontmatter block (`title`/`config`) before the diagram
 * keyword — real, commonly-authored, valid Mermaid that this module must not reject. Returns `source`
 * unchanged if it has no such block, including one left unterminated (mermaid's own parser is left to
 * raise that as a real syntax error rather than this function guessing).
 */
function stripLeadingFrontmatter(source: string): string {
  const lines = source.split('\n');
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim().length === 0) start++;
  if ((lines[start] ?? '').trim() !== '---') return source;
  for (let end = start + 1; end < lines.length; end++) {
    if ((lines[end] ?? '').trim() === '---') return lines.slice(end + 1).join('\n');
  }
  return source;
}

/** The first line that could plausibly declare a diagram kind — blank lines, `%%` comments, and any
 * leading frontmatter block skipped. `undefined` for a source with no such line at all. */
function firstMeaningfulLine(source: string): string | undefined {
  return stripLeadingFrontmatter(source)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('%%'));
}

function detectKind(source: string): DiagramKind | undefined {
  const line = firstMeaningfulLine(source);
  if (line === undefined) return undefined;
  for (const [pattern, kind] of KEYWORD_KINDS) {
    if (pattern.test(line)) return kind;
  }
  return undefined;
}

/** The three kinds Mermaid's unified renderer (`db.getData()`) already normalises — see Q45. */
const UNIFIED_DATA_KINDS: ReadonlySet<DiagramKind> = new Set([
  'flowchart',
  'stateDiagram-v2',
  'erDiagram',
]);

/** All four `C4*` kinds share the same `db` shape (`mermaid-db.ts`'s `C4Db`) — see Q45. */
const C4_KINDS: ReadonlySet<DiagramKind> = new Set([
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Deployment',
]);

function extractUnified(db: UnifiedDataDb): {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  subgraphs: DiagramSubgraph[];
} {
  const data = db.getData();
  const nodes: DiagramNode[] = [];
  const childrenByParent = new Map<string, string[]>();

  for (const node of data.nodes) {
    if (node.isGroup === true) continue;
    nodes.push({ id: node.id, label: node.label ?? node.id });
    if (node.parentId !== undefined) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node.id);
      childrenByParent.set(node.parentId, siblings);
    }
  }

  const subgraphs: DiagramSubgraph[] = data.nodes
    .filter((node) => node.isGroup === true)
    .map((node) => ({ id: node.id, nodeIds: childrenByParent.get(node.id) ?? [] }));

  const edges: DiagramEdge[] = data.edges.map((edge) => {
    const label = edge.label;
    return label !== undefined && label !== ''
      ? { from: edge.start, to: edge.end, label }
      : { from: edge.start, to: edge.end };
  });

  return { nodes, edges, subgraphs };
}

function extractSequence(db: SequenceDb): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = [...db.getActors().entries()].map(([id, actor]) => ({
    id,
    label: actor.description ?? actor.name ?? id,
  }));
  const edges: DiagramEdge[] = db.getMessages().map((message) => {
    const label = message.message;
    return label !== undefined && label !== ''
      ? { from: message.from, to: message.to, label }
      : { from: message.from, to: message.to };
  });
  return { nodes, edges };
}

function extractC4(db: C4Db): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = db.getC4ShapeArray().map((shape) => ({
    id: shape.alias,
    label: shape.label.text !== '' ? shape.label.text : shape.alias,
  }));
  const edges: DiagramEdge[] = db.getRels().map((rel) => {
    const label = rel.label.text;
    return label !== '' ? { from: rel.from, to: rel.to, label } : { from: rel.from, to: rel.to };
  });
  return { nodes, edges };
}

/**
 * Mermaid's own parse-error text already names the failing line — reused as-is, not re-parsed.
 *
 * The `String(cause)` branch is required by `useUnknownInCatchVariables` and defends against a
 * hypothetical future Mermaid release rejecting with a non-`Error` value; it is untested because it
 * is not reachable through `mermaid@11.17.2`'s real behaviour (verified: every rejection observed
 * from `getDiagramFromText` is a real `Error`), and `mermaid.mermaidAPI` is frozen
 * (`Object.isFrozen` true, `getDiagramFromText` non-configurable) so it cannot be made to reject with
 * one via a test double either.
 */
function renderParseError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Parses one Mermaid diagram's source: validates its syntax (`08` §8.11.7's `diagram:syntax`) and, for
 * every kind `ParsedDiagram`'s own doc comment names, extracts real nodes/edges/subgraphs.
 *
 * Rejects with `ForgeError('KB-001', ...)` for an unrecognised diagram kind or invalid Mermaid syntax
 * — never for a merely-unusual-but-valid diagram. A pure function of `source`: no filesystem access,
 * no network, no wall-clock or random state.
 */
export async function parseDiagram(source: string): Promise<ParsedDiagram> {
  const kind = detectKind(source);
  if (kind === undefined) {
    const line = firstMeaningfulLine(source);
    const detail =
      line === undefined
        ? 'the source has no non-blank, non-comment line to detect a diagram kind from'
        : `${JSON.stringify(line)} does not start with a recognised diagram keyword (one of: ${DIAGRAM_KINDS.join(', ')})`;
    throw new ForgeError('KB-001', { kind: 'unknown', detail });
  }

  ensureInitialized();

  const diagram = await (async () => {
    try {
      // `mermaid.parse`'s non-deprecated replacement only returns `{ diagramType, config }` — no
      // access to the parsed `db` this module needs for node/edge extraction. `getDiagramFromText`
      // is the only path to that `db` mermaid ships (its class-based replacement, `Diagram.fromText`,
      // is not separately exported at runtime — see SPEC-QUESTIONS.md Q45's build note).
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      return await mermaid.mermaidAPI.getDiagramFromText(source);
    } catch (cause) {
      throw new ForgeError('KB-001', { kind, detail: renderParseError(cause) }, { cause });
    }
  })();

  if (UNIFIED_DATA_KINDS.has(kind)) {
    const { nodes, edges, subgraphs } = extractUnified(diagram.db as unknown as UnifiedDataDb);
    return { kind, nodes, edges, subgraphs };
  }

  if (kind === 'sequenceDiagram') {
    const { nodes, edges } = extractSequence(diagram.db as unknown as SequenceDb);
    return { kind, nodes, edges, subgraphs: [] };
  }

  if (C4_KINDS.has(kind)) {
    const { nodes, edges } = extractC4(diagram.db as unknown as C4Db);
    return { kind, nodes, edges, subgraphs: [] };
  }

  // `gantt`/`quadrantChart`: syntax-validated above; not a node/edge graph in the sense this module's
  // other kinds are — see `ParsedDiagram`'s own doc comment, not a missing-extraction gap.
  return { kind, nodes: [], edges: [], subgraphs: [] };
}
