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
  // idWidth 4, not the default 3: every NFR id used anywhere else in the spec pack is 4 digits
  // (NFR-0002, NFR-0005, NFR-0007, NFR-0009); see SPEC-QUESTIONS.md Q21.
  { id: 'NFR', idPrefix: 'NFR', pathTemplate: 'specs/nfr/{id}.md', idWidth: 4 },
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
  // idWidth 4, not the default 3: the one HandoffRecord id example in the spec pack is 4 digits
  // (HO-0042); see SPEC-QUESTIONS.md Q24.
  {
    id: 'HandoffRecord',
    idPrefix: 'HO',
    pathTemplate: 'reports/handoffs.md',
    idWidth: 4,
    collection: true,
  },
  // Added post-v1.0, not part of the original 21: `10` §10.6's own canonical `implement-story` inner
  // loop and `05` §5.2's `reviewer` agent persona both already named `ReviewReport` as the real
  // output of the `review` step's `swarm-review` mode (`packages/templates/templates/workflows/
  // implement-story.workflow.yaml`'s own `outputs: [{ type: ReviewReport }]`, a real, load-bearing
  // step with `retry`/`onFailure: escalate`, not a stale or vestigial reference), but it was never
  // actually registered here -- `forge workflow validate --all` reported it as an unknown artifact
  // type on every fresh `forge init` until this fix. See `SPEC-QUESTIONS.md` for the full record.
  { id: 'ReviewReport', idPrefix: 'REVIEW', pathTemplate: 'sessions/reviews/{id}.md', idWidth: 3 },
] as const;

/** The 22 artifact type names `specs/18` §18.7 registers (21 original + `ReviewReport`, added
 * post-v1.0 -- see this array's own trailing entry for the full record). */
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
 * `SPEC-QUESTIONS.md` Q18. `PLAN-M1.md` P11 revisited this once every type's detailed schema existed
 * (Q18's own condition for doing so) and found two — ADR, SessionRecord — with a genuine, spec-given
 * `##`-heading list; see `SPEC-QUESTIONS.md` Q28. The other 19 stay `[]`: not an oversight, but the
 * same "no spec source, don't invent one" standard Q18 set, still correct for them.
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
/** The two types `SPEC-QUESTIONS.md` Q28 found a genuine, spec-given `##`-heading list for. */
const REQUIRED_SECTIONS: Partial<Record<ArtifactTypeId, readonly string[]>> = {
  // specs/08 §8.4's full worked example, top-level `##` headings only (`### Positive`/`### Negative`/
  // `### Follow-on work` are `###` subsections of Consequences, not additional top-level sections).
  ADR: ['Context', 'Options considered', 'Decision', 'Diagram', 'Consequences', 'Reversal plan'],
  // specs/16 §16.5's full worked example.
  SessionRecord: [
    'Frame',
    'Diverge',
    'Converge',
    'Decisions',
    'Non-decisions',
    'Actions',
    'KB write-back',
  ],
};

export const ARTIFACT_TYPES: readonly ArtifactTypeDefinition[] = RAW_ARTIFACT_TYPES.map((type) => ({
  ...type,
  requiredSections: REQUIRED_SECTIONS[type.id] ?? [],
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

/**
 * `18` §18.7's own path-template section-root segments: the literal first-segment words a
 * `pathTemplate` can open with (`outputs.ts`'s `sectionRoot` maps each to a project's configured
 * `DocRoots` value; this module knows nothing of `DocRoots` and only ever compares the literal
 * segment text). `'plans'` is included for symmetry with that same set even though no registry
 * `pathTemplate` opens with it today.
 */
const SECTION_ROOTS: ReadonlySet<string> = new Set(['specs', 'kb', 'plans', 'sessions', 'reports']);

/**
 * `type`'s `pathTemplate` with every placeholder turned into a glob fragment (`{id}-{slug}`/`{id}` ->
 * `<idPrefix>-*`, every other `{word}` -> `*`) and its leading section-root segment dropped -- UNLESS
 * dropping it would leave nothing but a bare file name (no interior `/` at all), in which case the
 * root stays. A path that reduces to a single remaining segment after its root (`HandoffRecord`'s
 * `handoffs.md`, `Risk`'s `risks.md`, `Vision`'s `vision.md`, ...) needs that root literally present
 * to remain a meaningful suffix to check a real declared path against -- a bare `handoffs.md` would
 * match a file of that name anywhere. A path with an interior directory after its root (`ADR`'s
 * `decisions/{id}-{slug}.md` -> `decisions/ADR-*.md`) does not need it: the interior segment already
 * gives the suffix its own specificity, and dropping the root is what makes the result independent of
 * which literal value a project configures for that section (`outputGlob`, `@forge/engine`, builds
 * the real configured-root glob on top of this very tail).
 *
 * A section root that is itself a placeholder (`Diagram`'s `{section}/views/{slug}.mmd`) is never one
 * of `SECTION_ROOTS`'s literal names, so it is never dropped either -- it becomes its own `*` segment
 * instead, exactly like any other placeholder (`registryTail('Diagram')` starts with a `*` segment,
 * then `views`, then `*.mmd`).
 *
 * Root-agnostic by construction: unlike `outputGlob`, this takes no `DocRoots` and can be (and is)
 * called from `@forge/agents`'s load-time loader, which has no project configuration to consult.
 *
 * @see specs/18 §18.7
 */
export function registryTail(type: ArtifactTypeId): string {
  const definition = definitionForType(type);
  const segments = definition.pathTemplate.split('/');
  const [first, ...rest] = segments;
  const dropRoot = first !== undefined && SECTION_ROOTS.has(first) && rest.length > 1;
  const tailSegments = dropRoot ? rest : segments;
  return tailSegments
    .join('/')
    .replace('{id}-{slug}', `${definition.idPrefix}-*`)
    .replace('{id}', `${definition.idPrefix}-*`)
    .replace(/\{\w+\}/g, '*');
}
