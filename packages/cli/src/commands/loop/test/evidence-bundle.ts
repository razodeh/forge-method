/**
 * `assembleAndWriteEvidenceBundle` — turns a story's already-completed `done`-phase verification and
 * coverage results into a real, committed `EvidenceBundle` artifact (`specs/18` §18.7, `PLAN-M15.md`
 * P7). The MANDATE's own seven-item list, and where each one actually comes from, is documented in
 * full on `evidenceBundleSchema` itself (`@forge/schemas`'s `evidence-bundle.ts`) — this file is the
 * one real assembly of it, not a second source of truth for what the fields mean.
 *
 * `verify`/`coverage` are supplied by the caller, the identical split `assembleAndWriteMutationEvidence`
 * already establishes for `BindingCheckCompleted`: both require running the project's own real test
 * commands (`storyVerify`/`testCoverage`), and this file's own job is turning already-computed results
 * into a document, never deciding what they are. Everything else below (`bindingEvidence`, `reviews`,
 * `gates`, `exemptions`, `cost`) is a pure read of already-written state — no test execution, no
 * side effect beyond the final write — gathered here directly.
 *
 * `GATE-516` (`packages/core/src/errors/codes.ts`) refuses the whole write, before anything touches
 * disk, when a REQUIRED evidence kind is genuinely absent: zero reviews, or any review whose verdict
 * is not `concerns`/`clear` (the only two verdicts a real merge ever lands — `undefined`/`blocked`/
 * `incomplete` are all refused; see `assembleAndWriteEvidenceBundle`'s own inline comment for why
 * `incomplete` specifically needs its own check, not just `undefined`). `checks.length === 0` is ALSO
 * refused (`missing-verify`), but is dead code on the real CLI
 * path today — confirmed directly against `storyVerify`'s own source (`commands/story.ts`): every
 * branch that could have produced an empty check list (an unreadable profiles file, a missing named
 * profile, an empty phase list) instead synthesizes a single `(profile)` check with `status:
 * 'unverifiable'`, so a `'verified'` outcome's own `checks` is never empty. Kept anyway as a defensive
 * invariant check on this function's own public, independently-callable input — not only the CLI calls
 * it — rather than trusting every future caller to have re-derived the same guarantee.
 * `coverage`/`bindingEvidence`/`gates`/`exemptions`/`cost` are never refused — each is legitimately
 * empty in an honest, complete story (see `evidenceBundleSchema`'s own doc comment for why).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see specs/22 M15 P7
 * @see PLAN-M15.md P7
 * @see SPEC-QUESTIONS.md Q286
 */
import { ForgeError, writeNewFileAtomic, type Clock } from '@forge/core';
import { listDirSorted, pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import { documentProblems } from '@forge/engine/dispatch';
import { compileStepId } from '@forge/engine/plan';
import { definitionForType, renderArtifactPath } from '@forge/schemas';
import { readEvents } from '@forge/telemetry/events';
import { attributedSpend, projectLedger } from '@forge/telemetry/ledger';
import YAML from 'yaml';

import { getSharedIdAllocator } from '../../shared.ts';
import type { StoryCheckResult, StoryPhase } from '../../story.ts';
import { loadExemptions } from './exemptions.ts';

const EVIDENCE_BUNDLE_TYPE = definitionForType('EvidenceBundle');

/** `implement-story.workflow.yaml`'s own real step ids, verbatim and in order — the fixed set a
 * single story's own lane ever runs under `implement-story`. Compiled with `compileStepId`'s own
 * TWO-argument form (`06` §6.2's `${workflowId}:${stepId}` shape, no `itemKey`): `implement-story` is
 * never a fanout target or subworkflow anywhere in this codebase (confirmed directly — no shipped
 * workflow fans out over it or invokes it via `kind: subworkflow`; `build-stage.workflow.yaml` has its
 * own, entirely separate inline per-story fanout steps), so it only ever runs standalone, one story
 * per `forge run`, and `compileStepAtDepth`'s real top-level call (`compile.ts`) never attaches an
 * itemKey to its steps. `runId` alone already scopes the event log to that one story's own run — no
 * per-step itemKey qualification is needed, and adding one (an earlier version of this file did,
 * `compileStepId(STORY_WORKFLOW_ID, stepId, storyId)`) produced a qualified id that never matches any
 * real, engine-emitted event (`swarm-review-step.ts` stamps `node.id`, which for `implement-story` is
 * always the bare `implement-story:review`), silently breaking both the review lookup and cost
 * attribution — caught by a gauntlet critic round, not by this piece's own first-draft tests, which
 * had independently made the identical wrong assumption in their own fixtures. */
const STORY_WORKFLOW_ID = 'implement-story';
const STORY_STEP_IDS = [
  'plan',
  'red',
  'green',
  'refactor',
  'self-verify',
  'review',
  'document',
  'done-check',
  'evidence',
] as const;

type ReviewVerdict = 'blocked' | 'incomplete' | 'concerns' | 'clear';
type GateOutcome = 'passed' | 'failed' | 'waived';

export interface EvidenceBundleVerify {
  readonly phase: StoryPhase;
  readonly passed: boolean;
  readonly errors: number;
  readonly checks: readonly StoryCheckResult[];
}

export interface EvidenceBundleCoverage {
  readonly acCoveragePercent: number;
  readonly ratchetRegressions: number;
  /** `TestCoverageResult.missingAcIds` (`loop/test/coverage.ts`), threaded straight through rather than
   * dropped. PROJECT-WIDE, not scoped to this story (`evidenceBundleSchema`'s own `coverage` doc
   * comment has the full, disclosed reasoning: `runAcceptanceCriteriaCoverage` has no story-scoped
   * variant) -- an AC id here can and typically does belong to a DIFFERENT, already-`done` story, not
   * the one this bundle is for. Absent when `acCoveragePercent` is 100 or the AC-coverage check itself
   * could not run. */
  readonly missingAcIds?: readonly string[];
  readonly problems?: readonly string[];
}

export interface AssembleEvidenceBundleInput {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly reportsRoot: string;
  readonly storyId: string;
  /** `process.env[FORGE_RUN_ID]` at the CLI boundary (`@forge/core`'s own session marker) — `undefined`
   * for a hand run outside any real `forge run`, in which case `reviews`/`cost` are reported as empty/
   * zero with an honest `problems` entry rather than a crash (no event log exists to read). */
  readonly runId: string | undefined;
  readonly verify: EvidenceBundleVerify;
  readonly coverage: EvidenceBundleCoverage;
  readonly clock: Clock;
}

export interface WrittenEvidenceBundle {
  readonly id: string;
  /** Project-relative path the file was written to. */
  readonly path: string;
}

async function readFrontMatter(
  paths: ProjectPaths,
  relativePath: string,
): Promise<Record<string, unknown> | undefined> {
  const target = paths.resolveWithin(relativePath);
  if (!(await pathExists(target))) return undefined;
  const text = await readTextFile(target);
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match?.[1] === undefined) return undefined;
  const parsed: unknown = YAML.parse(match[1]);
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/** Every `MutationEvidence` id already on disk for this story (`reports/mutation/{story}-*.md`,
 * `MutationEvidence`'s own registered path template) — front matter's own `story` field is the real
 * match, not the filename (a filename prefix match is ambiguous: a story id and the `{ts}` segment
 * are both hyphen-separated, so `STORY-04` would otherwise false-prefix-match `STORY-042-...`).
 * `type !== 'MutationEvidence'` is skipped: `reports/mutation/` is a plain directory, not a registry
 * the engine itself keeps clean, so a foreign `.md` file planted there (by hand, or a future piece)
 * must not be read as binding evidence just because it happens to carry a `story`/`id` field. An
 * absent `reports/mutation/` directory (this story never ran `forge test binding`) reads as `[]`, the
 * identical "optional, never a thrown error" stance `loadExemptions` already takes for its own
 * optional file. */
async function findBindingEvidenceIds(
  paths: ProjectPaths,
  reportsRoot: string,
  storyId: string,
): Promise<readonly string[]> {
  const dir = paths.resolveWithin(`${reportsRoot}/mutation`);
  if (!(await pathExists(dir))) return [];
  const names = await listDirSorted(dir);
  const ids: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const frontMatter = await readFrontMatter(paths, `${reportsRoot}/mutation/${name}`);
    if (frontMatter === undefined) continue;
    if (frontMatter['type'] !== 'MutationEvidence') continue;
    if (frontMatter['story'] !== storyId) continue;
    const id = frontMatter['id'];
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

/** The single most recent `GateReport` per gate name, project-wide (`reports/gates/*.md`) — never
 * scoped to this story: no gate in the real `implement-story` workflow runs per-story at all (gates
 * are a stage/run-level checkpoint), and `GateReport`'s own registered path carries no story reference
 * to scope by even if one were wanted. A disclosed v1 simplification (`evidenceBundleSchema`'s own doc
 * comment has the full reasoning), not a story-scoped list. `type !== 'GateReport'` is skipped, the
 * identical reason `findBindingEvidenceIds` checks its own directory's `type` field. "Most recent" is
 * `evaluatedAt`, parsed (`Date.parse`, not a raw string compare — a string compare is only valid for
 * identically-formatted ISO instants, and nothing enforces every real writer uses the same precision)
 * — a report with no `evaluatedAt`, or one that fails to parse (written before `PLAN-M14.md` P17, or
 * the static stub template), sorts before every real one and is dropped if a newer, real report for
 * the same gate exists; kept, as the only report for that gate, if it is the only one found. */
async function findLatestGateOutcomes(
  paths: ProjectPaths,
  reportsRoot: string,
): Promise<
  readonly {
    readonly id: string;
    readonly gate: string;
    readonly outcome?: GateOutcome | undefined;
  }[]
> {
  const dir = paths.resolveWithin(`${reportsRoot}/gates`);
  if (!(await pathExists(dir))) return [];
  const names = await listDirSorted(dir);
  const latestByGate = new Map<
    string,
    {
      readonly id: string;
      readonly gate: string;
      readonly outcome?: GateOutcome | undefined;
      readonly evaluatedAtMs: number;
    }
  >();
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const frontMatter = await readFrontMatter(paths, `${reportsRoot}/gates/${name}`);
    if (frontMatter === undefined) continue;
    if (frontMatter['type'] !== 'GateReport') continue;
    const id = frontMatter['id'];
    const gate = frontMatter['gate'];
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof gate !== 'string' || gate.length === 0) continue;
    const outcome =
      frontMatter['outcome'] === 'passed' ||
      frontMatter['outcome'] === 'failed' ||
      frontMatter['outcome'] === 'waived'
        ? frontMatter['outcome']
        : undefined;
    const evaluatedAtMs =
      typeof frontMatter['evaluatedAt'] === 'string' ? Date.parse(frontMatter['evaluatedAt']) : NaN;
    const safeEvaluatedAtMs = Number.isFinite(evaluatedAtMs) ? evaluatedAtMs : -Infinity;
    const existing = latestByGate.get(gate);
    if (existing === undefined || safeEvaluatedAtMs > existing.evaluatedAtMs) {
      latestByGate.set(gate, { id, gate, outcome, evaluatedAtMs: safeEvaluatedAtMs });
    }
  }
  return [...latestByGate.values()]
    .sort((a, b) => (a.gate < b.gate ? -1 : a.gate > b.gate ? 1 : 0))
    .map(({ id, gate, outcome }) => ({ id, gate, outcome }));
}

/** Every `ArtifactCreated`/`ReviewReport` event THIS RUN's own event log recorded for `implement-
 * story`'s own `review` step (`swarm-review-step.ts` emits one per successfully-committed report) —
 * never a project-wide scan, which `ReviewReport`'s own registered path (no story segment at all)
 * gives no way to safely narrow. Scoped by `runId` alone, not a per-story qualified step id:
 * `implement-story` runs exactly one story per `forge run` (see this module's own top-of-file doc
 * comment), so `runId`'s own event log already contains only this story's events — a compiled step id
 * of plain `implement-story:review` is both correct and the only one a real run ever emits.
 * `runId === undefined` (no real `forge run` in progress) reads as `[]`: there is no event log to
 * read. */
async function findReviewsThisRun(
  projectRoot: string,
  runId: string | undefined,
): Promise<readonly { readonly id: string; readonly verdict?: ReviewVerdict | undefined }[]> {
  if (runId === undefined) return [];
  const reviewStepId = compileStepId(STORY_WORKFLOW_ID, 'review');
  const reviews: { readonly id: string; readonly verdict?: ReviewVerdict | undefined }[] = [];
  for await (const event of readEvents(projectRoot, runId)) {
    if (event.type !== 'ArtifactCreated') continue;
    if (event.stepId !== reviewStepId) continue;
    // `ForgeEvent.payload` is `unknown` by design (`@forge/telemetry/events`'s own doc comment:
    // `parseEventLine` deliberately does not validate payload shape) -- a malformed or partially-
    // written log line must degrade to "this event contributes nothing," never an uncaught crash, the
    // identical guard `packages/engine/src/resume/reconstruct.ts`'s own payload readers already take.
    if (typeof event.payload !== 'object' || event.payload === null) continue;
    const payload = event.payload as Record<string, unknown>;
    if (payload['type'] !== 'ReviewReport') continue;
    const id = payload['id'];
    if (typeof id !== 'string' || id.length === 0) continue;
    const verdict =
      payload['verdict'] === 'blocked' ||
      payload['verdict'] === 'incomplete' ||
      payload['verdict'] === 'concerns' ||
      payload['verdict'] === 'clear'
        ? payload['verdict']
        : undefined;
    reviews.push({ id, verdict });
  }
  return reviews;
}

/** Ids of every currently-declared `Exemption` (M15 P6) whose own `testId` is qualified under this
 * story (`exemptions.ts`'s own `qualifiedTestId`, `"<storyId>: <testName>"`) — `[]` is the ordinary
 * case, a story with nothing exempted, not a failure. Whether each one is itself stale or expired is
 * `forge test binding`'s own job, not recorded here: this field is "in force" as declared, at
 * assembly time, the identical "committed checkpoint" framing the Mandate itself uses. */
async function findExemptionIdsInForce(
  paths: ProjectPaths,
  reportsRoot: string,
  storyId: string,
): Promise<readonly string[]> {
  // `corruptCount` not surfaced here for the identical reason `bin.ts`'s own binding-check call site
  // isn't: this assembly path's own existing contract predates that signal.
  const { exemptions: all } = await loadExemptions(paths, reportsRoot);
  const prefix = `${storyId}: `;
  return all
    .filter((exemption) => exemption.testId.startsWith(prefix))
    .map((exemption) => exemption.id);
}

/** `attributedSpend` summed across this story's own known step ids — exact, not approximate: scoped
 * by `runId` alone, the identical reasoning `findReviewsThisRun` documents (`implement-story` runs
 * exactly one story per `forge run`, so every `UsageRecorded` event in this run's own log already
 * belongs to this story; no per-story qualification of the step id is needed or correct). `runId ===
 * undefined` reports `{ totalUsd: 0, estimated: true, problems: [...] }`: there is no event log to
 * sum, the identical honest-zero `TestCoverageResult.problems` already models for a check that could
 * not run. `estimated` is `true` if ANY contributing entry was itself estimated — every real adapter
 * this codebase can construct today reports `estimated: true` unconditionally (`packages/engine/src/
 * dispatch/steps.ts`), so this is `true` in every real run today, not a vestigial field kept for a
 * case that cannot currently occur. */
async function computeStoryCost(
  projectRoot: string,
  runId: string | undefined,
): Promise<{
  readonly totalUsd: number;
  readonly estimated: boolean;
  readonly problems?: readonly string[];
}> {
  if (runId === undefined) {
    return {
      totalUsd: 0,
      estimated: true,
      problems: ['no FORGE_RUN_ID in the environment; cost could not be attributed to this story'],
    };
  }
  const entries = await projectLedger(readEvents(projectRoot, runId));
  const stepIds = STORY_STEP_IDS.map((stepId) => compileStepId(STORY_WORKFLOW_ID, stepId));
  const totalUsd = stepIds.reduce((sum, stepId) => sum + attributedSpend(entries, stepId), 0);
  const estimated = entries.some((entry) => stepIds.includes(entry.stepId) && entry.estimated);
  return { totalUsd, estimated };
}

function evidenceBundleFrontMatter(
  id: string,
  input: AssembleEvidenceBundleInput,
  gathered: {
    readonly bindingEvidence: readonly string[];
    readonly reviews: readonly {
      readonly id: string;
      readonly verdict?: ReviewVerdict | undefined;
    }[];
    readonly gates: readonly {
      readonly id: string;
      readonly gate: string;
      readonly outcome?: GateOutcome | undefined;
    }[];
    readonly exemptions: readonly string[];
    readonly cost: {
      readonly totalUsd: number;
      readonly estimated: boolean;
      readonly problems?: readonly string[];
    };
  },
): Record<string, unknown> {
  const today = input.clock.now().slice(0, 10);
  return {
    id,
    type: 'EvidenceBundle',
    schemaVersion: 1,
    title: `Evidence — ${input.storyId}`,
    status: 'recorded',
    created: today,
    updated: today,
    revision: 1,
    author: 'engine',
    ...(input.runId === undefined ? {} : { run: input.runId }),
    changelog: [],
    story: input.storyId,
    verify: input.verify,
    coverage: input.coverage,
    bindingEvidence: gathered.bindingEvidence,
    reviews: gathered.reviews,
    gates: gathered.gates,
    exemptions: gathered.exemptions,
    cost: gathered.cost,
    assembledAt: input.clock.now(),
  };
}

/** `---\n<yaml>---\n\n<body>`, the identical shape `renderMutationEvidenceFile` already establishes —
 * `EvidenceBundle`'s own real template carries no dynamic body content (every real finding lives in
 * the front matter above), so the body here is the identical fixed paragraph, not re-derived per
 * call. */
function renderEvidenceBundleFile(frontMatter: Record<string, unknown>): string {
  const body =
    '<Nothing further: every real finding lives in the front matter above, not the body -- this\n' +
    "artifact exists to summarize the story's own already-committed evidence, not to restate it.>\n";
  return `---\n${YAML.stringify(frontMatter)}---\n\n${body}`;
}

/**
 * Gathers every pure, I/O-only evidence kind (`bindingEvidence`/`reviews`/`gates`/`exemptions`/
 * `cost`), checks the two REQUIRED ones (`reviews` non-empty with every verdict recorded; `verify`'s
 * own `checks` non-empty), allocates a real `EVID-###` id, renders and self-validates a real
 * `EvidenceBundle` document, and writes it with `writeNewFileAtomic` — refusing (`RUN-114`) rather
 * than silently overwriting, should two calls ever somehow resolve to the identical `{id}-{story}`
 * path.
 *
 * @throws {ForgeError} `GATE-516` if a required evidence kind is genuinely absent.
 * @throws {RangeError} if the document this function built is itself invalid — a bug here, not a
 * caller-facing failure with a remedy, the identical stance `assembleAndWriteMutationEvidence` takes.
 * @throws {ForgeError} `RUN-114` if the computed path already exists.
 */
export async function assembleAndWriteEvidenceBundle(
  input: AssembleEvidenceBundleInput,
): Promise<WrittenEvidenceBundle> {
  if (input.verify.checks.length === 0) {
    throw new ForgeError('GATE-516', { storyId: input.storyId, reason: 'missing-verify' });
  }

  const [bindingEvidence, reviews, gates, exemptions, cost] = await Promise.all([
    findBindingEvidenceIds(input.paths, input.reportsRoot, input.storyId),
    findReviewsThisRun(input.projectRoot, input.runId),
    findLatestGateOutcomes(input.paths, input.reportsRoot),
    findExemptionIdsInForce(input.paths, input.reportsRoot, input.storyId),
    computeStoryCost(input.projectRoot, input.runId),
  ]);

  // `concerns`/`clear` are the ONLY two verdicts the real engine ever lands at merge
  // (`resolveSwarmReviewLanding`, `packages/engine/src/dispatch/steps.ts`: `verdict === 'incomplete' ||
  // verdict === 'blocked'` both refuse with `MERGE-REVIEW-INCOMPLETE`, treated identically). `blocked`
  // already fails the review step itself (`swarm-review-step.ts`) so it is unlikely to reach here at
  // all, but `incomplete` does NOT fail the step -- the DAG proceeds through document/done-check/
  // evidence/commit on an ordinary reviewer-session hiccup, so without this check a real
  // `EvidenceBundle` could be committed for a story that was always going to be refused at the merge
  // this bundle is itself evidence FOR -- a gap a gauntlet critic round found in an earlier version of
  // this check, which only refused on zero reviews or an undefined verdict.
  if (
    reviews.length === 0 ||
    reviews.some((review) => review.verdict !== 'concerns' && review.verdict !== 'clear')
  ) {
    throw new ForgeError('GATE-516', { storyId: input.storyId, reason: 'missing-review' });
  }

  const allocator = getSharedIdAllocator(input.paths, input.clock);
  const id = await allocator.allocate('EvidenceBundle');
  const frontMatter = evidenceBundleFrontMatter(id, input, {
    bindingEvidence,
    reviews,
    gates,
    exemptions,
    cost,
  });
  const text = renderEvidenceBundleFile(frontMatter);

  const pathResult = renderArtifactPath('EvidenceBundle', { id, story: input.storyId });
  if (!pathResult.success) {
    // `EvidenceBundle`'s own registered `pathTemplate` names exactly `{id}` and `{story}`, both
    // supplied above -- this would be a bug in this function, not a caller-facing failure.
    throw new RangeError(
      `renderArtifactPath('EvidenceBundle', ...) failed: missing ${pathResult.missingVariable}`,
    );
  }
  // `EvidenceBundle`'s own registered `pathTemplate` ('reports/evidence/{id}-{story}.md') names a
  // literal `reports/` top-level segment matching `ForgeConfig.paths.reports`'s own namespace label --
  // the identical "strip the registered top-level label, reroot under the real configured path"
  // `writeGateReportFile`/`assembleAndWriteMutationEvidence` already both do.
  const relativePath = `${input.reportsRoot}/${pathResult.path.replace(/^reports\//, '')}`;

  const problems = documentProblems(EVIDENCE_BUNDLE_TYPE, relativePath, text).problems;
  if (problems.length > 0) {
    throw new RangeError(`the engine built an invalid ${id}: ${problems.join('; ')}`);
  }

  await writeNewFileAtomic(input.paths.resolveWithin(relativePath), text);
  return { id, path: relativePath };
}
