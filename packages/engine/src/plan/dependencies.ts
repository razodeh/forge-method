/**
 * `06` §6.2's plan-compilation rules 2 and 3, against a `StepNode[]` P10's own `compilePlan` already
 * produced: insert implicit dependencies from **contract freeze** (`06` §6.6) and from **resource-claim
 * overlap** (`06` §6.7's own *scheduling-time* interval map — `SPEC-QUESTIONS.md` Q62's own sixth note
 * already explains why this half of §6.7 lives here and the *enforcement* half, against a real completed
 * lane, lives in `@forge/vcs` P4 instead).
 *
 * @see specs/06 §6.2, §6.6, §6.7
 * @see PLAN-M5.md P11
 */
import { minimatch } from 'minimatch';

import type { ClaimIntervalMap, ClaimOverlap, CompileIssue, CompileResult, StepNode } from './types.ts';

/** `10` §10.1's own `inputs`/`outputs` reference mini-DSL (`artifact:TypeName(id-or-*)`, `kb:glob`,
 * `diff:lane`) is otherwise carried through every `@forge/engine/plan` type as an opaque string
 * (`ArtifactRef`, `Q72`) — this is the one slice of it this piece actually needs to parse, to tell "this
 * step consumes *some* `InterfaceContract`" apart from every other input shape, matching `06` §6.2's own
 * rule 2 wording ("any step that writes an interface contract is an ancestor of every step that consumes
 * it") literally: by *type name*, not by a more specific identifier — nothing in the spec pack's one
 * worked example (`artifact:InterfaceContract(*)`, always the wildcard form) shows a way to reference one
 * *specific* contract instance, so there is nothing more specific to match against. */
const ARTIFACT_REFERENCE = /^artifact:([A-Za-z0-9_]+)\(/;

function referencedArtifactType(ref: string): string | undefined {
  return ARTIFACT_REFERENCE.exec(ref)?.[1];
}

function producesInterfaceContract(node: StepNode): boolean {
  return node.outputs.some((output) => output.type === 'InterfaceContract');
}

function consumesInterfaceContract(node: StepNode): boolean {
  return node.inputs.some((ref) => referencedArtifactType(ref) === 'InterfaceContract');
}

/** `06` §6.2's own rule 2, literally: every node whose own `outputs` includes an `InterfaceContract`-typed
 * `OutputContract` becomes an ancestor of every node whose own `inputs` reference that same contract type
 * — many-to-many, and a node already depending on a given producer (explicitly, or because a fanout's own
 * per-item `dependsOn` already named it) gains no duplicate edge. A node that both produces *and* consumes
 * (unusual, not ruled out by any type here) never gains a dependency on itself. Returns `nodes` completely
 * unchanged (not merely equivalent) when nothing produces a contract at all — the overwhelmingly common
 * case for any workflow with no contract-freeze step in it — so a caller comparing before/after by
 * reference can cheaply tell whether anything changed. */
export function insertContractDependencies(nodes: readonly StepNode[]): readonly StepNode[] {
  const producerIds = nodes.filter(producesInterfaceContract).map((node) => node.id);
  if (producerIds.length === 0) return nodes;

  return nodes.map((node) => {
    if (!consumesInterfaceContract(node)) return node;
    const newDeps = producerIds.filter((id) => id !== node.id && !node.dependsOn.includes(id));
    if (newDeps.length === 0) return node;
    return { ...node, dependsOn: [...node.dependsOn, ...newDeps] };
  });
}

/** "Do these two `produces` globs overlap" — confirmed and bounded deliberately, the same "use the real
 * library's own real behaviour, don't invent an idealised alternative" choice `@forge/engine/workflow`'s
 * own P8 already made for `minimatch.makeRe()`'s glob-validity leniency. Two real, common shapes are
 * caught: identical globs, and a literal path falling under a wildcard (`minimatch` treats its first
 * argument as a literal string to test, its second as the real pattern — trying both orderings catches
 * whichever side happens to be the literal one). A genuine wildcard-vs-wildcard overlap with no subset
 * relationship between them (`"src/*.ts"` vs `"src/a*.ts"` — both would match a real file like
 * `"src/afoo.ts"`, but neither is a literal match of the other) is *not* detected — full symbolic glob-
 * intersection is a meaningfully harder problem with no existing library support anywhere in this
 * monorepo's own dependencies, and nothing in `06` §6.7's own text or `PLAN-M5.md` P11's own Checks
 * (“two … steps on the *same* glob”) asks for it.
 *
 * `minimatch` itself throws a raw `TypeError` ("pattern is too long") for a pattern over 64KiB, a defensive
 * measure of its own against pathological-input backtracking cost — a verify round confirmed a `produces`
 * glob can genuinely reach that size (nothing between a fanout's own per-item template resolution,
 * `compile.ts`'s `toResourceClaims`, and here checks length or well-formedness), and that this call site
 * was the one place in the whole pipeline not already wrapped against it, letting it escape
 * `compileRunPlan` raw despite that function's own explicit "never throws" promise.
 *
 * A second verify round then found that `minimatch`'s own 64KiB limit does not actually bound the *cost*
 * of a call the way it looks like it should: a pattern of a few thousand unmatched `[` characters —
 * comfortably under 64KiB — drives its own internal bracket-class scanner (an O(n) forward search for a
 * matching `]`, restarted from *each* unmatched `[`) into genuine O(n²) blocking time (measured directly:
 * ~13 seconds at n=8000, doubling roughly 4× per doubling of n) with **no exception thrown at all**. That
 * round's own fix bounded this the blunt way — rejecting *any* glob over 256 characters, brackets or not —
 * which a third verify round then found rejects real, ordinary `produces` paths with no pathological
 * content at all: a fanout-generated path under a deeply-nested generated-file tree with a descriptive
 * slug can genuinely clear 256 characters while containing zero `[` characters (confirmed directly:
 * `minimatch` resolves a 354-character, bracket-free path against an ordinary short pattern in under a
 * millisecond) — silently reporting "no overlap" for a pair that *does* overlap is the identical, if
 * inverted, failure this whole function exists to avoid. `MAX_BRACKET_COUNT_FOR_OVERLAP_CHECK` targets the
 * actual cost driver directly (how many `[` a string contains, matched or not — a cheap, conservative
 * over-count of the "unmatched" figure that actually drives the O(n²) cost, needing no real bracket-
 * matching logic of its own to compute) instead of using overall length as a proxy for it: confirmed
 * directly that 64 unmatched brackets costs low single-digit milliseconds, many multiples below where a
 * real scheduling tick would notice, while a real `produces` glob has no legitimate reason to contain more
 * than one or two character classes in the first place.
 *
 * `MAX_GLOB_LENGTH_FOR_OVERLAP_CHECK` still exists independently, for the *other*, separately-confirmed
 * danger this function's own history already found: a stack overflow (`RangeError`) from deeply-nested
 * extglob groups (`+(`/`@(`), needing no bracket characters at all to trigger, so the bracket-count guard
 * above cannot substitute for it. Re-confirmed directly this round: the threshold is not a clean function
 * of length alone (2101 characters of nesting threw, 2401 characters of *deeper* nesting did not, in the
 * same process) — some slack in exactly where the real call stack overflows depending on whatever else is
 * on it at the time, not a defect in this reasoning. 512 sits comfortably below the entire observed danger
 * band (~1500–2400 characters) with room to spare, while remaining far more generous than any real file
 * path pattern has reason to need. Both guards are deliberately conservative *approximations* of their own
 * respective dangers, not proofs — which is exactly why the `catch` immediately below still exists and
 * still rethrows anything other than `TypeError`, as a real backstop, rather than trusting either cap
 * alone to make a `RangeError` provably unreachable. */
const MAX_GLOB_LENGTH_FOR_OVERLAP_CHECK = 512;
const MAX_BRACKET_COUNT_FOR_OVERLAP_CHECK = 64;

function countOpenBrackets(value: string): number {
  let count = 0;
  for (const char of value) {
    if (char === '[') count += 1;
  }
  return count;
}

export function globsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length > MAX_GLOB_LENGTH_FOR_OVERLAP_CHECK || b.length > MAX_GLOB_LENGTH_FOR_OVERLAP_CHECK) return false;
  if (countOpenBrackets(a) > MAX_BRACKET_COUNT_FOR_OVERLAP_CHECK || countOpenBrackets(b) > MAX_BRACKET_COUNT_FOR_OVERLAP_CHECK) return false;
  try {
    return minimatch(a, b) || minimatch(b, a);
  } catch (cause) {
    // Not currently reachable through this function's own real callers: the length guard above (512) is
    // well under the ~1500-2400-character band the confirmed extglob `RangeError` needs, so nothing that
    // reaches `minimatch` here can still be that deep. Kept as a real, if presently unexercised, guard
    // rather than a bare `catch {}` regardless — a `RangeError` slipping through despite the length cap
    // (a future `minimatch` version needing far less depth to overflow, say, or this same non-determinism
    // landing unluckily on a deeper ambient call stack) is a genuine, worth-surfacing problem, the same
    // "runtime check kept even where provably unreachable today" choice made throughout this codebase for
    // identically-shaped guards.
    if (!(cause instanceof TypeError)) throw cause;
    return false;
  }
}

/** `06` §6.7's own "the scheduler builds an interval map; overlapping claims are serialised" — every
 * pairwise overlap between two different `StepNode`s' own `produces` globs, checked once per unordered
 * pair (never a node against itself). O(n² × globs²), fine for any realistic step count (`06` §6.2's own
 * worked example has 9 nodes before fanout expansion); `.entries()`/`.slice()` rather than indexed access
 * avoids a `noUncheckedIndexedAccess` guard for an already-small, already-bounded loop. */
export function buildClaimIntervalMap(nodes: readonly StepNode[]): ClaimIntervalMap {
  const overlaps: ClaimOverlap[] = [];
  for (const [index, a] of nodes.entries()) {
    for (const b of nodes.slice(index + 1)) {
      for (const globA of a.produces) {
        for (const globB of b.produces) {
          if (globsOverlap(globA, globB)) {
            overlaps.push({ stepIdA: a.id, stepIdB: b.id, globA, globB });
          }
        }
      }
    }
  }
  return { overlaps };
}

/** `06` §6.2's own rule 3, literally: "two steps whose `produces` globs intersect are serialised (or the
 * plan is rejected as ambiguous if both are `exclusive`)." "Exclusive" reads as `StepNode.laneAffinity`
 * — the only per-step field already carrying that exact word in `06` §6.2's own interface — with a node
 * whose `laneAffinity` is `undefined` (which is every node P10 actually produces today; nothing in the
 * authored `WorkflowStep` DSL provides a way to declare `'exclusive'` at all, `Q72`) treated as `'shared'`
 * for this rule's purposes: the conservative reading, since `'shared'` only ever serialises, it never
 * rejects. Only a pair that is `'exclusive'` on *both* sides is rejected, matching the rule's own literal
 * "if both are exclusive" wording; a mix of one exclusive and one shared/unset side still serialises
 * (declaration order — whichever step appears first in `nodes` becomes the ancestor — deterministic and
 * independent of which order `buildClaimIntervalMap` happened to enumerate the pair in). */
export function applyClaimOverlaps(nodes: readonly StepNode[], intervalMap: ClaimIntervalMap): CompileResult {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const declarationOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const issues: CompileIssue[] = [];
  const extraDeps = new Map<string, Set<string>>();

  for (const overlap of intervalMap.overlaps) {
    const a = byId.get(overlap.stepIdA);
    const b = byId.get(overlap.stepIdB);
    // Always defined in practice: every overlap in `intervalMap` was built from these same `nodes` by
    // `buildClaimIntervalMap` just above. Guarded rather than cast, the same "runtime check over cast,
    // even where provably unreachable through this module's own real callers" choice made throughout
    // `@forge/engine` — a caller could in principle build a `ClaimIntervalMap` by hand and pass a mismatched
    // node list here, since both are public types.
    if (a === undefined || b === undefined) continue;

    if (a.laneAffinity === 'exclusive' && b.laneAffinity === 'exclusive') {
      issues.push({
        code: 'ambiguous-exclusive-claim',
        message: `Steps "${a.id}" and "${b.id}" both declare an exclusive claim on overlapping "produces" globs ("${overlap.globA}" / "${overlap.globB}"); the plan cannot determine an order between them.`,
      });
      continue;
    }

    const aIndex = declarationOrder.get(a.id) ?? 0;
    const bIndex = declarationOrder.get(b.id) ?? 0;
    const [earlier, later] = aIndex <= bIndex ? [a, b] : [b, a];
    const set = extraDeps.get(later.id) ?? new Set<string>();
    set.add(earlier.id);
    extraDeps.set(later.id, set);
  }

  if (issues.length > 0) return { success: false, issues };

  const updated = nodes.map((node) => {
    const extra = extraDeps.get(node.id);
    if (extra === undefined) return node;
    const newDeps = [...extra].filter((id) => !node.dependsOn.includes(id));
    if (newDeps.length === 0) return node;
    return { ...node, dependsOn: [...node.dependsOn, ...newDeps] };
  });
  return { success: true, nodes: updated };
}
