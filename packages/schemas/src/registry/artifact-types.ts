/**
 * `ARTIFACT_TYPES` — `specs/18` §18.7's registry table, transcribed verbatim.
 *
 * The one place this data is authored. Paths, ID widths, and parent edges are all *derived* from
 * this array elsewhere (`renderArtifactPath`, `baseFrontMatterSchema`'s per-type id check) rather
 * than re-declared, so a change to the registry cannot leave a derived rule out of sync with it.
 *
 * @see specs/18 §18.7
 */

/**
 * The array is written with `as const` so TypeScript infers each `id` as its own string literal
 * rather than widening to `string` — `ArtifactTypeId` below is derived directly from those literals,
 * and every `parent` reference is checked against that same derived union by the `satisfies` clause
 * further down, so a typo in a `parent` value (a type name that is not itself a registered `id`) is a
 * compile error rather than a silent dangling reference.
 */
const RAW_ARTIFACT_TYPES = [
  {
    id: 'Vision',
    idPrefix: 'VIS',
    pathTemplate: 'specs/vision.md',
    idWidth: 3,
    cardinality: 'one',
  },
  {
    id: 'Capability',
    idPrefix: 'CAP',
    pathTemplate: 'specs/capabilities/{id}.md',
    idWidth: 3,
    parent: 'Vision',
  },
  { id: 'NFR', idPrefix: 'NFR', pathTemplate: 'specs/nfr/{id}.md', idWidth: 3 },
  {
    id: 'Epic',
    idPrefix: 'EPIC',
    pathTemplate: 'specs/epics/{id}.md',
    idWidth: 3,
    parent: 'Capability',
  },
  {
    id: 'Story',
    idPrefix: 'STORY',
    pathTemplate: 'specs/stories/{id}-{slug}.md',
    idWidth: 3,
    parent: 'Epic',
  },
  {
    id: 'Task',
    idPrefix: 'TASK',
    pathTemplate: 'specs/tasks/{id}.md',
    idWidth: 3,
    parent: 'Story',
  },
  { id: 'ADR', idPrefix: 'ADR', pathTemplate: 'kb/decisions/{id}-{slug}.md', idWidth: 4 },
  {
    id: 'InterfaceContract',
    idPrefix: 'INT',
    pathTemplate: 'specs/interfaces/{name}.yaml',
    idWidth: 3,
  },
  { id: 'DataModel', idPrefix: 'DM', pathTemplate: 'specs/data/{id}-{slug}.md', idWidth: 3 },
  { id: 'Diagram', idPrefix: 'DIAG', pathTemplate: '{section}/views/{slug}.mmd', idWidth: 3 },
  {
    id: 'Risk',
    idPrefix: 'RISK',
    pathTemplate: 'kb/risks.md',
    idWidth: 3,
    collection: true,
  },
  {
    id: 'Assumption',
    idPrefix: 'ASM',
    pathTemplate: 'kb/assumptions.md',
    idWidth: 3,
    collection: true,
  },
  {
    id: 'OpenQuestion',
    idPrefix: 'OQ',
    pathTemplate: 'kb/open-questions.md',
    idWidth: 3,
    collection: true,
  },
  {
    id: 'Waiver',
    idPrefix: 'WAIVER',
    pathTemplate: 'reports/waivers.md',
    idWidth: 3,
    collection: true,
  },
  {
    id: 'SessionRecord',
    idPrefix: 'SESSION',
    pathTemplate: 'sessions/{id}-{slug}.md',
    idWidth: 3,
  },
  { id: 'RCA', idPrefix: 'RCA', pathTemplate: 'sessions/rca/{id}-{slug}.md', idWidth: 3 },
  { id: 'Defect', idPrefix: 'DEF', pathTemplate: 'reports/defects/{id}.md', idWidth: 3 },
  {
    id: 'Environment',
    idPrefix: 'ENV',
    pathTemplate: 'kb/delivery/environments.md',
    idWidth: 3,
    collection: true,
  },
  { id: 'Runbook', idPrefix: 'RUN', pathTemplate: 'kb/ops/runbooks/{id}-{slug}.md', idWidth: 3 },
  { id: 'GateReport', idPrefix: 'GATE', pathTemplate: 'reports/gates/{gate}-{ts}.md', idWidth: 3 },
  {
    id: 'HandoffRecord',
    idPrefix: 'HO',
    pathTemplate: 'reports/handoffs.md',
    idWidth: 3,
    collection: true,
  },
] as const;

/** The 21 artifact type names `specs/18` §18.7 registers. */
export type ArtifactTypeId = (typeof RAW_ARTIFACT_TYPES)[number]['id'];

/**
 * One row of the `specs/18` §18.7 registry.
 *
 * `requiredSections` is declared here per `PLAN-M1.md` P5's surface and `18` §18.6's mention of a
 * per-type required-section list for body-structure validation, but §18.7's table — the one this
 * file transcribes — does not enumerate a value for any of the 21 types, and no other spec section
 * does either (the only concrete example, `specs/08` §8.3's Statement/Rationale/Implications/
 * Verification, is for a knowledge-base entry, a different artifact family with its own `KB-*-####`
 * id scheme, out of this registry). Left `[]` for every type here rather than invented; see
 * `SPEC-QUESTIONS.md` Q18.
 */
export interface ArtifactTypeDefinition {
  readonly id: ArtifactTypeId;
  readonly idPrefix: string;
  readonly pathTemplate: string;
  readonly idWidth: number;
  readonly parent?: ArtifactTypeId;
  readonly cardinality?: 'one';
  readonly collection?: true;
  readonly requiredSections: readonly string[];
}

/**
 * `RAW_ARTIFACT_TYPES` assigned to this type is what checks every `parent` value names a real `id`:
 * if a row's `parent` were misspelled, the object literal would no longer be assignable to
 * `ArtifactTypeDefinition`'s `parent?: ArtifactTypeId`, and `tsc` would fail on this line.
 */
export const ARTIFACT_TYPES: readonly ArtifactTypeDefinition[] = RAW_ARTIFACT_TYPES.map((type) => ({
  ...type,
  requiredSections: [],
}));

/**
 * Looks up a type by its exact name (the registry's `id`, e.g. `"Story"`).
 *
 * Takes a plain `string` rather than `ArtifactTypeId`: the common caller already knows the type at
 * compile time and does not need this function, but the one that matters — front-matter validation
 * parsing an untrusted `type:` field off disk — has only a string, and a signature that could not
 * accept it would be useless at the one call site that needs a lookup at all.
 */
export function artifactTypeById(id: string): ArtifactTypeDefinition | undefined {
  return ARTIFACT_TYPES.find((type) => type.id === id);
}

/** Looks up a type by its `idPrefix` (e.g. `"STORY"`, parsed off an artifact id like `STORY-014`). */
export function artifactTypeByPrefix(prefix: string): ArtifactTypeDefinition | undefined {
  return ARTIFACT_TYPES.find((type) => type.idPrefix === prefix);
}

/**
 * A `Record` over the full, finite `ArtifactTypeId` union rather than a general-purpose,
 * possibly-missing lookup: `noUncheckedIndexedAccess` treats indexing a closed `Record<SomeUnion, T>`
 * by a value already narrowed to `SomeUnion` as definite, not `T | undefined` — which
 * `artifactTypeById(id: string)` can never be, honestly, since it accepts untrusted input. This is
 * what lets `definitionForType` below return a bare `ArtifactTypeDefinition` for a caller who already
 * has a real `ArtifactTypeId`, with no `undefined` branch to write, test, or leave dead.
 *
 * Built via `Object.fromEntries` and cast, rather than declared as an object literal, so a 22nd row
 * added to `RAW_ARTIFACT_TYPES` is reflected here automatically. The cast is sound because every
 * `type.id` in `ARTIFACT_TYPES` is, by construction, a member of `ArtifactTypeId` — there is no id
 * this map could fail to have an entry for.
 */
const DEFINITION_BY_ID: Record<ArtifactTypeId, ArtifactTypeDefinition> = Object.fromEntries(
  ARTIFACT_TYPES.map((type) => [type.id, type]),
) as Record<ArtifactTypeId, ArtifactTypeDefinition>;

/** The registered definition for a compile-time-known `ArtifactTypeId` — never `undefined`. */
export function definitionForType(id: ArtifactTypeId): ArtifactTypeDefinition {
  return DEFINITION_BY_ID[id];
}
