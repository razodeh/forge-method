/**
 * `compile` — `15` §15.2 rules 1–4: resolve all five layers into the six document kinds, reporting
 * install-order conflicts as warnings.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P9
 * @see SPEC-QUESTIONS.md Q41
 * @see SPEC-QUESTIONS.md Q42
 */
import { runInvariants, type InvariantViolation, type ScanTarget } from '../invariants/index.ts';
import {
  LAYER_ORDER,
  Resolver,
  type Layer,
  type LayerContribution,
  type ResolvedEntity,
} from '../resolve/index.ts';
import { scanTargetsFor } from './scan.ts';
import {
  DOCUMENT_KINDS,
  type CompileOptions,
  type CompileResult,
  type CompileSources,
  type CompileWarning,
  type CompiledDocuments,
  type DocumentKind,
} from './types.ts';

const LAYER_INDEX: Readonly<Record<Layer, number>> = Object.fromEntries(
  LAYER_ORDER.map((layer, index) => [layer, index]),
) as Record<Layer, number>;

/**
 * A value no real document would ever contain, used only to probe whether `Resolver.resolve` would
 * actually consult a supplied `extendedBase` for a given entity's own contributions — see
 * `probeExtendsTarget`'s own doc comment for why this replaces trying to statically replicate
 * `Resolver`'s internal `isEstablished` gate here.
 */
const PROBE_SENTINEL: unknown = Object.freeze({
  'forge-compile-probe-sentinel': '3f1c1d0e-9b7a-4b8b-8b8b-forge-p9-probe',
});

/**
 * The first `$extends` target `id`'s contributions declare, in `L0 → L4` order, or `undefined` if
 * none do. This is only a *candidate* — `probeExtendsTarget` decides whether `Resolver.resolve` would
 * actually consult it.
 */
function rawExtendsTarget(
  contributions: readonly LayerContribution[],
  id: string,
): string | undefined {
  const ordered = [...contributions].sort((a, b) => LAYER_INDEX[a.layer] - LAYER_INDEX[b.layer]);
  for (const contribution of ordered) {
    const document = contribution.document as Record<string, unknown> | null;
    const value = document?.['$extends'];
    if (typeof value === 'string' && value !== id) return value;
  }
  return undefined;
}

/**
 * Whether `id`'s own `$extends` (if any) would actually be consulted by `Resolver.resolve` — i.e.
 * whether an `extendedBase` genuinely matters for this entity, not just whether one of its
 * contributions happens to name one.
 *
 * `Resolver.resolve` only reads `extendedBase` "while nothing real has been established yet"
 * (`resolve.ts`'s own doc comment) — a per-contribution gate this piece cannot know the answer to by
 * inspecting raw documents alone: an earlier, *non*-`$extends` contribution may already establish
 * real content before a later contribution's own `$extends` is ever read, making that `$extends` a
 * documented no-op `Resolver` itself would never act on. Statically guessing "the first `$extends`
 * found" wrongly treats that no-op as a real dependency, which can misclassify an ordinary
 * (non-circular) relationship as a cycle and drop real content — instead of replicating `Resolver`'s
 * own internal gate here (a second copy of logic that could drift from the original), this asks the
 * real `Resolver` directly: resolving the same contributions with and without a distinctive
 * `PROBE_SENTINEL` as `extendedBase` produces an identical result exactly when `extendedBase` was
 * never actually consulted.
 *
 * Forcing a *non*-`undefined` `extendedBase` onto the probe can itself throw: a first contribution
 * that both has `$extends` and a bare array field only auto-wraps that array as `$set` on the
 * `base === undefined` seed path (`resolve.ts`'s own `wrapBareArraysForSeed`) — supplying any
 * placeholder base at all routes it through the plain merge path instead, where a bare array needs an
 * explicit operator. That throw can only happen when `!isEstablished` and a real `$extends` are both
 * true — exactly the condition under which `extendedBase` genuinely matters — so it is itself proof
 * of a real dependency, not a reason to fail the probe: the *real* resolve later (with the real
 * target's value, or `undefined` if the target never actually resolves to anything) decides on its
 * own merits whether that same throw is real.
 */
function probeExtendsTarget(
  resolver: Resolver,
  id: string,
  contributions: readonly LayerContribution[],
  withoutBase: ResolvedEntity,
): string | undefined {
  const candidate = rawExtendsTarget(contributions, id);
  if (candidate === undefined) return undefined;
  let withSentinel: ResolvedEntity;
  try {
    withSentinel = resolver.resolve(id, contributions, { extendedBase: PROBE_SENTINEL });
  } catch {
    return candidate;
  }
  const matters = JSON.stringify(withSentinel.value) !== JSON.stringify(withoutBase.value);
  return matters ? candidate : undefined;
}

interface PendingEntity {
  readonly id: string;
  readonly contributions: readonly LayerContribution[];
  readonly target: string | undefined;
  /** `resolver.resolve(id, contributions, {})` — reused as the final result whenever no real
   * `extendedBase` ends up applying, whether because there was none or because this entity turned
   * out to be part of a genuine cycle (see `resolveKind`). */
  readonly withoutBase: ResolvedEntity;
}

/**
 * Every entity id in `pending` that is a member of a genuine `$extends` cycle (A extends B extends
 * A, possibly longer). Each entity has at most one outgoing edge (`target`), so the dependency graph
 * is a *functional graph*: following `target` pointers from any entity either reaches a node outside
 * `pending` (safe — no cycle), reaches an already-fully-explored node (also safe — its own path was
 * already checked), or revisits a node still on the current path, which is exactly a cycle, made up
 * of that node and everything after it on the path. An entity merely *depending on* a cycle member —
 * without being one — is not a member itself, and must not be treated as unresolvable the way a
 * cycle's own members are.
 */
function findCycleMembers(pending: readonly PendingEntity[]): ReadonlySet<string> {
  const byId = new Map(pending.map((entity) => [entity.id, entity]));
  const cycleMembers = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();

  for (const start of pending) {
    if (state.has(start.id)) continue;
    const path: string[] = [];
    let currentId: string | undefined = start.id;
    while (currentId !== undefined) {
      const status = state.get(currentId);
      if (status === 'done') break;
      if (status === 'visiting') {
        const cycleStart = path.indexOf(currentId);
        for (const member of path.slice(cycleStart)) cycleMembers.add(member);
        break;
      }
      if (!byId.has(currentId)) break;
      state.set(currentId, 'visiting');
      path.push(currentId);
      currentId = byId.get(currentId)?.target;
    }
    for (const id of path) state.set(id, 'done');
  }

  return cycleMembers;
}

/**
 * Resolves every entity in `entities`, in an order where a `$extends` target is always resolved
 * before whatever names it — `Resolver` itself deliberately does not do this (its own doc comment:
 * "a caller with visibility across all entities... is what supplies `extendedBase`"). Every genuine
 * cycle member (`findCycleMembers`) resolves up front using `withoutBase` — the same result
 * `Resolver.resolve` itself already produces with no `extendedBase` at all — rather than this
 * function inventing a resolution order for an unresolvable graph; removing them first leaves a
 * genuinely acyclic graph for everything else, including an entity that merely *depends on* a cycle
 * member without being part of the cycle itself. An `$extends` target outside `entities` altogether
 * (e.g. a built-in this kind's own sources never listed) resolves the same way: no matching
 * already-resolved value, so `extendedBase` stays `undefined`.
 */
function resolveKind(
  entities: Readonly<Record<string, readonly LayerContribution[]>>,
): ReadonlyMap<string, ResolvedEntity> {
  const resolver = new Resolver();
  const entries = Object.entries(entities).sort(([a], [b]) => (a < b ? -1 : 1));

  const pending: PendingEntity[] = entries.map(([id, contributions]) => {
    const withoutBase = resolver.resolve(id, contributions, {});
    return {
      id,
      contributions,
      target: probeExtendsTarget(resolver, id, contributions, withoutBase),
      withoutBase,
    };
  });

  const resolved = new Map<string, ResolvedEntity>();
  const cycleMembers = findCycleMembers(pending);

  let remaining = pending.filter((entity) => {
    if (!cycleMembers.has(entity.id)) return true;
    resolved.set(entity.id, entity.withoutBase);
    return false;
  });

  while (remaining.length > 0) {
    const remainingIds = new Set(remaining.map((entity) => entity.id));
    // Cycle members are already resolved and removed above, so this graph is acyclic: at least one
    // entity here always has its own target already resolved (or none at all).
    const ready = remaining.filter(
      (entity) => entity.target === undefined || !remainingIds.has(entity.target),
    );
    for (const entity of ready) {
      const extendedBase =
        entity.target !== undefined ? resolved.get(entity.target)?.value : undefined;
      resolved.set(entity.id, resolver.resolve(entity.id, entity.contributions, { extendedBase }));
    }
    const readyIds = new Set(ready.map((entity) => entity.id));
    remaining = remaining.filter((entity) => !readyIds.has(entity.id));
  }

  return resolved;
}

function collectWarnings(
  kind: DocumentKind,
  entityId: string,
  entity: ResolvedEntity,
): CompileWarning[] {
  return entity.warnings.map((warning) => ({ ...warning, kind, entityId }));
}

/**
 * `${kind}:${entityId}` `ScanTarget`s across every resolved entity, for the two invariants
 * (`SPEC-QUESTIONS.md` Q42: I8, I9) this piece's own input actually carries the data for.
 */
function scanTargetsForDocuments(documents: CompiledDocuments): readonly ScanTarget[] {
  const targets: ScanTarget[] = [];
  for (const kind of DOCUMENT_KINDS) {
    for (const [entityId, entity] of documents[kind]) {
      targets.push(...scanTargetsFor(`${kind}:${entityId}`, entity.value));
    }
  }
  return targets;
}

export function compile(sources: CompileSources, options: CompileOptions = {}): CompileResult {
  const documents = Object.fromEntries(
    DOCUMENT_KINDS.map((kind) => [kind, resolveKind(sources[kind])]),
  ) as unknown as CompiledDocuments;

  const warnings: CompileWarning[] = [];
  for (const kind of DOCUMENT_KINDS) {
    for (const [entityId, entity] of documents[kind]) {
      warnings.push(...collectWarnings(kind, entityId, entity));
    }
  }

  let violations: readonly InvariantViolation[] = [];
  if (options.check === true) {
    violations = runInvariants({ scanTargets: scanTargetsForDocuments(documents) });
  }

  return { documents, violations, warnings };
}
