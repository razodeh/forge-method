/**
 * `buildGraphData` — turns a set of `ArtifactDocument`s into the nodes, edges, violations and
 * orphans `SpecGraph` exposes.
 *
 * `09` §9.4 names eleven required-edge rows; this builds edges for exactly the five `PLAN-M1.md` P14's
 * Checks exercise (`realises`, `delivers`, `partOf`, `belongsTo`, `proves`). The other six are
 * deliberately deferred, not half-built from an untested guess at each one's resolution rule —
 * `SPEC-QUESTIONS.md` Q31 records why for each, including the two with no data to build them from at
 * all (`TASK implements STORY`, `COMMIT implements STORY`) and the four with data but no Check to
 * validate a resolution rule against (`FILE primaryFor STORY`, `ADR constrains …`, `INT consumedBy
 * STORY`, `NFR verifiedBy …`). What follows is the convention this function invents for the two built
 * rows that have no field of their own at all:
 *
 * - `TEST proves AC`: `Story.tests` is a flat `string[]` with no structure linking an entry to a
 *   specific AC. `09` §9.5 point 1 requires a test's *name* to start with the AC id it proves
 *   (`"AC-014-2 returns 422 for an empty invoice"`), so a leading, comma-separated run of AC ids is
 *   read off each `tests[]` entry: zero matches makes the test an orphan (`09` §9.4's own example,
 *   `TEST-198 proves no AC`), more than one is the cardinality violation `PLAN-M1.md` P14's Check
 *   names, and exactly one is the `proves` edge.
 * - `CAP realises VIS`: `capabilitySchema` has no field naming its Vision — `Vision` is a singleton
 *   (`cardinality: 'one'` in the registry), so every `Capability` node realises the one `Vision` node
 *   present in this build, with no field to read.
 *
 * @see specs/09 §9.4
 * @see specs/09 §9.5
 * @see SPEC-QUESTIONS.md Q31
 * @see PLAN-M1.md P14
 */
import type { ArtifactTypeId } from '@forge/schemas';

import type { ArtifactDocument } from '../artifacts/document.ts';
import { ForgeError } from '../errors/index.ts';
import { compareStrings } from './compare.ts';
import type { EdgeKind, GraphEdge, GraphNode, GraphViolation, NodeKind, Orphan } from './types.ts';

const NODE_KIND_BY_ARTIFACT_TYPE: Partial<Record<ArtifactTypeId, NodeKind>> = {
  Vision: 'VIS',
  Capability: 'CAP',
  Epic: 'EPIC',
  Story: 'STORY',
  Task: 'TASK',
  ADR: 'ADR',
  InterfaceContract: 'INT',
  NFR: 'NFR',
};

/** A test name's leading, comma-separated run of AC ids — see this module's doc comment. */
const TEST_NAME_AC_IDS = /^(AC-\d{3,4}-\d+(?:\s*,\s*AC-\d{3,4}-\d+)*)/;

function frontMatterOf(doc: ArtifactDocument): Record<string, unknown> {
  // Cast, not a runtime check: `ArtifactDocument.parse` already validated the front matter is a YAML
  // mapping (throwing `CFG-007` otherwise), so `doc.frontMatter` is never anything else here.
  return doc.frontMatter as Record<string, unknown>;
}

function stringField(fm: Record<string, unknown>, key: string): string | undefined {
  const value = fm[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArrayField(fm: Record<string, unknown>, key: string): readonly string[] {
  const value = fm[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

interface Row {
  readonly kind: NodeKind;
  readonly id: string;
  readonly fm: Record<string, unknown>;
}

interface Candidate {
  readonly kind: NodeKind;
  readonly fm: Record<string, unknown>;
  readonly path: string;
}

/**
 * The element of `candidates` with the lexicographically smallest `path` — `.reduce()` without an
 * initial value rather than sorting and indexing `[0]`, so the result's type has no `| undefined` to
 * justify away: `noUncheckedIndexedAccess` cannot express "this array is never empty" for an index
 * access, but `Array.prototype.reduce` without a seed throws on an empty array instead of ever
 * producing one, so the type checker is right that the result is unconditionally a `Candidate`.
 *
 * @throws {TypeError} if `candidates` is empty — every call site here only reduces over an array a
 * `Map.set` immediately followed at least one `.push` onto, so this is unreachable in practice.
 */
function earliestByPath(candidates: readonly Candidate[]): Candidate {
  return candidates.reduce((earliest, candidate) =>
    compareStrings(candidate.path, earliest.path) < 0 ? candidate : earliest,
  );
}

/**
 * The first element of a non-empty array, typed as `T` rather than `T | undefined`.
 *
 * `.reduce()` without a seed starts its accumulator at `items[0]` and this callback always returns
 * that accumulator unchanged, so the result is `items[0]` — but, unlike `items[0]` itself, its type
 * under `noUncheckedIndexedAccess` carries no `undefined` to justify away, since `reduce` throws on
 * an empty array instead of ever producing one.
 */
function first<T>(items: readonly T[]): T {
  return items.reduce((head) => head);
}

export interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly violations: readonly GraphViolation[];
  readonly orphans: readonly Orphan[];
  /** Story id → the story ids it `depends_on`. Not one of `09` §9.4's typed edges; see `Cycle`. */
  readonly dependsOn: ReadonlyMap<string, readonly string[]>;
}

export function buildGraphData(docs: readonly ArtifactDocument[]): GraphData {
  const nodes: GraphNode[] = [];
  const acIds = new Set<string>();
  const edges: GraphEdge[] = [];
  const violations: GraphViolation[] = [];
  const orphans: Orphan[] = [];
  const dependsOn = new Map<string, readonly string[]>();

  // Every document with a recognisable id/type, grouped by that id. `IdAllocator` (`18` §18.8) is
  // meant to make a shared id impossible in a well-formed project, but this function cannot assume
  // that always held — a hand-edited or copy-pasted file can still claim an id another file already
  // has. Grouped rather than reduced immediately: which document wins must be decided by something
  // intrinsic to the documents themselves, not by where each one happens to sit in `docs`.
  const candidatesById = new Map<string, Candidate[]>();
  for (const doc of docs) {
    const fm = frontMatterOf(doc);
    const type = fm['type'];
    const id = stringField(fm, 'id');
    if (typeof type !== 'string' || id === undefined) continue;
    const kind = NODE_KIND_BY_ARTIFACT_TYPE[type as ArtifactTypeId];
    if (kind === undefined) continue;
    const candidates = candidatesById.get(id) ?? [];
    candidates.push({ kind, fm, path: doc.path });
    candidatesById.set(id, candidates);
  }

  // One row per id, sorted for determinism regardless of `docs`' order: a shared id's winner is
  // whichever candidate has the lexicographically smallest `path` — not "whichever document appeared
  // first in `docs`", which would make the graph depend on array order (`QUALITY-BAR.md` R10) for
  // exactly the input `IdAllocator` exists to rule out. A second document sharing an id contributes
  // nothing further: it must not also add an edge `from` that id (breaking the "at most one outgoing
  // edge per node" invariant `edges.sort` and `SpecGraph.parentsOf` both rely on) or overwrite the
  // winner's `dependsOn` entry.
  const rows: Row[] = [...candidatesById.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([id, candidates]) => {
      const winner = earliestByPath(candidates);
      return { kind: winner.kind, id, fm: winner.fm };
    });

  for (const row of rows) nodes.push({ kind: row.kind, id: row.id });

  // AC id → every story id that declares an acceptance entry with it — tracked across the whole
  // corpus (not just within one story, which `storySchema`'s own `superRefine` already catches) so a
  // claim from a *second* story is a real, reportable defect (`SPEC-023`), not a silently-dropped
  // duplicate.
  const acClaimants = new Map<string, string[]>();
  for (const row of rows) {
    if (row.kind !== 'STORY') continue;
    const acceptance = row.fm['acceptance'];
    for (const criterion of Array.isArray(acceptance) ? acceptance : []) {
      if (typeof criterion !== 'object' || criterion === null) continue;
      const acId = stringField(criterion as Record<string, unknown>, 'id');
      if (acId === undefined) continue;
      const claimants = acClaimants.get(acId) ?? [];
      claimants.push(row.id);
      acClaimants.set(acId, claimants);
    }
    dependsOn.set(row.id, stringArrayField(row.fm, 'depends_on'));
  }

  // One AC node/edge per id, sorted for the same determinism reason `rows` above is: the
  // lexicographically smallest claiming story id wins the `belongsTo` edge, and every claim beyond
  // the first is `SPEC-023`.
  for (const [acId, claimants] of [...acClaimants.entries()].sort((a, b) =>
    compareStrings(a[0], b[0]),
  )) {
    acIds.add(acId);
    // `claimants` was built by pushing `row.id` while iterating the already-id-sorted `rows` above,
    // so it always arrives in ascending order already — its first element is the winner.
    const winner = first(claimants);
    nodes.push({ kind: 'AC', id: acId });
    edges.push({ from: acId, edge: 'belongsTo', to: winner });
    if (claimants.length > 1) {
      const stories = [...claimants].sort(compareStrings).join(', ');
      violations.push(new ForgeError('SPEC-023', { acId, stories }));
    }
  }

  const nodeIndex = new Map(nodes.map((node) => [node.id, node] as const));
  // Sorted, not "whichever `Vision` doc came first": nothing here enforces the registry's
  // `cardinality: 'one'` for `Vision`, so more than one `Vision` document is possible input, and
  // picking by array position would make every `CAP realises VIS` edge depend on `docs`' order.
  const visionId = nodes
    .filter((node) => node.kind === 'VIS')
    .map((node) => node.id)
    .sort(compareStrings)[0];

  /** Records the edge if `parentId` resolves to a node of `parentKind`, else a `SPEC-021` violation. */
  function requireParent(
    childId: string,
    expectedParent: string,
    parentKind: NodeKind,
    parentId: string | undefined,
    edge: EdgeKind,
  ): boolean {
    if (parentId !== undefined) {
      const parent = nodeIndex.get(parentId);
      if (parent?.kind === parentKind) {
        edges.push({ from: childId, edge, to: parentId });
        return true;
      }
    }
    violations.push(new ForgeError('SPEC-021', { artifact: childId, expectedParent }));
    return false;
  }

  for (const row of rows) {
    if (row.kind === 'CAP') {
      requireParent(row.id, 'Vision', 'VIS', visionId, 'realises');
    } else if (row.kind === 'EPIC') {
      requireParent(row.id, 'Capability', 'CAP', stringField(row.fm, 'capability'), 'delivers');
    } else if (row.kind === 'STORY') {
      const hasEpic = requireParent(row.id, 'Epic', 'EPIC', stringField(row.fm, 'epic'), 'partOf');
      if (!hasEpic) orphans.push({ kind: 'STORY', id: row.id, reason: 'has no parent Epic' });
    }
  }

  // TEST nodes/edges: a second pass, since a test may name an AC belonging to any story, not only
  // the one its `tests[]` entry was read from.
  const testAcIds = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.kind !== 'STORY') continue;
    for (const testName of stringArrayField(row.fm, 'tests')) {
      if (!testAcIds.has(testName)) testAcIds.set(testName, new Set());
      const match = TEST_NAME_AC_IDS.exec(testName);
      const named = match?.[1] === undefined ? [] : match[1].split(/\s*,\s*/);
      const provenAcs = testAcIds.get(testName);
      for (const acId of named) {
        if (acIds.has(acId)) provenAcs?.add(acId);
      }
    }
  }
  const sortedTests = [...testAcIds.entries()].sort((a, b) => compareStrings(a[0], b[0]));
  for (const [testName, provenAcs] of sortedTests) {
    nodes.push({ kind: 'TEST', id: testName });
    if (provenAcs.size === 0) {
      orphans.push({ kind: 'TEST', id: testName, reason: 'proves no AC' });
    } else if (provenAcs.size > 1) {
      const acs = [...provenAcs].sort(compareStrings).join(', ');
      violations.push(new ForgeError('SPEC-022', { test: testName, acs }));
    } else {
      // `provenAcs.size` is exactly 1 here (the `=== 0` and `> 1` branches above are the only other
      // cases), so this Set has exactly one element — the destructure can never actually be
      // `undefined`, which `Set`'s iterator type does not itself express.
      const [acId] = provenAcs as unknown as readonly [string];
      edges.push({ from: testName, edge: 'proves', to: acId });
    }
  }

  nodes.sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.id, b.id));
  // Sorted by `from` alone: every edge kind this function builds belongs to a distinct `09` §9.4 row
  // (`realises`/`delivers`/`partOf`/`belongsTo`/`proves`), and each row's `from` type has at most one
  // outgoing edge (`SpecGraph.parentsOf`'s doc comment), so no two edges here can ever share a `from`
  // — there is no tie to break. A future edge kind that lets one node point at several targets (`INT
  // consumedBy STORY`, once built, lets one interface be consumed by many stories) would need a
  // `to`/`edge` tie-break added back here.
  edges.sort((a, b) => compareStrings(a.from, b.from));
  violations.sort((a, b) => compareStrings(JSON.stringify(a.details), JSON.stringify(b.details)));
  orphans.sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.id, b.id));

  return { nodes, edges, violations, orphans, dependsOn };
}
