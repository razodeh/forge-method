/**
 * `resolveExtends` — `05` §5.3's own `extends: base-engineer`-shaped inheritance: plain single-parent
 * inheritance among shipped base agents (e.g. `backend`/`frontend`/`mobile` all extending a shared
 * `base-engineer`), distinct from `@forge/extensions`' own L0-L4 customization-layer resolution (M2 P2).
 *
 * A real, open design question this piece deliberately leaves for A2/A3 to resolve empirically, not
 * silently: `agentDefinitionSchema` (A1) marks only `extends`/`kb_propose`/`frameworks`/`skills`/`mcp`/
 * `ceiling` optional -- every other field, including `tools`/`limits`/`parallel_safety`/`gates`/`prompt`
 * (arguably the fields a real `backend`/`frontend`/`mobile extends base-engineer` scheme would most want
 * to share), is required on *every* document whether or not it declares `extends`. That means the merge
 * this file implements can only ever exercise real inheritance-on-omission for that small optional-field
 * set -- for every required field, a child must always fully redeclare it, and the merge degenerates to
 * "child always wins because it's always present." A fresh critic round flagged this as a genuine design
 * tension, not a bug in the merge itself (which is correctly implemented and tested for exactly the
 * fields it can exercise). Deliberately not fixed here: whether the right answer is a separate "partial
 * child" schema variant (distinct from this base-document schema, mirroring how `@forge/extensions`
 * already keeps its own *overlay* schema separate from a base document) is a real design decision best
 * made with actual data -- once A2/A3 try to author a real `base-engineer` plus real
 * `backend`/`frontend`/`mobile` children and see how much duplication that forces in practice.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import type { AgentDefinition } from '../schema/types.ts';
import type { AgentRegistry } from './registry.ts';

/** `05` §5.3 gives no algorithm for "layers a child's own fields over the parent's" beyond that one
 * sentence -- a real, invented resolution: a shallow, top-level-field merge (the child's own
 * `tools`/`limits`/etc. object replaces the parent's whole object when the child declares that field at
 * all, not a deep per-nested-property merge), matching the literal "on any field both declare" wording
 * (a *field*, not a nested property within one). A field the child's own YAML never declared at all
 * parses as `undefined` (every optional `AgentDefinition` field), and spreading that literal `undefined`
 * over the parent's real value would silently erase it -- filtered out here first, the same "only
 * genuinely-defined fields override" discipline `@forge/extensions/agents`'s own `mergeGrants` (M2 P3)
 * already established for the identical reason. */
function mergeChildOverParent(parent: AgentDefinition, child: AgentDefinition): AgentDefinition {
  const definedChildFields = Object.fromEntries(
    Object.entries(child).filter(([, value]) => value !== undefined),
  );
  return { ...parent, ...definedChildFields, id: child.id };
}

/** Resolves `id`'s own full `extends` chain (recursively -- `extends` may itself name an agent that
 * further extends another) and returns the fully-merged `AgentDefinition`. Throws for an id absent from
 * `registry` or a real circular `extends` chain -- both are authoring bugs in the shipped roster itself,
 * not ordinary malformed runtime input, matching this codebase's own "structural/config errors throw"
 * split (the same reasoning `@forge/methods`'s own `score.ts` uses for a caller-contract violation). */
export function resolveExtends(id: string, registry: AgentRegistry): AgentDefinition {
  const seen = new Set<string>();
  let current = registry.get(id);
  if (current === undefined) throw new Error(`resolveExtends: no agent "${id}" in this registry.`);

  const chain: AgentDefinition[] = [current];
  seen.add(current.id);

  while (current.extends !== undefined) {
    if (seen.has(current.extends)) {
      throw new Error(
        `resolveExtends: circular extends chain detected at "${current.extends}" (starting from "${id}").`,
      );
    }
    const parent = registry.get(current.extends);
    if (parent === undefined) {
      throw new Error(
        `resolveExtends: "${current.id}" extends "${current.extends}", which is not in this registry.`,
      );
    }
    chain.push(parent);
    seen.add(parent.id);
    current = parent;
  }

  // `chain` is [id, id's parent, grandparent, ...root]; fold from the root outward so each merge sees
  // an already-fully-resolved ancestor, then the original `id` document's own fields win last.
  return chain.reduceRight((resolved, next) => mergeChildOverParent(resolved, next));
}
