/**
 * The output contract check (`PLAN-M13.md` P7): what block [1] of every agent prompt promises ("output that
 * fails validation is rejected", `05` §5.5) made true. After an `agent` step's session ends ok, each entry
 * of the step's declared `outputs` must exist at its `18` §18.7 registry location among the files the
 * session produced, and validate against its artifact schema; otherwise the step fails with a typed
 * `validation`-class failure (`source: 'output'`, `RUN-083`/`RUN-084`) instead of being reported as
 * succeeded. Before this, a 177-second real session that wrote nothing was recorded `StepSucceeded`
 * (`SPEC-QUESTIONS.md` Q208, finding 4).
 *
 * **Which tree.** The check runs in `runLaneLifecycle` after the session, the commit and claim enforcement
 * (`06` §6.4, §6.7; both run only when the adapter reports changed files, so an agent that commits its own
 * work leaves enforcement skipped, as for every step), against the lane branch's *committed* state (`git diff <base> HEAD`, content read from
 * the object database): that, and nothing else, is what a later `merge` step carries into the integration
 * branch. A file that exists only in the worktree, or that claim enforcement reverted, is not a produced
 * output, and the failure message says which of those happened.
 *
 * **"Produced by this session"** is the lane branch's diff against its base sha: a matching file that
 * already existed and was not touched does not satisfy the contract (else a step that wrote nothing would
 * pass on the strength of an earlier step's work). For a register file (`collection: true`, one file
 * holding many entries) the unit is the *entry*: an entry counts if its id is new or its content differs
 * from the base version.
 *
 * **Locating a file.** `18` §18.7's path templates, rooted at the project's configured `paths` (`specs`,
 * `kb`, `sessions`, `reports`), become globs: `{id}` matches `<PREFIX>-*`, every other placeholder `*`, so
 * a template whose id nobody can know in advance is matched over the lane diff, never skipped. The file
 * paths come from git's own diff listing and are only ever matched against that glob and read through
 * `git show`; no path an agent supplies is opened on disk.
 *
 * **The claim.** The same registry globs are the step's claim (`resolveStepClaim`, `PLAN-M13.md` P14, `06` §6.7):
 * `enforceClaim` is handed `produces` plus these globs, and a step that declares outputs is enforced `strict`
 * at every autonomy level, so the output the check will demand is by construction never reverted. Anything
 * outside `produces` and the outputs still is, and the revert is named in the `LaneCommitted` event.
 *
 * **Validation** reuses the validators `forge spec validate` and `forge kb lint` run: `validateArtifact`
 * (`@forge/core/artifacts`, `18` §18.6's two phases) for single-document types, and the register-file
 * schemas `parseKbTree` uses (`@forge/schemas`) for the register types. Where no register schema exists
 * (HandoffRecord, Waiver: `SPEC-QUESTIONS.md` Q23) each entry is checked against the entry schema.
 *
 * **Cardinality** (`one`, the default, or `many`): both require at least one produced file, and every
 * produced file is validated; a `one` output that finds several matching files (a step that also updated
 * an older artifact) is not an error.
 *
 * **Subtype** narrows: a SessionRecord's `sessionType` must be the subtype's canonical form (the workflow
 * DSL's `retrospective` is the `retro` session type, `16` §16.2); for every other type at least one
 * produced file (or produced register entry) must carry the subtype as a hyphenated word in its `step` value or a
 * `delivered` item (the two conventions the shipped briefs use, since the entry has no `subtype` key; five
 * briefs record a `step` that does not contain the subtype word and so fail this rule, `SPEC-QUESTIONS.md`
 * Q209).
 *
 * **KB output invariants** (`PLAN-M14.md` P11, `08` §8.6's `KbWriter` invariants, which bind a declared
 * output exactly as they bind a `KbWriter` write): for the six KB-located types (`ADR`, `Runbook`, `Risk`,
 * `Assumption`, `OpenQuestion`, `Environment` -- registry `pathTemplate` starting `kb/`), every produced
 * document and every new or changed register entry must carry at least one `sources` item, and every
 * register entry id present at the base revision must still be present at HEAD (it may gain
 * `status: deprecated`/`superseded`, or `resolved` for `OpenQuestion`, where its schema has one, but is
 * never simply removed from the file). Neither rule is schema-enforced (`sources` is optional on all six
 * types, `PLAN-M14.md` P11's own Mandate) -- only this check applies them, the same "the declared-output path is
 * checked to the KbWriter rules by the output contract instead" split `08` §8.6's own closing paragraph
 * states; `forge spec validate`/`forge kb lint` do not.
 *
 * @see specs/05 §5.5
 * @see specs/06 §6.8
 * @see specs/08 §8.6
 * @see specs/18 §18.6, §18.7
 * @see PLAN-M13.md P7
 * @see PLAN-M14.md P8, P10, P11
 * @see SPEC-QUESTIONS.md Q208
 */
import { posix } from 'node:path';

import { ArtifactDocument, parseFrontMatterYaml, validateArtifact } from '@forge/core/artifacts';
import { ForgeError, isForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, ProjectPaths, type AbsolutePath } from '@forge/core/fs';
import {
  assumptionsFileSchema,
  baseFrontMatterShape,
  definitionForType,
  artifactTypeById,
  diagramSchema,
  environmentsFileSchema,
  handoffRecordSchema,
  interfaceContractSchema,
  openQuestionsFileSchema,
  registryTail,
  risksFileSchema,
  waiverSchema,
  type ArtifactTypeDefinition,
  type ArtifactTypeId,
} from '@forge/schemas';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { escape as escapeGlob, minimatch } from 'minimatch';
import type { z } from 'zod';

import type { StepNode } from '../plan/index.ts';
import { NEVER_WRITABLE_GLOBS, protectedFixGlobs } from '../rca/fix-scan.ts';
import type {
  DocRoots,
  ExecuteStepContext,
  LaneHandle,
  StepFailureInfo,
  VcsFacade,
} from './types.ts';

/** The configured root a `18` §18.7 template's first segment names (`specs`, `kb`, `sessions`, `reports`),
 * or (`PLAN-M14.md` P6, `SPEC-QUESTIONS.md` Q232 decision 3) a `produces` glob's own leading segment
 * (`plans` besides: no registry template opens with it, but `docs/forge/plans/...` is a real, shipped
 * `produces` root -- `plan-stages.workflow.yaml` -- that must follow `paths.plans` too). */
function sectionRoot(segment: string, roots: DocRoots): string | undefined {
  switch (segment) {
    case 'specs':
      return roots.specs;
    case 'kb':
      return roots.kb;
    case 'plans':
      return roots.plans;
    case 'sessions':
      return roots.sessions;
    case 'reports':
      return roots.reports;
    default:
      return undefined;
  }
}

/** A configured root as a plain repo-relative POSIX prefix: `./docs/specs/` becomes `docs/specs` and `.`
 * becomes empty. Paths from git's listing never start with `./`, so an unnormalised root would match
 * nothing and fail every output of the project. */
function normalizeRoot(root: string): string {
  const normalized = posix.normalize(root.replace(/\\/g, '/')).replace(/\/+$/, '');
  return normalized === '.' ? '' : normalized;
}

/** How a glob is matched: `!`/`#` prefixes in a configured root are literal, never negation or a comment. */
const MATCH_OPTIONS = { dot: true, nonegate: true, nocomment: true } as const;

/**
 * `18` §18.7's path template for `type`, as a glob under the project's configured roots. The first segment
 * (`specs`, `kb`, `sessions`, `reports`) is replaced by that root; a template that opens with a placeholder
 * (`Diagram`'s `{section}/views/...`) lives in the knowledge body. Roots are escaped, so a root with glob
 * characters matches literally instead of widening the match.
 *
 * Built on `registryTail` (`@forge/schemas`, `PLAN-M14.md` P33): that root-agnostic function already turns
 * every placeholder into a glob fragment and drops the type's own literal section-root segment wherever
 * doing so leaves a still-specific suffix (an interior directory), keeping it only where the template would
 * otherwise reduce to a bare file name (`HandoffRecord`'s `handoffs.md`, `Risk`'s `risks.md`, ...). Either
 * way, this function's own job is unchanged: substitute the project's CONFIGURED root for whichever literal
 * section name the template opens with (or fall back to `roots.kb`, exactly as before, for a placeholder
 * root) -- if `registryTail`'s own result still carries that literal name as its own leading segment, it is
 * peeled off first so the configured root is not doubled; every existing result stays byte-identical.
 */
export function outputGlob(type: ArtifactTypeId, roots: DocRoots): string {
  const definition = definitionForType(type);
  const first = definition.pathTemplate.split('/')[0] ?? '';
  const root = normalizeRoot(sectionRoot(first, roots) ?? roots.kb);
  const tail = registryTail(type);
  const relative = tail.startsWith(`${first}/`) ? tail.slice(first.length + 1) : tail;
  return root === '' ? relative : `${escapeGlob(root, { magicalBraces: true })}/${relative}`;
}

/**
 * The concrete repo-relative path of one artifact of `type` with id `id`, under the same configured roots
 * `outputGlob` uses (`PLAN-M13.md` P17: the engine writes the swarm-review `ReviewReport` itself and must
 * put it exactly where the output check looks). A template whose file name needs more than the id (`{slug}`,
 * `{gate}`) is refused: the engine cannot know those, and a glob-only type is never engine-written.
 * Unlike `outputGlob` the root is not glob-escaped: this is a path to write, not a pattern to match.
 */
export function outputPathFor(type: ArtifactTypeId, roots: DocRoots, id: string): string {
  const definition = definitionForType(type);
  const [first = '', ...rest] = definition.pathTemplate.split('/');
  const named = sectionRoot(first, roots);
  const root = normalizeRoot(named ?? roots.kb);
  const tail = (named === undefined ? [first, ...rest] : rest).join('/').replace('{id}', id);
  if (/\{\w+\}/.test(tail)) {
    throw new RangeError(
      `outputPathFor: the ${type} path template ${definition.pathTemplate} needs more than an id`,
    );
  }
  return root === '' ? tail : `${root}/${tail}`;
}

/**
 * Whether any of `globs` (an agent's `parallel_safety.file_ownership`, say) covers a path an output of
 * `type` could be written to: the registry glob read with each `*` as a concrete `x`. A definition-level
 * question, asked by the repository's known-gap inventory (`test/output-contract-known-gaps.test.ts`); the
 * check itself never consults an agent's ownership.
 */
export function outputPathCoveredBy(
  type: ArtifactTypeId,
  roots: DocRoots,
  globs: readonly string[],
): boolean {
  const sample = outputGlob(type, roots).replace(/\\/g, '').replace(/\*/g, 'x');
  return globs.some((glob) => minimatch(sample, glob, MATCH_OPTIONS));
}

/** A glob no path in a lane diff can match: it climbs out of the repository or is absolute. */
function escapesRepository(glob: string): boolean {
  return glob.startsWith('/') || glob === '..' || glob.startsWith('../') || /^[A-Za-z]:/.test(glob);
}

/**
 * The claim globs one declared output contributes: its registry glob (`outputGlob`, the very derivation
 * the output check locates the file with, so the two cannot drift), plus for a `Diagram` its
 * `<path>.yaml` sidecar, which the check demands be produced too (`08` §8.11). A type the registry does
 * not know contributes nothing (the output check fails it loudly), and a glob that climbs out of the
 * repository (a configured root of `../elsewhere`) is dropped rather than admitted: it can match no
 * path git lists, and the output then fails as missing instead of being written outside the project.
 * A leading `!` or `#` is escaped so the claim matcher, which keeps glob negation and comments on, reads
 * the configured root literally.
 */
export function outputClaimGlobs(outputs: StepNode['outputs'], roots: DocRoots): readonly string[] {
  const globs: string[] = [];
  for (const output of outputs) {
    const definition = artifactTypeById(output.type);
    if (definition === undefined) continue;
    const glob = outputGlob(definition.id, roots);
    for (const candidate of definition.id === 'Diagram' ? [glob, `${glob}.yaml`] : [glob]) {
      if (escapesRepository(candidate)) continue;
      globs.push(/^[!#]/.test(candidate) ? `\\${candidate}` : candidate);
    }
  }
  return [...new Set(globs)];
}

/** What `runLaneLifecycle` hands `enforceClaim` for one step. */
export interface StepClaim {
  /** The paths the step may write. EMPTY means the step may write nothing: the session gets no `write` grant
   * (`assemble.ts`, `PLAN-M13.md` P36) and, if it writes anyway, every path is out of claim. */
  readonly globs: readonly string[];
  /** Paths inside `globs` the step still may not write (`resolveStepClaim`): subtracted, never unioned. */
  readonly exclude: readonly string[];
  /** The claim names the protected set (`!@protected`): a project-wide claim, less what such a step may never write. */
  readonly protectedSet: boolean;
  readonly policy: 'strict' | 'warn';
}

/**
 * `06` §6.7 as amended (`PLAN-M13.md` P14, `SPEC-QUESTIONS.md` Q212): the paths an `agent` step may write are
 * its `produces` globs plus the registry paths of its declared `outputs`, and a step that declares
 * `outputs` is enforced `strict` whatever the project's default (`defaultPolicy`, from autonomy and
 * adoption): its claim is complete by construction, so `strict` can only revert what is neither a
 * declared output nor a declared `produces`. Any other step keeps `produces` and the default policy;
 * `command` steps too, because their declared outputs are ignored (the check does not run for them, so
 * nothing would confine a declared output the shell never writes).
 */
export function resolveStepClaim(
  node: Pick<StepNode, 'kind' | 'outputs' | 'produces'> & { readonly taint?: StepNode['taint'] },
  roots: DocRoots,
  defaultPolicy: 'strict' | 'warn',
): StepClaim {
  // A tainted step (`20` §20.5 point 3) is held to its claim at every autonomy level: `warn` would keep what it wrote
  // outside it (`PLAN-M13.md` P28).
  const policy = node.taint === 'external' ? 'strict' : defaultPolicy;
  const own = splitClaim(node.produces, roots);
  const protectedSet = node.produces.includes(PROTECTED_CLAIM_EXCLUSION);
  if (node.kind !== 'agent' || node.outputs.length === 0) {
    // An agent step with an EMPTY claim is granted no write (`assemble.ts`); whatever it changes anyway got past that
    // grant, so it is reverted at every autonomy level, not kept and flagged under `warn` (`PLAN-M13.md` P36).
    const bypass = node.kind === 'agent' && own.globs.length === 0;
    return {
      globs: own.globs,
      exclude: [...floorFor(node), ...own.excluded],
      protectedSet,
      policy: bypass ? 'strict' : policy,
    };
  }
  return {
    globs: [...new Set([...own.globs, ...outputClaimGlobs(node.outputs, roots)])],
    exclude: [...floorFor(node), ...own.excluded],
    protectedSet,
    policy: 'strict',
  };
}

/** The reserved `produces` exclusion that names the protected set (`protectedFixGlobs`): `!@protected`. */
export const PROTECTED_CLAIM_EXCLUSION = '!@protected';

/** `18` §18.3's `paths` keys a `produces` glob's own leading segments can spell in the SHIPPED default
 * layout (`DEFAULT_CONFIG.paths`, `defaults.ts:25-32`), paired with the literal default value
 * `resolveDocsRootPrefix` compares a glob's prefix against. `code` is excluded: no `18` §18.7 registry
 * root nor any shipped `produces` glob ever names it as a docs-root shorthand. */
const DOC_ROOT_SECTIONS: readonly (readonly [
  'kb' | 'specs' | 'plans' | 'sessions' | 'reports',
  string,
])[] = (['kb', 'specs', 'plans', 'sessions', 'reports'] as const).map(
  (section) => [section, DEFAULT_CONFIG.paths[section]] as const,
);

/** Whether `glob` opens with `prefix` at a path-segment boundary: matches `prefix` itself and
 * `prefix/...`, never a same-prefixed sibling segment (`docs/forge/kb` must not match `docs/forge/kbx`,
 * `SPEC-QUESTIONS.md` Q216/Q232 decision 3's own counter-example). */
function opensWithSegment(glob: string, prefix: string): boolean {
  return glob === prefix || glob.startsWith(`${prefix}/`);
}

/** Escapes a leading `!`/`#` so the real claim matcher (`@forge/vcs`'s `enforceClaim`, negation and
 * comments both left on) reads it literally instead of as a second-level negation or a comment -- the
 * identical escape `outputClaimGlobs` applies to a registry root, just above. */
function escapeLeadingMarker(glob: string): string {
  return /^[!#]/.test(glob) ? `\\${glob}` : glob;
}

/**
 * Rewrites `glob`'s leading segments from a SHIPPED DEFAULT docs root (`DOC_ROOT_SECTIONS`) to the
 * project's own CONFIGURED root for that section (`roots`), so a `produces` glob (or a brief's own
 * `docs/forge/<section>/...` text) written against the shipped default layout still names the right path
 * after `forge config set paths.<section> <elsewhere>` (`SPEC-QUESTIONS.md` Q216: "58 references become
 * uncovered"; `Q232` decision 3: engine expansion, one place, workflow YAML stays authorable). Segment-
 * boundary matched (`opensWithSegment`): `docs/forge/kbx` is untouched, and the bare root
 * (`docs/forge/kb`, no trailing segment) becomes the configured root with no trailing slash. The
 * configured root is glob-escaped (the identical treatment `outputGlob` gives a configured root) since it
 * names a real directory, never a pattern the workflow's author wrote -- the REST of `glob`, the author's
 * own glob syntax, is left exactly as written. A leading `!`/`#` in the rewritten result (a configured
 * root that starts with one) is itself escaped (`escapeLeadingMarker`), matching `outputClaimGlobs`
 * above. `escapesRepository` runs on the NORMALIZED root, not the raw configured string (a fresh critic
 * round caught the earlier ordering: `paths.specs: 'a/../../elsewhere'` does not itself start with `/` or
 * `../`, so the raw-string check let it through, but `normalizeRoot` collapses it to `'../elsewhere'`,
 * which very much climbs out of the repository -- `outputClaimGlobs`'s own identical check runs on its
 * already-built, already-normalized glob for the same reason). A climbing or absolute root drops the
 * entry (`undefined`) rather than admitting a path that can match nothing inside a lane diff; so does a
 * bare root (no trailing segment left in `glob`) whose configured root itself normalizes to the project
 * root (`''`) -- the one shape this rewrite can otherwise turn into an empty-string glob, which matches
 * no real path either; an author who means "claim the whole project" writes `produces: ['**']`, not this
 * coincidence. An entry matching no default root's segments passes through unchanged -- including,
 * trivially, under the shipped default layout, where every configured root equals its own default: this
 * rewrite is the identity transform there, for every shipped claim.
 */
function resolveDocsRootPrefix(glob: string, roots: DocRoots): string | undefined {
  for (const [section, defaultRoot] of DOC_ROOT_SECTIONS) {
    if (!opensWithSegment(glob, defaultRoot)) continue;
    const configured = sectionRoot(section, roots) ?? defaultRoot;
    const root = normalizeRoot(configured);
    if (escapesRepository(root)) return undefined;
    const rest = glob.slice(defaultRoot.length);
    if (root === '' && rest === '') return undefined;
    const rewritten =
      root === '' ? rest.replace(/^\//, '') : `${escapeGlob(root, { magicalBraces: true })}${rest}`;
    return escapeLeadingMarker(rewritten);
  }
  return glob;
}

/**
 * `produces` with each entry's docs-root prefix resolved to the project's configured root
 * (`resolveDocsRootPrefix`), `produces` SHAPE preserved: a `!`-prefixed exclusion keeps its `!` (only the
 * glob after it is rewritten), and the reserved `!@protected` (`PROTECTED_CLAIM_EXCLUSION`) is untouched
 * -- it names no docs-root prefix itself, `protectedFixGlobs` reads the configured roots directly. This
 * is what `assemble.ts` hands `packForStep` and `compilePrompt` in place of the raw `node.produces`
 * (`PLAN-M14.md` P6, `SPEC-QUESTIONS.md` Q232 decision 3), so block [5] (`compile-prompt.ts`'s
 * `renderOutputContractBlock`) and the skill activation filter (`pack-for-step.ts`'s
 * `matchesStepFileClaim`) see the path a session is actually held to, under a relocated layout too. Not a
 * claim itself (`splitClaim`, just below, builds the real claim on top of this): an entry a configured
 * root would take outside the repository is dropped here exactly as the claim itself drops it, never
 * shown as though it were still writable.
 */
export function resolveProduces(produces: readonly string[], roots: DocRoots): readonly string[] {
  const resolved: string[] = [];
  for (const entry of produces) {
    if (entry === PROTECTED_CLAIM_EXCLUSION) {
      resolved.push(entry);
      continue;
    }
    if (entry.startsWith('!')) {
      const rewritten = resolveDocsRootPrefix(entry.slice(1), roots);
      if (rewritten !== undefined) resolved.push(`!${rewritten}`);
      continue;
    }
    const rewritten = resolveDocsRootPrefix(entry, roots);
    if (rewritten !== undefined) resolved.push(rewritten);
  }
  return resolved;
}

/**
 * A `produces` list split into the paths a step may write and the paths it may not (`PLAN-M13.md` P36, `06` §6.7). An entry
 * that starts `!` is an exclusion: `!<glob>` removes matching paths from the claim, and the reserved `!@protected`
 * removes FORGE's protected set (`protectedFixGlobs`: CI and hook configuration, package manifests and test-runner config,
 * credentials and `.env*`, editor and agent-tool config, the project's document roots), the very list a `forge debug` FIX
 * is held to, so what a fix may not touch and what a project-wide step may not touch cannot drift. Exclusions are never
 * part of `globs`: `enforceClaim` reads its globs as a union, where a `!` entry would widen the claim instead. Splits
 * `resolveProduces`'s own output (`PLAN-M14.md` P6), so a `docs/forge/<section>/` prefix is already the configured root by
 * the time this looks at `!`/`!@protected`.
 */
function splitClaim(
  produces: readonly string[],
  roots: DocRoots,
): { readonly globs: readonly string[]; readonly excluded: readonly string[] } {
  const globs: string[] = [];
  const excluded: string[] = [];
  for (const entry of resolveProduces(produces, roots)) {
    if (entry === PROTECTED_CLAIM_EXCLUSION) excluded.push(...protectedFixGlobs(roots));
    else if (entry.startsWith('!')) excluded.push(entry.slice(1));
    else globs.push(entry);
  }
  return { globs, excluded };
}

/** What an agent step's claim never reaches, whatever it says: `NEVER_WRITABLE_GLOBS` (`.git`, `.forge`, `.env`), so a
 * story's `files_expected` or a `produces` that names them does not make them writable (`20` §20.2 point 2, §20.5 point 5).
 * Only for an `agent` step: a `command` step's claim is not enforced against a session. */
function floorFor(node: Pick<StepNode, 'kind'>): readonly string[] {
  return node.kind === 'agent' ? NEVER_WRITABLE_GLOBS : [];
}

/** The DSL's `subtype` spelled as the artifact's own field value, where the two differ. */
const SUBTYPE_ALIASES: Readonly<Partial<Record<ArtifactTypeId, Readonly<Record<string, string>>>>> =
  {
    SessionRecord: { retrospective: 'retro' },
  };

/** Register types whose file-level schema `@forge/schemas` defines (the ones `parseKbTree` validates). */
const REGISTER_SCHEMAS: Readonly<
  Partial<Record<ArtifactTypeId, { readonly schema: z.ZodTypeAny; readonly key: string }>>
> = {
  Risk: { schema: risksFileSchema, key: 'risks' },
  Assumption: { schema: assumptionsFileSchema, key: 'assumptions' },
  OpenQuestion: { schema: openQuestionsFileSchema, key: 'open_questions' },
  Environment: { schema: environmentsFileSchema, key: 'environments' },
};

/** Register types with only an entry schema and no specified file wrapper (`SPEC-QUESTIONS.md` Q23). */
const ENTRY_ONLY_SCHEMAS: Readonly<Partial<Record<ArtifactTypeId, z.ZodTypeAny>>> = {
  HandoffRecord: handoffRecordSchema,
  Waiver: waiverSchema,
};

/** The UTF-8 BOM, spelled by code point rather than as a literal (invisible) source character. */
const BOM = String.fromCharCode(0xfeff);

const BASE_KEYS: readonly string[] = Object.keys(baseFrontMatterShape.shape);

export interface OutputCheckInput {
  readonly node: Pick<StepNode, 'id' | 'agent' | 'outputs'>;
  readonly vcs: Pick<VcsFacade, 'changedFiles' | 'readAtRevision'>;
  readonly lane: LaneHandle;
  /** The sha the lane branched from: what "produced by this session" is measured against. */
  readonly baseSha: string;
  readonly docRoots: DocRoots;
  /** Paths claim enforcement reverted after the session: named in the failure when one of them was the
   * missing output. */
  readonly claimReverted: readonly string[];
  /** The agent's own grant forbids writing files: the cause to name when an output is missing. */
  readonly writeForbidden: boolean;
  /** The step's own supervisor reservation for its declared KB-located outputs (`reserveDeclaredKbOutputIds`,
   * `dispatch/output-ids.ts`, `PLAN-M14.md` P8), keyed by output `type` (`"ADR"`, not the type's
   * `idPrefix`) -- `undefined` when this call made no fresh reservation of its own (a resumed session
   * continuation reuses the prompt a PRIOR call already reserved for; nothing new to check this call, so
   * the range rule below is skipped rather than guessed at). Every id of a KB-located type that this
   * step's session produced and that is absent at `baseSha` must lie in this reservation and be used
   * contiguously from its own base, in order; an id already present at `baseSha` is an update to an
   * existing artifact, not a new one, and is exempt (`SPEC-QUESTIONS.md` Q232 decision 2, `PLAN-M14.md`
   * P10). */
  readonly reservedIds?: ReadonlyMap<string, readonly string[]> | undefined;
  /** Content this lane already held, committed, BEFORE this attempt's own session ever ran -- keyed by
   * repo-relative path, `'HEAD'` as of that moment (`runLaneLifecycle`, captured before `runWork`).
   * `undefined`/absent for a fresh lane (nothing could possibly be pre-existing: `runLaneLifecycle` does
   * not even compute it then). A crash-resume reroll (`PLAN-M14.md` P8's own "the step's own existing
   * lane") can leave a REAL, valid KB output from an earlier, interrupted attempt of the SAME step already
   * committed to this exact lane; the current reservation, computed by scanning that same lane, correctly
   * reserves ABOVE it (`output-ids.ts`) rather than reusing it, so it is absent at `baseSha` and would
   * otherwise misread as a wrong, unreserved id. It is this attempt's own history, not a new claim to
   * validate: exempt from the id-range rule below on exactly the same footing as an id present at
   * `baseSha` (`PLAN-M14.md` P10). A genuinely wrong id a sibling lane already holds is NOT exempted by
   * this -- a sibling's content never reaches this map, only this lane's own pre-attempt commits do. */
  readonly priorAttemptContent?: ReadonlyMap<string, string> | undefined;
}

interface Problem {
  readonly kind: 'missing' | 'invalid' | 'subtype';
  readonly text: string;
}

interface ValidFile {
  readonly path: string;
  /** The text a subtype is searched in: the whole file, or for a register only the entries produced. */
  readonly producedText: string;
  readonly sessionType: unknown;
}

const MAX_LISTED_FILES = 5;
/** Bounds on the failure message, which is also written to the event log: a step that produced hundreds of
 * invalid files must not produce a megabyte-long failure. */
const MAX_PROBLEMS = 5;
const MAX_PROBLEM_CHARS = 700;

/** Agent-controlled text (file names, entry ids, YAML error excerpts) reaches the terminal and the event
 * log through the message: control characters (escape sequences, newlines) are replaced. */
// eslint-disable-next-line no-control-regex -- the point is to match control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

function clip(text: string): string {
  const clean = text.replace(CONTROL_CHARS, ' ');
  return clean.length > MAX_PROBLEM_CHARS
    ? `${clean.slice(0, MAX_PROBLEM_CHARS)}... (truncated)`
    : clean;
}

function describeOutput(output: StepNode['outputs'][number]): string {
  const parts = [
    output.subtype === undefined ? undefined : `subtype ${output.subtype}`,
    output.cardinality === 'many' ? 'many' : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? output.type : `${output.type} (${parts.join(', ')})`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** Key-order-independent serialisation, so re-ordering an entry's keys is not a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`)
      .join(',')}}`;
  }
  // Front matter parsed from YAML holds only JSON-representable scalars here.
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The register entries a front matter holds: the array under `key`, or (no wrapper schema) every array of
 * mappings at the top level plus the front matter itself when it is one entry. `changelog` is metadata. */
function registerEntries(frontMatter: Record<string, unknown>, key: string | undefined): unknown[] {
  if (key !== undefined) {
    const list = frontMatter[key];
    return Array.isArray(list) ? list : [];
  }
  // A front matter that is itself one entry (the `HandoffRecord` template's "copy this block" form): its
  // own array fields (`assumptions`, ...) are entry data, not further entries.
  if (typeof frontMatter['id'] === 'string') return [frontMatter];
  const entries: unknown[] = [];
  for (const [name, value] of Object.entries(frontMatter)) {
    if (name === 'changelog' || !Array.isArray(value)) continue;
    entries.push(...value.filter(isRecord));
  }
  return entries;
}

const SUBTYPE_ITEM = /^\s*subtype\s*[:=]\s*(.+)$/i;

/** Where a register entry records its subtype: its `step` value, or a `delivered` item written
 * `subtype: <name>` (the two conventions the shipped briefs use, since a HandoffRecord entry has no `subtype`
 * key). Nothing else in an entry (`from`, constraint prose, other `delivered` prose) can satisfy a subtype. */
function subtypeText(entries: readonly unknown[]): string {
  return entries
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const delivered: unknown[] = Array.isArray(entry['delivered']) ? entry['delivered'] : [];
      const marked = delivered.flatMap((item) =>
        typeof item === 'string' ? [SUBTYPE_ITEM.exec(item)?.[1]] : [],
      );
      return [entry['step'], ...marked].filter((part) => typeof part === 'string');
    })
    .join('\n');
}

function entryId(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry['id'] === 'string' ? entry['id'] : undefined;
}

/** `ArtifactDocument.parse` has already established the front matter is a YAML mapping (`CFG-007`
 * otherwise), which is what makes this cast sound. */
function frontMatterOf(doc: ArtifactDocument): Record<string, unknown> {
  return doc.frontMatter as Record<string, unknown>;
}

/** The problems, if any, with one produced single-document artifact: parses, its `type` is the expected
 * one, and `validateArtifact` (front matter schema plus required sections) accepts it. Exported so the
 * engine-written swarm-review `ReviewReport` (`PLAN-M13.md` P17) is validated by the very code the output
 * check judges it with afterwards, not a second copy that could disagree. */
export function documentProblems(
  definition: ArtifactTypeDefinition,
  path: string,
  text: string,
): { readonly problems: readonly string[]; readonly sessionType?: unknown } {
  let doc: ArtifactDocument;
  try {
    doc = ArtifactDocument.parse(text, path);
  } catch (cause) {
    return { problems: [errorText(cause)] };
  }
  const frontMatter = frontMatterOf(doc);
  if (frontMatter['type'] !== definition.id) {
    return {
      problems: [
        `its front matter type is ${JSON.stringify(frontMatter['type'])}, not "${definition.id}"`,
      ],
    };
  }
  const outcome = validateArtifact(doc);
  return outcome.valid
    ? { problems: [], sessionType: frontMatter['sessionType'] }
    : { problems: outcome.errors.map((error) => error.message) };
}

function interfaceContractProblems(path: string, text: string): readonly string[] {
  if (text.startsWith(BOM) ? text.slice(BOM.length).startsWith('---') : text.startsWith('---')) {
    // Front matter form, unless the `---` is only YAML's document-start marker of a plain contract file
    // (no closing `---` line): that is parsed as plain YAML below.
    try {
      ArtifactDocument.parse(text, path);
      return documentProblems(definitionForType('InterfaceContract'), path, text).problems;
    } catch (cause) {
      if (!(cause instanceof ForgeError) || cause.code !== 'CFG-006') {
        return [errorText(cause)];
      }
    }
  }
  let data: Record<string, unknown>;
  try {
    data = parseFrontMatterYaml(text, path);
  } catch (cause) {
    return [errorText(cause)];
  }
  // A contract file is the machine-readable contract (OpenAPI, JSON Schema, ...) with the artifact's front
  // matter keys at its top level (`freeze-contracts` brief): only those keys are the artifact's own.
  const own = Object.fromEntries(Object.entries(data).filter(([key]) => BASE_KEYS.includes(key)));
  const result = interfaceContractSchema.safeParse(own);
  return result.success ? [] : [issueText(result.error)];
}

/** `18` §18.7's own KB registry root -- every type P8's `output-ids.ts` reserves an id for (`ADR`,
 * `Runbook`, `Risk`, `Assumption`, `OpenQuestion`, `Environment`), and the same six this piece
 * (`PLAN-M14.md` P11) binds to `08` §8.6's `sources`/never-removed invariants below. Moved above
 * `validateFile` (it used to live only beside `kbRangeProblems`, further down) now that both need it. */
const KB_PATH_TEMPLATE_PREFIX = 'kb/';

/** `08` §8.6's "Every write records `sources`. A write with no source is rejected" for a per-file KB
 * document (`ADR`, `Runbook`) -- the register branch below enforces the identical rule per produced
 * entry; this is its single-document counterpart. Called only after `documentProblems` has already
 * confirmed `text` parses and validates against the schema, so this second, cheap parse cannot itself
 * fail. Returns the bare problem text (`checkOne` already prefixes it with the file's own path). */
function kbDocumentSourceProblem(path: string, text: string): string | undefined {
  const frontMatter = frontMatterOf(ArtifactDocument.parse(text, path));
  const sources = frontMatter['sources'];
  if (Array.isArray(sources) && sources.length > 0) return undefined;
  return (
    'no sources: 08 §8.6 requires at least one (kind: decision, human or code, with a ref) on ' +
    'every produced KB document'
  );
}

/** Validates one produced file of `definition`'s type; `base` is its content at the base revision. */
async function validateFile(
  definition: ArtifactTypeDefinition,
  path: string,
  text: string,
  readBase: () => Promise<string | undefined>,
  readSidecar: () => Promise<string | undefined>,
): Promise<{ readonly problems: readonly string[]; readonly valid?: ValidFile }> {
  const type = definition.id;
  const register = REGISTER_SCHEMAS[type];
  const entrySchema = ENTRY_ONLY_SCHEMAS[type];

  if (register !== undefined || entrySchema !== undefined) {
    let frontMatter: Record<string, unknown>;
    try {
      frontMatter = frontMatterOf(ArtifactDocument.parse(text, path));
    } catch (cause) {
      return { problems: [errorText(cause)] };
    }
    if (register !== undefined) {
      const parsed = register.schema.safeParse(frontMatter);
      if (!parsed.success) return { problems: [issueText(parsed.error)] };
    } else if (entrySchema !== undefined) {
      if ('type' in frontMatter && frontMatter['type'] !== type) {
        return {
          problems: [
            `its front matter type is ${JSON.stringify(frontMatter['type'])}, not "${type}"`,
          ],
        };
      }
      const found = registerEntries(frontMatter, undefined);
      if (found.length === 0) {
        return {
          problems: [`it holds no ${type} entry (a mapping with an "id") in its front matter`],
        };
      }
      const bad = found.flatMap((entry, index) => {
        const parsed = entrySchema.safeParse(entry);
        return parsed.success
          ? []
          : [`entry ${entryId(entry) ?? `#${String(index + 1)}`}: ${issueText(parsed.error)}`];
      });
      if (bad.length > 0) return { problems: bad };
    }
    const entries = registerEntries(frontMatter, register?.key);
    const baseText = await readBase();
    const before = new Map<string, string>();
    if (baseText !== undefined) {
      try {
        const baseFrontMatter = frontMatterOf(ArtifactDocument.parse(baseText, path));
        for (const entry of registerEntries(baseFrontMatter, register?.key)) {
          const id = entryId(entry);
          if (id !== undefined) before.set(id, canonical(entry));
        }
      } catch {
        // An unparseable base version contributes no entries, so every entry now present counts as produced.
      }
    }
    // `PLAN-M14.md` P11, `08` §8.6's KbWriter invariant "never reused (deleted entries become
    // deprecated, files retained)": for the four register types, gated on the identical
    // `pathTemplate.startsWith('kb/')` predicate the per-file branch below (and block [5]'s own
    // `isKbLocatedOutput`, `compile-prompt.ts`) use -- not merely `register !== undefined` alone, so
    // this rule's own scope is tied to the SAME test everywhere it is stated or enforced, rather than
    // coinciding with `REGISTER_SCHEMAS`'s four keys only by the accident of what that map happens to
    // hold today. `HandoffRecord`/`Waiver` are neither KB-located nor register-schema'd, so this never
    // reaches them either way. An id the base revision already held must still be present at HEAD --
    // checked against the CURRENT entries' own ids, not the diff, so an entry the session left
    // untouched still counts as present. The schema cannot express this (it validates one entry's
    // shape, never the file's whole id set), so the check does.
    if (
      register !== undefined &&
      definition.pathTemplate.startsWith(KB_PATH_TEMPLATE_PREFIX) &&
      before.size > 0
    ) {
      const currentIds = new Set(
        entries.flatMap((entry) => {
          const id = entryId(entry);
          return id === undefined ? [] : [id];
        }),
      );
      const removed = [...before.keys()].filter((id) => !currentIds.has(id)).sort();
      if (removed.length > 0) {
        return {
          problems: removed.map(
            (id) =>
              `entry ${id} was present at the base revision and is missing at HEAD: 08 §8.6 says an ` +
              'id is never reused or removed once assigned -- mark it deprecated/superseded (or ' +
              'resolved) instead of deleting it',
          ),
        };
      }
    }
    const produced = entries.filter(
      (entry) => before.get(entryId(entry) ?? '') !== canonical(entry),
    );
    if (produced.length === 0) {
      return {
        problems: [
          `the session changed the file but added or modified no ${type} entry (entries identical to the base version do not count)`,
        ],
      };
    }
    // `PLAN-M14.md` P11, `08` §8.6's KbWriter invariant "Every write records sources. A write with no
    // source is rejected": every entry this session added or changed (`produced`, not the whole file)
    // must carry at least one `sources` item; an untouched sibling entry with none is not this
    // session's problem to fix, and the schema leaves `sources` optional (P11's own Mandate), so only
    // the check enforces this. Gated on the same `kb/`-rooted predicate as the retained-entry check
    // just above, for the identical reason.
    if (register !== undefined && definition.pathTemplate.startsWith(KB_PATH_TEMPLATE_PREFIX)) {
      const missingSources = produced.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const sources = entry['sources'];
        if (Array.isArray(sources) && sources.length > 0) return [];
        return [
          `entry ${entryId(entry) ?? '(unknown id)'} has no sources: 08 §8.6 requires at least one ` +
            '(kind: decision, human or code, with a ref) on every produced or changed entry',
        ];
      });
      if (missingSources.length > 0) return { problems: missingSources };
    }
    return {
      problems: [],
      valid: { path, producedText: subtypeText(produced), sessionType: undefined },
    };
  }

  if (type === 'InterfaceContract') {
    const problems = interfaceContractProblems(path, text);
    return problems.length > 0
      ? { problems }
      : { problems: [], valid: { path, producedText: text, sessionType: undefined } };
  }

  if (type === 'Diagram') {
    if (text.trim() === '') return { problems: ['the diagram source is empty'] };
    const sidecar = await readSidecar();
    if (sidecar === undefined) {
      return {
        problems: [
          `it has no sidecar ${path}.yaml (added or changed by the session) describing the diagram (08 §8.11)`,
        ],
      };
    }
    try {
      const result = diagramSchema.safeParse(parseFrontMatterYaml(sidecar, `${path}.yaml`));
      if (!result.success)
        return { problems: [`sidecar ${path}.yaml: ${issueText(result.error)}`] };
    } catch (cause) {
      return { problems: [`sidecar ${path}.yaml: ${errorText(cause)}`] };
    }
    return { problems: [], valid: { path, producedText: text, sessionType: undefined } };
  }

  const checked = documentProblems(definition, path, text);
  if (checked.problems.length > 0) return { problems: checked.problems };
  // `PLAN-M14.md` P11: the two per-file KB document types (`ADR`, `Runbook` -- every other type
  // `documentProblems` validates lives outside `kb/`) are held to `08` §8.6's sources invariant too,
  // the identical rule the register branch above enforces per entry.
  if (definition.pathTemplate.startsWith(KB_PATH_TEMPLATE_PREFIX)) {
    const sourceProblem = kbDocumentSourceProblem(path, text);
    if (sourceProblem !== undefined) return { problems: [sourceProblem] };
  }
  return { problems: [], valid: { path, producedText: text, sessionType: checked.sessionType } };
}

/** The artifact's own field value for a DSL subtype (`retrospective` -> `retro`); own keys only. */
function canonicalSubtype(type: ArtifactTypeId, subtype: string): string {
  const aliases = SUBTYPE_ALIASES[type];
  return aliases !== undefined && Object.hasOwn(aliases, subtype)
    ? (aliases[subtype] ?? subtype)
    : subtype;
}

/** Trims leading and trailing dashes in linear time (a `replace(/^-+|-+$/g, '')` backtracks quadratically
 * on a long run of dashes in the middle of agent-controlled text). */
function trimDashes(segment: string): string {
  let start = 0;
  let end = segment.length;
  while (start < end && segment.charAt(start) === '-') start += 1;
  while (end > start && segment.charAt(end - 1) === '-') end -= 1;
  return segment.slice(start, end);
}

/** Whether `text` names `subtype` as a hyphenated word: some segment (split on whitespace, arrows and
 * punctuation) is the subtype, or ends in `-<subtype>` (a step named `write-test-plan` for subtype
 * `test-plan`). A longer hyphenated word that merely contains it (`not-a-test-plan-at-all`) is a different
 * segment and does not count; free prose that spells the word on its own still would, which is why a
 * register entry is only searched in its `step` and its `subtype:` items (`subtypeText`). */
function carriesSubtype(text: string, subtype: string): boolean {
  const wanted = subtype.toLowerCase();
  return text
    .toLowerCase()
    .split(/[\s\u2192>,;:()[\]{}"']+/)
    .map(trimDashes)
    .some((segment) => segment === wanted || segment.endsWith(`-${wanted}`));
}

function subtypeSatisfied(
  type: ArtifactTypeId,
  subtype: string,
  files: readonly ValidFile[],
): boolean {
  if (type === 'SessionRecord') {
    const wanted = canonicalSubtype(type, subtype);
    return files.some((file) => file.sessionType === wanted);
  }
  return files.some((file) => carriesSubtype(file.producedText, subtype));
}

function listFiles(files: readonly string[]): string {
  const shown = files.slice(0, MAX_LISTED_FILES).join(', ');
  return files.length > MAX_LISTED_FILES
    ? `${shown}, and ${String(files.length - MAX_LISTED_FILES)} more`
    : shown;
}

/** Every entry id `text` holds, parsed as `definition`'s own register front matter -- `[]` for text that
 * does not parse or is `undefined` (an absent base/prior version contributes no ids: every entry now
 * present counts as new against it, the same stance `validateFile`'s own register branch already takes
 * for an unparseable base). */
function registerEntryIds(
  register: { readonly key: string } | undefined,
  text: string | undefined,
  path: string,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (text === undefined) return ids;
  try {
    const frontMatter = frontMatterOf(ArtifactDocument.parse(text, path));
    for (const entry of registerEntries(frontMatter, register?.key)) {
      const id = entryId(entry);
      if (id !== undefined) ids.add(id);
    }
  } catch {
    // unparseable: contributes no ids.
  }
  return ids;
}

/** The `id` a per-file document's own front matter declares -- `undefined` for text that does not parse,
 * is `undefined`, or has no string `id` (an absent base/prior version, or one this piece cannot read,
 * simply has no id to compare against, the same "contributes nothing" stance `registerEntryIds` takes). */
function documentId(text: string | undefined, path: string): string | undefined {
  if (text === undefined) return undefined;
  try {
    const id = frontMatterOf(ArtifactDocument.parse(text, path))['id'];
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Every id `present`'s files or register entries introduce that is NOT already at `baseSha` AND NOT
 * already in `input.priorAttemptContent` -- what the KB range rule judges (an id already present at base,
 * or already committed to this lane before this attempt's own session ran, is an update/this attempt's
 * own history, not a new claim: exempt, `SPEC-QUESTIONS.md` Q232 decision 2, `PLAN-M14.md` P10). A
 * `collection: true` register type (`Risk`, `Assumption`, `OpenQuestion`, `Environment`) counts an ENTRY as
 * new when its id was not among the register file's own entries at either, reusing this module's own
 * `registerEntries`/`entryId` (the same private shape `output-ids.ts`'s own `registerIdScan` duplicates in
 * miniature rather than importing, for the identical reason run the other way here). A per-file type
 * (`ADR`, `Runbook`) counts a produced file as new when ITS OWN `id` FIELD (not merely its path) does not
 * match the `id` field either version already held at that same path -- keyed on the artifact's own
 * declared identity, not on path presence: a fresh critic round found the earlier version of this function
 * compared PATHS ("does a file already exist at this path"), which let a session silently swap an EXISTING
 * artifact's own id for an unreserved one (rewrite `ADR-0007-seed.md`, still at that same path, so it read
 * as "an update," but with its front matter changed to declare `id: ADR-0009`) -- never checked against the
 * reservation at all. The current file's own `id` is trusted directly (not re-derived from the file name):
 * by the time this runs, `validateFile` has already accepted it, and `checkIdMatchesRegisteredType` (`@forge/
 * schemas`) already ties a valid `id` to `definition`'s own `idPrefix`/`idWidth`, so there is no daylight
 * left for the file name and the front matter to disagree that this function would need to police itself. */
async function newKbIds(
  definition: ArtifactTypeDefinition,
  present: readonly { readonly path: string; readonly text: string }[],
  input: OutputCheckInput,
): Promise<readonly string[]> {
  const { lane, baseSha, vcs } = input;
  if (definition.collection === true) {
    const register = REGISTER_SCHEMAS[definition.id];
    const ids: string[] = [];
    for (const file of present) {
      let frontMatter: Record<string, unknown>;
      try {
        frontMatter = frontMatterOf(ArtifactDocument.parse(file.text, file.path));
      } catch {
        continue; // already reported invalid above; contributes no ids here.
      }
      const baseText = await vcs.readAtRevision(lane, baseSha, file.path);
      const baseIds = new Set([
        ...registerEntryIds(register, baseText, file.path),
        ...registerEntryIds(register, input.priorAttemptContent?.get(file.path), file.path),
      ]);
      for (const entry of registerEntries(frontMatter, register?.key)) {
        const id = entryId(entry);
        if (id !== undefined && !baseIds.has(id)) ids.push(id);
      }
    }
    return ids;
  }
  const ids: string[] = [];
  for (const file of present) {
    const currentId = documentId(file.text, file.path);
    if (currentId === undefined) continue; // already reported invalid above; contributes no id here.
    const baseText = await vcs.readAtRevision(lane, baseSha, file.path);
    const baseId = documentId(baseText, file.path);
    const priorId = documentId(input.priorAttemptContent?.get(file.path), file.path);
    if (currentId === baseId || currentId === priorId) continue; // an update, or prior history.
    ids.push(currentId);
  }
  return ids;
}

/**
 * For a KB-located type with a reservation this step's own call held (`input.reservedIds`): every id
 * `newKbIds` finds must be exactly the reservation's own ids, used contiguously starting from its base --
 * not merely "some id in the reserved set" (a `many` block used out of order, or with a gap, is still
 * wrong: `08` §18.8's "use them in order... never skipping" promise the prompt itself makes, `PLAN-M14.md`
 * P8), and never repeated (two DIFFERENT produced files or register entries sharing one id is exactly as
 * wrong as a gap -- a fresh critic round found an earlier version of this function deduplicated `newIds`
 * via `new Set` before ever comparing it, so two files both declaring, say, `ADR-0007` silently passed as
 * though only one had been produced; checked FIRST, against the undeduplicated list, so it cannot be
 * masked by the range comparison that follows). No reservation for this type (a non-KB output, or this
 * call made none at all) means nothing to check: `[]`. No NEW ids (every produced file/entry is an update
 * to something already at base, or already committed to this lane by an earlier attempt of this step)
 * means nothing to check either -- the whole point of the base/prior-attempt exemption `newKbIds` itself
 * already applies.
 */
async function kbRangeProblems(
  output: StepNode['outputs'][number],
  definition: ArtifactTypeDefinition,
  label: string,
  present: readonly { readonly path: string; readonly text: string }[],
  input: OutputCheckInput,
): Promise<readonly Problem[]> {
  if (!definition.pathTemplate.startsWith(KB_PATH_TEMPLATE_PREFIX)) return [];
  const reserved = input.reservedIds?.get(output.type);
  if (reserved === undefined) return [];
  const newIds = await newKbIds(definition, present, input);
  if (newIds.length === 0) return [];

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const id of newIds) {
    if (seen.has(id)) duplicated.add(id);
    else seen.add(id);
  }
  if (duplicated.size > 0) {
    return [
      {
        kind: 'invalid',
        text:
          `${label}: the new id(s) ${listFiles([...duplicated].sort())} were each produced more than ` +
          `once by this session's own commit -- a reserved id names exactly one artifact, never two`,
      },
    ];
  }

  const used = [...newIds].sort();
  const expected = reserved.slice(0, used.length);
  const matches =
    used.length === expected.length && used.every((id, index) => id === expected[index]);
  if (matches) return [];
  return [
    {
      kind: 'invalid',
      text:
        `${label}: the new id(s) ${listFiles(used)} are not this step's own reserved id(s), used ` +
        `contiguously from their own base; reserved: ${listFiles(reserved)} (an id already the artifact's ` +
        `own id at the base revision, or already committed to this lane by an earlier attempt of this ` +
        `step, is an update, not a new one, and is exempt from this rule)`,
    },
  ];
}

async function checkOne(
  output: StepNode['outputs'][number],
  input: OutputCheckInput,
  files: {
    readonly committed: readonly string[];
    readonly uncommitted: readonly string[];
    readonly nonRegular?: readonly string[] | undefined;
  },
): Promise<readonly Problem[]> {
  const label = describeOutput(output);
  const definition = artifactTypeById(output.type);
  if (definition === undefined) {
    return [
      {
        kind: 'invalid',
        text: `${label}: "${output.type}" is not a registered artifact type (18 §18.7), so no file can satisfy it`,
      },
    ];
  }
  const glob = outputGlob(definition.id, input.docRoots);
  const matches = (file: string): boolean => minimatch(file, glob, MATCH_OPTIONS);
  const { lane, baseSha, vcs } = input;

  const present: { readonly path: string; readonly text: string }[] = [];
  const unreadable: string[] = [];
  for (const path of files.committed.filter(matches)) {
    const text = await vcs.readAtRevision(lane, 'HEAD', path);
    if (text !== undefined) present.push({ path, text });
    else unreadable.push(path);
  }

  if (present.length === 0) {
    const notes: string[] = [];
    if (unreadable.length > 0) {
      notes.push(
        `${listFiles(unreadable)} appear in the lane's diff but hold no regular file at its head (deleted, a symlink, or over the size limit)`,
      );
    }
    const stranded = files.uncommitted.filter(matches);
    if (stranded.length > 0) {
      notes.push(
        `${listFiles(stranded)} exist only in the lane worktree and were not committed to the lane branch, so they would never merge`,
      );
    }
    const reverted = input.claimReverted.filter(matches);
    if (reverted.length > 0) {
      notes.push(
        `the session wrote ${listFiles(reverted)} but claim enforcement reverted it: the step's claim (its \`produces\` globs plus its declared outputs' registry paths) does not cover that path, which a declared output's own path always should; check the project's configured docs roots`,
      );
    }
    notes.push(
      files.committed.length === 0
        ? 'the session committed no file'
        : `the files the session did commit are: ${listFiles(files.committed)}`,
    );
    return [
      {
        kind: 'missing',
        text: `${label}: no file matching ${glob} was added or changed by the session (${notes.join('; ')})`,
      },
    ];
  }

  // The declared output's registry path is inside the step's claim (`resolveStepClaim`), so claim enforcement
  // keeps a symlink or submodule entry planted beside a valid artifact. Only regular files may occupy the
  // path a merge would carry forward: one such entry fails the output, valid sibling or not.
  // A Diagram's `.mmd.yaml` sidecar is in the claim too (`outputClaimGlobs`), so it is held to the same rule.
  const inClaim = (file: string): boolean =>
    matches(file) ||
    (definition.id === 'Diagram' && minimatch(file, `${glob}.yaml`, MATCH_OPTIONS));
  const nonRegular = new Set((files.nonRegular ?? []).filter(inClaim));
  const problems: Problem[] = [...nonRegular].map((path) => ({
    kind: 'invalid' as const,
    text: `${label}: ${path} is a symlink or submodule at a path the declared output owns; only regular files may be committed there`,
  }));
  // The claim is the type's whole registry glob (a Diagram's sidecar included), so it also lets a step remove an
  // artifact of that type that existed at the base. Deleting one is not producing one: refused, file named.
  // Git's listing is bounded by `MAX_PROBLEMS` here so a mass deletion costs a handful of reads, not one per file.
  const presentPaths = new Set(present.map((file) => file.path));
  let removed = 0;
  for (const path of files.committed.filter(inClaim)) {
    if (presentPaths.has(path) || nonRegular.has(path) || removed >= MAX_PROBLEMS) continue;
    if ((await vcs.readAtRevision(lane, baseSha, path)) !== undefined) {
      removed += 1;
      problems.push({
        kind: 'invalid',
        text: `${label}: ${path} existed before the session and no longer holds a regular file at its head (deleted, or over the size limit); a step declaring ${output.type} may add or update artifacts of that type, not remove them`,
      });
    }
  }
  const valid: ValidFile[] = [];
  for (const file of present) {
    const result = await validateFile(
      definition,
      file.path,
      file.text,
      () => vcs.readAtRevision(lane, baseSha, file.path),
      () =>
        files.committed.includes(`${file.path}.yaml`)
          ? vcs.readAtRevision(lane, 'HEAD', `${file.path}.yaml`)
          : Promise.resolve(undefined),
    );
    if (result.valid !== undefined) valid.push(result.valid);
    else {
      problems.push({
        kind: 'invalid',
        text: `${label}: ${file.path} failed validation: ${result.problems.join('; ')}`,
      });
    }
  }
  if (problems.length > 0) return problems;

  problems.push(...(await kbRangeProblems(output, definition, label, present, input)));
  if (problems.length > 0) return problems;

  if (output.subtype !== undefined && !subtypeSatisfied(definition.id, output.subtype, valid)) {
    const how =
      definition.id === 'SessionRecord'
        ? `no produced file has sessionType "${canonicalSubtype('SessionRecord', output.subtype)}"`
        : `none of ${listFiles(valid.map((file) => file.path))} carries "${output.subtype}" (a register entry must carry it in its \`step\` or a \`delivered\` item; a document anywhere in its text)`;
    return [
      {
        kind: 'subtype',
        text: `${label}: no produced ${definition.id} identifies itself as subtype "${output.subtype}": ${how}`,
      },
    ];
  }
  return [];
}

/**
 * Checks every declared output of `input.node` against the lane; `undefined` means the contract holds (or
 * nothing is declared). Failure is a `StepFailureInfo` with `source: 'output'`, `RUN-083` (or `RUN-084`
 * when an output is missing and the agent's own grant forbids writing), whose message names the step,
 * every unmet output, the expected glob and the check that failed, followed by the remedy.
 */
export async function checkDeclaredOutputs(
  input: OutputCheckInput,
): Promise<StepFailureInfo | undefined> {
  if (input.node.outputs.length === 0) return undefined;
  const files = await input.vcs.changedFiles(input.lane, input.baseSha);
  const problems: Problem[] = [];
  for (const output of input.node.outputs) {
    problems.push(...(await checkOne(output, input, files)));
  }
  if (problems.length === 0) return undefined;

  const shown = problems.slice(0, MAX_PROBLEMS).map((problem) => clip(problem.text));
  const detail = [
    ...shown,
    ...(problems.length > MAX_PROBLEMS
      ? [`and ${String(problems.length - MAX_PROBLEMS)} more problem(s)`]
      : []),
  ].join('; ');
  const grantIsCause =
    input.writeForbidden && problems.some((problem) => problem.kind === 'missing');
  const error =
    grantIsCause && input.node.agent !== undefined
      ? new ForgeError('RUN-084', {
          stepId: input.node.id,
          agentId: String(input.node.agent),
          detail,
        })
      : new ForgeError('RUN-083', { stepId: input.node.id, detail });
  return {
    source: 'output',
    code: error.code,
    message: `${error.message} -- Remedy: ${error.remedy}`,
    cause: error,
  };
}

/** The docs roots claim derivation and the output check both resolve registry paths against: the
 * project's configured ones, else the default layout (never skipped: a mis-wired context fails loudly). */
export function docRootsOf(ctx: Pick<ExecuteStepContext, 'docRoots'>): DocRoots {
  return ctx.docRoots ?? DEFAULT_CONFIG.paths;
}

/** One entry `readRegisterEntries` found: its own `id` (an entry with none, which the register schemas
 * above do not allow but a hand-built fixture might, cannot be `show`n -- `runElicit` treats it as not
 * found) and its raw front-matter fields, the shape a `show` question renders into `AskRequest.context`
 * (`dispatch/elicit.ts`, `PLAN-M14.md` P41). */
export interface RegisterEntry {
  readonly id: string | undefined;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * Every entry of `type`'s register file (`18` §18.7, `collection: true`) found under `tree` -- a real
 * filesystem root, `ctx.integrationPath` for `runElicit`'s own call (`PLAN-M14.md` P41) -- located via
 * `outputPathFor`, not `outputGlob`: this resolves a real file to *read*, not a *pattern* to match
 * against a git diff listing, and `outputGlob`'s own root is glob-escaped for `minimatch` -- feeding that
 * escaped string straight to `resolveWithin`/`fs` would corrupt a literal path for any configured root
 * holding a glob-special character (`(`, `[`, `!`, ...), silently missing a real, produced file. Every
 * `collection: true` type's own path template is a single fixed file (`handoffs.md`, not
 * `{id}-{slug}.md`), so `outputPathFor`'s own unused `id` argument is always a safe no-op here. Narrowed
 * to entries that carry `subtype` as a hyphenated word when it is given (P7's own per-file rule,
 * `subtypeText`/`carriesSubtype`, reused here per ENTRY rather than across a whole produced set --
 * `subtypeSatisfied` above judges a whole file's subtype satisfaction with the identical match; this is
 * the same rule, asked of one entry at a time).
 *
 * `[]`, never a throw: `type` is not a register this module knows how to read entries from (neither
 * `REGISTER_SCHEMAS` nor `ENTRY_ONLY_SCHEMAS` has it, which also covers a type that is not
 * `collection: true` at all -- `validateStructure`'s own `elicit-show-not-a-register` already refuses
 * this at author time, so a real caller only ever reaches an empty result here for a genuine run-time
 * miss), `tree` cannot reach the configured root at all -- `CFG-003` (escapes the project tree
 * entirely: a relocated `paths.*` pointing outside it, `output-ids.ts`'s own `resolveWithinOrSkip`
 * treats an unreachable root the identical way) or `CFG-004` (lands under a denied prefix: `.git/`,
 * `.forge/state/`, `node_modules/` -- `pathsSchema` puts no restriction on `paths.kb`/`paths.reports`/
 * etc., unlike `paths.release`, so `paths.reports: .git` is real, schema-accepted input a round-2
 * critic found still threw uncaught here with only `CFG-003` caught) -- the register file does not
 * exist under `tree`, or it does not parse. A caller (`runElicit`) decides what an empty result means
 * (`RUN-105`, before `ElicitationRequested`); this function only ever describes what it found.
 */
export async function readRegisterEntries(
  tree: string,
  type: string,
  roots: DocRoots,
  subtype?: string,
): Promise<readonly RegisterEntry[]> {
  const definition = artifactTypeById(type);
  if (definition?.collection !== true) return [];
  const register = REGISTER_SCHEMAS[definition.id];
  const entrySchema = ENTRY_ONLY_SCHEMAS[definition.id];
  if (register === undefined && entrySchema === undefined) return [];

  const relative = outputPathFor(definition.id, roots, '');
  let absolute: AbsolutePath;
  try {
    absolute = new ProjectPaths(tree).resolveWithin(relative);
  } catch (cause) {
    if (isForgeError(cause) && (cause.code === 'CFG-003' || cause.code === 'CFG-004')) return [];
    throw cause;
  }
  if (!(await pathExists(absolute))) return [];

  let frontMatter: Record<string, unknown>;
  try {
    frontMatter = frontMatterOf(ArtifactDocument.parse(await readTextFile(absolute), relative));
  } catch {
    return [];
  }

  const entries = registerEntries(frontMatter, register?.key).filter(isRecord);
  const narrowed =
    subtype === undefined
      ? entries
      : entries.filter((entry) => carriesSubtype(subtypeText([entry]), subtype));
  return narrowed.map((entry) => ({ id: entryId(entry), fields: entry }));
}

/** Whether the step's agent is barred from writing files by its own definition (`tools.write: false`). That
 * is the grant the session ran with: `resolveStepToolGrant` never lets a `security.toolCeilingEscalations`
 * entry change `tools.write` (escalations only widen the ceiling an overlay may request), so none is
 * consulted. Unknown (the agent cannot be loaded) reads as not barred: the session already ran with it, so
 * a load failure here is not evidence about its grant. */
async function agentCannotWrite(node: StepNode, ctx: ExecuteStepContext): Promise<boolean> {
  if (node.agent === undefined) return false;
  try {
    const agent = await ctx.assembly.loadAgent(String(node.agent));
    return !agent.tools.write;
  } catch {
    return false;
  }
}

/**
 * `runLaneLifecycle`'s hook: the check for an `agent` step that declared outputs, against `lane` after
 * commit and claim enforcement. `claimReverted` is what enforcement reverted. Steps of every other kind
 * pass through (`command` steps produce files through shell commands, `session` steps through
 * `SessionRecord` assembly; neither is an agent session with a declared output contract).
 */
export async function verifyDeclaredOutputs(
  node: StepNode,
  ctx: ExecuteStepContext,
  lane: LaneHandle,
  baseSha: string,
  claimReverted: readonly string[],
  /** The step's own KB-output reservation, if this attempt made one (`reserveDeclaredKbOutputIds`'s own
   * `idsByType`, `PLAN-M14.md` P8/P10): threaded through unchanged from whichever call site held it before
   * assembly. `undefined` for a resumed session continuation (no fresh reservation that call), a `command`
   * step (never reaches `checkDeclaredOutputs` at all, the check above), or any caller with nothing to
   * pass -- the KB id-range rule then simply does not run for this call. */
  reservedIds?: ReadonlyMap<string, readonly string[]>,
  /** What this lane already held, committed, before this very attempt's own session ran
   * (`runLaneLifecycle`, captured before `runWork`) -- see `OutputCheckInput.priorAttemptContent`'s own
   * doc comment for why the id-range rule needs it. */
  priorAttemptContent?: ReadonlyMap<string, string>,
): Promise<StepFailureInfo | undefined> {
  if (node.kind !== 'agent' || node.outputs.length === 0) return undefined;
  return checkDeclaredOutputs({
    node,
    vcs: ctx.vcs,
    lane,
    baseSha,
    docRoots: docRootsOf(ctx),
    claimReverted,
    // A `swarm-review` step's report is written by the engine (`PLAN-M13.md` P17), never by the reviewer, so
    // the agent's `tools.write: false` is not why an output would be missing and `RUN-084`'s remedy ("give
    // the agent write access") would point at the wrong fix.
    writeForbidden:
      node.interactionMode === 'swarm-review' ? false : await agentCannotWrite(node, ctx),
    reservedIds,
    priorAttemptContent,
  });
}
