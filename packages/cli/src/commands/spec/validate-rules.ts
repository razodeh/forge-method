/**
 * `specValidateRule` — every `story:*`/`defect:*`/`rca:*` deterministic check
 * `packages/templates/templates/checks/{G-Ready,G-Stable}.gate.yaml` already ship, real and
 * CLI-invocable via `forge spec validate --rule <name> --json`.
 *
 * This function's own return value carries the full `violations` list — every real caller of the
 * library function (tests, another command) wants to know *what*, not just *how many*. The shipped
 * gate's own `failOn: 'errors > 0'` is a bare numeric comparison, though (`@forge/engine/expr`'s
 * `length` is a `length(...)` prefix function, not a `.length` postfix property — confirmed directly
 * against `packages/engine/src/expr/types.ts`'s own doc comment — so `errors > 0` needs `errors`
 * itself to already be a number in the JSON blob, not an array a postfix `.length` could read).
 * `bin.ts`'s own CLI-output layer is therefore where `violations.length` becomes the top-level
 * numeric `errors` field the gate actually reads — not this function, which stays a plain library
 * call with no JSON-serialisation concerns of its own.
 *
 * @see specs/09 §9.3 (Story quality rules 3/4/6)
 * @see specs/13 §13.2 step 9, §13.4 (G-Stable's open-defect/RCA conditions)
 * @see PLAN-M8.md P2
 */
import { ForgeError, isForgeError } from '@forge/core';
import type { ArtifactDocument } from '@forge/core/artifacts';
import { SpecGraph } from '@forge/core/graph';
import { globsOverlap } from '@forge/engine/plan';
import { parseKbTree, type KbParsedEntry, type KbTree } from '@forge/kb/schema';
import { evaluateDodProfile, readDodProfile, type DodParseResult } from '@forge/methods/dod';
import {
  defectSchema,
  rcaSchema,
  storySchema,
  type Defect,
  type RCA,
  type Story,
} from '@forge/schemas';

import { listSpecArtifacts } from '../shared.ts';
import { loadGraphDocs, type SpecCommandContext } from '../spec.ts';

/** The one real, runtime-checkable list a caller (`bin.ts`) validates an arbitrary `--rule` string
 * against — `ValidateRuleId` is derived from it, not a hand-kept parallel union, so the two can never
 * drift apart. */
export const VALIDATE_RULE_IDS = [
  'definition-of-ready',
  'file-claim-overlap',
  'unbound-acceptance-criteria',
  'oversized-stories',
  'open-sev1-sev2-defects',
  'unresolved-rca',
] as const;

/** One of the six `story:*`/`defect:*`/`rca:*` checks `G-Ready.gate.yaml`/`G-Stable.gate.yaml`
 * already name as a real `forge spec validate --rule <name>` invocation. */
export type ValidateRuleId = (typeof VALIDATE_RULE_IDS)[number];

/** One real problem `specValidateRule` found. `subject` is the id of the story/AC/defect the
 * violation is about (never a bare index or a generic label) — a caller renders it directly, the
 * same "name the real thing, not its position" shape `specValidate`'s own `SpecValidationResult`
 * already establishes for a whole document's errors. */
export interface RuleViolation {
  readonly subject: string;
  readonly message: string;
}

/** `specValidateRule`'s own return value. `violations` is the full list — every real caller (a test,
 * another command) wants to know *what*, not just *how many*; `bin.ts`'s own CLI-output layer is
 * where `violations.length` becomes the bare numeric `errors` field the shipped gate's own
 * `failOn: 'errors > 0'` actually reads (see this file's header comment for why that split exists). */
export interface RuleValidationResult {
  readonly rule: ValidateRuleId;
  readonly violations: readonly RuleViolation[];
}

const DEFAULT_REPORTS_ROOT = 'docs/forge/reports';
const DEFAULT_SESSIONS_ROOT = 'docs/forge/sessions';
/** `09` §9.8's own illustrative comment ("canonical: dod-profiles.yaml") names the file but not its
 * real location; the surrounding sentence puts the human-readable doc at
 * `docs/forge/kb/engineering/definition-of-done.md`, so the canonical machine file is read as its
 * direct sibling. Recorded in `SPEC-QUESTIONS.md` rather than guessed at silently. */
const DOD_PROFILES_RELATIVE_PATH = 'engineering/dod-profiles.yaml';

function ruleResult(
  rule: ValidateRuleId,
  violations: readonly RuleViolation[],
): RuleValidationResult {
  return { rule, violations };
}

/** `09` §9.3's own status enum lists `draft` first and every later state after it; `story.ts`'s own
 * schema comment already treats `draft` as "the only status before [G-Ready]" for the identical
 * size-L invariant this rule enforces independently — reused here as the one real definition of
 * "ready or later" every story-quality rule in this file shares. */
function isReadyOrLater(story: Story): boolean {
  return story.status !== 'draft';
}

function storiesFromDocs(docs: readonly ArtifactDocument[]): readonly Story[] {
  const stories: Story[] = [];
  for (const doc of docs) {
    const result = storySchema.safeParse(doc.frontMatter);
    // A document that fails `storySchema` here is either not a Story at all, or already reported
    // invalid by `specValidate`'s own generic pass — not this rule's job to re-report.
    if (result.success) stories.push(result.data);
  }
  return stories;
}

async function loadStoryDocs(ctx: SpecCommandContext): Promise<readonly ArtifactDocument[]> {
  return listSpecArtifacts(ctx.paths, ctx.specsRoot);
}

async function loadStories(ctx: SpecCommandContext): Promise<readonly Story[]> {
  return storiesFromDocs(await loadStoryDocs(ctx));
}

async function loadDefects(ctx: SpecCommandContext): Promise<readonly Defect[]> {
  const reportsRoot = ctx.reportsRoot ?? DEFAULT_REPORTS_ROOT;
  const docs = await listSpecArtifacts(ctx.paths, reportsRoot);
  const defects: Defect[] = [];
  for (const doc of docs) {
    const result = defectSchema.safeParse(doc.frontMatter);
    if (result.success) defects.push(result.data);
  }
  return defects;
}

async function loadRcas(ctx: SpecCommandContext): Promise<readonly RCA[]> {
  const sessionsRoot = ctx.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
  const docs = await listSpecArtifacts(ctx.paths, sessionsRoot);
  const rcas: RCA[] = [];
  for (const doc of docs) {
    const result = rcaSchema.safeParse(doc.frontMatter);
    if (result.success) rcas.push(result.data);
  }
  return rcas;
}

async function buildProjectGraph(ctx: SpecCommandContext): Promise<SpecGraph> {
  return SpecGraph.build(await loadGraphDocs(ctx));
}

// --- oversized-stories --------------------------------------------------------------------------

interface RawStorySizeStatus {
  readonly id: string;
  readonly size: unknown;
  readonly status: unknown;
}

/** Reads `size`/`status` straight off raw front matter, deliberately bypassing `storySchema` — a
 * size-L story at any non-`draft` status is *already* a schema violation (`story.ts`'s own
 * `superRefine`), so a document that actually has this problem can never successfully parse through
 * `storySchema.safeParse`. Relying on that parse here (the way every other rule in this file safely
 * does) would make this specific rule permanently, silently report zero violations regardless of
 * real project state — a document with a bad `size`/`status` combination is exactly the one this
 * rule exists to catch, schema-invalid or not. */
function rawStorySizeStatus(doc: ArtifactDocument): RawStorySizeStatus | undefined {
  // Cast, not a runtime check: `ArtifactDocument.parse` already eagerly validated the front matter
  // parses as a real YAML mapping at construction time (`document.ts`'s own doc comment) — every
  // later `frontMatter` read can assume an object, never an array/scalar/`null`; the `typeof`/
  // literal checks below are about which *fields* it has, not whether it is an object at all.
  const frontMatter = doc.frontMatter as Readonly<Record<string, unknown>>;
  if (frontMatter['type'] !== 'Story' || typeof frontMatter['id'] !== 'string') return undefined;
  return { id: frontMatter['id'], size: frontMatter['size'], status: frontMatter['status'] };
}

async function validateOversizedStories(ctx: SpecCommandContext): Promise<RuleValidationResult> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const errors: RuleViolation[] = [];
  for (const doc of docs) {
    const fields = rawStorySizeStatus(doc);
    if (fields === undefined) continue;
    if (fields.size === 'L' && fields.status !== 'draft') {
      errors.push({
        subject: fields.id,
        message: `story ${fields.id} is size L at status ${JSON.stringify(fields.status)} — it must be split before reaching "ready" or later.`,
      });
    }
  }
  return ruleResult('oversized-stories', errors);
}

// --- file-claim-overlap --------------------------------------------------------------------------

function validateFileClaimOverlap(stories: readonly Story[]): RuleValidationResult {
  const ready = stories.filter(isReadyOrLater);
  const errors: RuleViolation[] = [];
  ready.forEach((storyA, index) => {
    for (const storyB of ready.slice(index + 1)) {
      for (const globA of storyA.files_expected) {
        for (const globB of storyB.files_expected) {
          if (globsOverlap(globA, globB)) {
            errors.push({
              subject: `${storyA.id}, ${storyB.id}`,
              message: `${storyA.id}'s files_expected claim "${globA}" overlaps ${storyB.id}'s claim "${globB}".`,
            });
          }
        }
      }
    }
  });
  return ruleResult('file-claim-overlap', errors);
}

// --- unbound-acceptance-criteria ------------------------------------------------------------------

function validateUnboundAcceptanceCriteria(
  stories: readonly Story[],
  graph: SpecGraph,
): RuleValidationResult {
  const errors: RuleViolation[] = [];
  for (const story of stories.filter(isReadyOrLater)) {
    for (const criterion of story.acceptance) {
      if (graph.childrenOf(criterion.id).length === 0) {
        errors.push({
          subject: criterion.id,
          message: `${criterion.id} (story ${story.id}) has no bound test — allocate a test id before implementation starts.`,
        });
      }
    }
  }
  return ruleResult('unbound-acceptance-criteria', errors);
}

// --- open-sev1-sev2-defects / unresolved-rca -------------------------------------------------------

const SEVERE_SEVERITIES: ReadonlySet<string> = new Set(['Sev1', 'Sev2']);
/** `defectSchema` inherits only the generic `status: z.string().min(1)` from `baseFrontMatterShape`
 * — no enum exists anywhere for `Defect.status` (unlike `OpenQuestion`'s own closed `'open' |
 * 'resolved'`), and the *only* value any real writer in this codebase ever produces is the shipped
 * `Defect.md` template's own default. A fresh critic round confirmed empirically that keying "closed"
 * off the literal string `'closed'` (this file's own first draft) makes `unresolved-rca` permanently
 * vacuous — nothing anywhere ever writes that exact value, so a defect "closed" by any other real
 * spelling would silently skip its own RCA check forever. Anchoring on the one real, confirmed value
 * instead — "open" means literally `'open'`; anything else is treated as closed — means both checks
 * stay correct regardless of whatever spelling a future closing mechanism actually uses (`SPEC-
 * QUESTIONS.md` records this as a real, disclosed interpretation, not a silent guess). */
const OPEN_DEFECT_STATUS = 'open';

function validateOpenSevereDefects(defects: readonly Defect[]): RuleValidationResult {
  const errors = defects
    .filter(
      (defect) => SEVERE_SEVERITIES.has(defect.severity) && defect.status === OPEN_DEFECT_STATUS,
    )
    .map((defect) => ({
      subject: defect.id,
      message: `${defect.id} is open at severity ${defect.severity}.`,
    }));
  return ruleResult('open-sev1-sev2-defects', errors);
}

function validateUnresolvedRca(
  defects: readonly Defect[],
  rcas: readonly RCA[],
): RuleValidationResult {
  const closedSevere = defects.filter(
    (defect) => SEVERE_SEVERITIES.has(defect.severity) && defect.status !== OPEN_DEFECT_STATUS,
  );
  const errors: RuleViolation[] = [];
  for (const defect of closedSevere) {
    // `.some`, not `.find` followed by a single prevention check: a defect can have more than one
    // real RCA on file (a re-diagnosis superseding an earlier, incomplete one) — a fresh critic round
    // reproduced the false positive directly (one empty-prevention RCA sorting first, one real one
    // second) that `.find`'s first-match-only semantics produced.
    const hasResolvedRca = rcas.some(
      (candidate) => candidate.defect === defect.id && candidate.prevention.length > 0,
    );
    if (!hasResolvedRca) {
      errors.push({
        subject: defect.id,
        message: `closed ${defect.severity} defect ${defect.id} has no RCA with a real prevention action.`,
      });
    }
  }
  return ruleResult('unresolved-rca', errors);
}

// --- definition-of-ready --------------------------------------------------------------------------

/** Every id `story.context_refs` could ever legitimately name, from every source `09` §9.2/§9.3's
 * own worked examples mix (`KB-ARCH-0007`, `ADR-0011`, `NFR-0002`, and — per `09` §9.2's full
 * artifact-id table — `DM-###`/`SESSION-###` too): every `SpecGraph` node (Story/Epic/Capability/
 * Vision/AC/TEST/ADR/NFR/InterfaceContract) plus every real document under `specsRoot`/`sessionsRoot`
 * read directly by its own front-matter `id` (a fresh critic round confirmed `DataModel` gets no
 * `SpecGraph` node at all — `build.ts`'s own `NODE_KIND_BY_ARTIFACT_TYPE` has no entry for it, so
 * relying on the graph alone silently rejected every real `DM-###` reference; `SessionRecord` has
 * the identical gap for `sessionsRoot`) plus every KB-tree entry with its own id — `kb-entry`/`adr`/
 * `diagram`/`runbook` each carry one directly; four of the five "register" file kinds are containers,
 * so each one's own nested entries are flattened in too.
 *
 * **Disclosed, not fixed here:** `WAIVER-###` ids inside `reports/waivers.md` are still not resolved
 * — that file's own real on-disk collection shape (`Waiver`'s own registered type is one entry's
 * schema, `{id, reason, owner, expiry}`, not a wrapper) is not established anywhere else in this
 * codebase this piece could confirm against, and guessing at an unverified shape would be worse than
 * a story with a real `WAIVER-###` reference getting a real, honest violation today. */
function collectKnownIds(
  graph: SpecGraph,
  tree: KbTree,
  specDocs: readonly ArtifactDocument[],
  sessionDocs: readonly ArtifactDocument[],
): ReadonlySet<string> {
  const ids = new Set<string>(graph.nodes().map((node) => node.id));
  for (const doc of [...specDocs, ...sessionDocs]) {
    // Cast, not a runtime check: `rawStorySizeStatus`'s own doc comment has the fuller reasoning for
    // why `ArtifactDocument.parse` already guarantees a real object here.
    const id = (doc.frontMatter as Readonly<Record<string, unknown>>)['id'];
    if (typeof id === 'string') ids.add(id);
  }
  for (const entry of tree.entries) collectEntryIds(entry, ids);
  return ids;
}

function collectEntryIds(entry: KbParsedEntry, ids: Set<string>): void {
  switch (entry.kind) {
    case 'adr':
    case 'diagram':
    case 'runbook':
    case 'kb-entry':
      ids.add(entry.value.id);
      return;
    case 'risks-file':
      for (const risk of entry.value.risks) ids.add(risk.id);
      return;
    case 'assumptions-file':
      for (const assumption of entry.value.assumptions) ids.add(assumption.id);
      return;
    case 'open-questions-file':
      for (const question of entry.value.open_questions) ids.add(question.id);
      return;
    case 'environments-file':
      for (const environment of entry.value.environments) ids.add(environment.id);
      return;
    case 'components-file':
      for (const component of entry.value.components) ids.add(component.id);
      return;
    default: {
      // Exhaustiveness guard: a `KbParsedEntry` kind added elsewhere without a matching case here
      // would otherwise silently contribute zero ids, with no compiler warning (this function's own
      // `void` return type would let a non-exhaustive switch compile clean without it).
      const unreachable: never = entry;
      throw new ForgeError('USR-003', {
        feature: `spec validate (unrecognised KB entry kind ${JSON.stringify(unreachable)})`,
      });
    }
  }
}

/** `spec:no-blocking-open-questions`, as this codebase's own `OpenQuestion` schema can actually
 * answer: `08` §8.2/`SPEC-QUESTIONS.md` Q23 gives every open question only `status: 'open' |
 * 'resolved'`, no per-story `blocks`/`affects` link at all — there is no way to scope "blocks *this*
 * story" more narrowly than "some real open question exists, project-wide" with the schema as it
 * stands. Every story's own `resolveCheck` therefore answers this one check identically; recorded as
 * a real, disclosed scope limit, not silently narrowed. */
function anyOpenBlockingQuestion(tree: KbTree): boolean {
  return tree.entries.some(
    (entry) =>
      entry.kind === 'open-questions-file' &&
      entry.value.open_questions.some((question) => question.status === 'open'),
  );
}

function contextRefsResolve(story: Story, knownIds: ReadonlySet<string>): boolean {
  return story.context_refs.every((ref) => knownIds.has(ref));
}

async function loadProjectDodProfiles(ctx: SpecCommandContext): Promise<DodParseResult> {
  try {
    return await readDodProfile(ctx.paths, `${ctx.kbRoot}/${DOD_PROFILES_RELATIVE_PATH}`);
  } catch (cause) {
    if (isForgeError(cause) && cause.code === 'RUN-034') {
      return {
        success: false,
        issues: [
          {
            path: DOD_PROFILES_RELATIVE_PATH,
            message: `no DoD profiles file found at ${ctx.kbRoot}/${DOD_PROFILES_RELATIVE_PATH}.`,
          },
        ],
      };
    }
    throw cause;
  }
}

async function validateDefinitionOfReady(ctx: SpecCommandContext): Promise<RuleValidationResult> {
  const sessionsRoot = ctx.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
  const [specDocs, graph, tree, sessionDocs] = await Promise.all([
    loadStoryDocs(ctx),
    buildProjectGraph(ctx),
    parseKbTree(ctx.paths, ctx.kbRoot),
    listSpecArtifacts(ctx.paths, sessionsRoot),
  ]);
  const readyStories = storiesFromDocs(specDocs).filter(isReadyOrLater);
  const errors: RuleViolation[] = [];

  if (readyStories.length === 0) return ruleResult('definition-of-ready', errors);

  const profileResult = await loadProjectDodProfiles(ctx);
  if (!profileResult.success) {
    for (const story of readyStories) {
      errors.push({
        subject: story.id,
        message: `cannot verify readiness: ${profileResult.issues.map((issue) => issue.message).join('; ')}`,
      });
    }
    return ruleResult('definition-of-ready', errors);
  }

  const knownIds = collectKnownIds(graph, tree, specDocs, sessionDocs);
  const blockingOpenQuestion = anyOpenBlockingQuestion(tree);

  for (const story of readyStories) {
    const resolveCheck = (id: string): boolean => {
      if (id === 'spec:story-refs-resolve') return contextRefsResolve(story, knownIds);
      if (id === 'spec:no-blocking-open-questions') return !blockingOpenQuestion;
      return false;
    };
    const violations = evaluateDodProfile(
      profileResult.profileFile,
      story.dod_profile,
      'ready',
      { story },
      resolveCheck,
    );
    for (const violation of violations) {
      errors.push({ subject: story.id, message: violation.message });
    }
  }
  return ruleResult('definition-of-ready', errors);
}

// --- dispatch ---------------------------------------------------------------------------------

/** Runs exactly one of the six real, named checks `G-Ready.gate.yaml`/`G-Stable.gate.yaml` already
 * ship as a `forge spec validate --rule <name>` invocation (this file's own header comment has the
 * full JSON-contract reasoning). Never throws for a project simply missing the documents a rule
 * needs — an empty project reports zero violations for every rule, the same "nothing to complain
 * about yet" reading `specValidate`'s own generic pass already gives an empty `docs/forge/specs/`. */
export async function specValidateRule(
  ctx: SpecCommandContext,
  rule: ValidateRuleId,
): Promise<RuleValidationResult> {
  switch (rule) {
    case 'definition-of-ready':
      return validateDefinitionOfReady(ctx);
    case 'file-claim-overlap':
      return validateFileClaimOverlap(await loadStories(ctx));
    case 'unbound-acceptance-criteria': {
      const [stories, graph] = await Promise.all([loadStories(ctx), buildProjectGraph(ctx)]);
      return validateUnboundAcceptanceCriteria(stories, graph);
    }
    case 'oversized-stories':
      return validateOversizedStories(ctx);
    case 'open-sev1-sev2-defects':
      return validateOpenSevereDefects(await loadDefects(ctx));
    case 'unresolved-rca': {
      const [defects, rcas] = await Promise.all([loadDefects(ctx), loadRcas(ctx)]);
      return validateUnresolvedRca(defects, rcas);
    }
    default: {
      const unreachable: never = rule;
      throw new ForgeError('USR-003', { feature: `spec validate --rule ${String(unreachable)}` });
    }
  }
}
