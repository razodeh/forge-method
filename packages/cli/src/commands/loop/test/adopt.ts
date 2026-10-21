/**
 * `forge test adopt` -- `13` F-TEST-11's own staged-proposal lifecycle: `runDetectionAndStage`
 * (deterministic detection, `detect.ts`) writes or hands off a per-layer proposal record,
 * `.forge/test-adopt/<layer>.proposal.yaml`, committed to the project the identical way `.forge/
 * parity/` is (never `.forge/config.yaml` itself); `runPromotion` is `--write`'s own promotion check.
 *
 * **Why writing and approving cannot be the same act** (`13` F-TEST-11's own paragraph, restated
 * here because it is this file's whole reason to exist): `G-TestAdopt`'s one deterministic check has
 * to find something to evaluate before a human approves it, and nothing may reach the live
 * `execution.testCommands.<layer>` entry before that approval -- so a THIRD state (this file's own
 * staged record) sits between "investigated" and "live".
 *
 * **The P7 hand-off, closed.** `G-TestAdopt.gate.yaml` now exists (`templates/checks/G-TestAdopt.gate.yaml`,
 * `specs/22` M17 P7), scheduled by `templates/workflows/adopt-tests.workflow.yaml`'s own `kind: gate`
 * step (`10` §10.3 rule 8). `runPromotion` now really can reach `'promoted'`: it re-runs the identical
 * deterministic check the gate's own `test-adoption:approved` check shells out to
 * ({@link checkTestAdoptionApproved}, in-process rather than via a second `forge` subprocess -- this
 * function's own job is deciding whether to merge, not re-producing `forge gate check`'s own report/
 * telemetry audit trail, which a human who wants it still gets by running `forge gate check
 * G-TestAdopt`/`forge gate approve G-TestAdopt` themselves, the normative way `10` §10.3 rule 6
 * already requires approval to happen), then asks whether a human has actually recorded that approval
 * for the given run (`isGateApprovedForRun`, reading the real `GateApproved`/`GateRejected` events
 * `@forge/telemetry/events` already persists -- the identical source `gate-commands.ts`'s own
 * `recordedWaivers` reads for waivers). Only once both are true does it merge the staged command into
 * the live `.forge/config.yaml` (`mergeStagedCommandIntoConfig`) -- never through `configSet`
 * (`../../config.ts`), which forces every `execution.testCommands.<layer>` value through
 * `testCommandValue`'s own "never YAML-parsed" bare-string path and cannot write the structured form
 * a P7 proposal actually is.
 *
 * @see specs/10 rule 8 (`G-TestAdopt`)
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 * @see specs/22 M17 P7
 */
import { ForgeError } from '@forge/core/errors';
import { listDirSorted, pathExists, readTextFile, writeFileAtomic } from '@forge/core/fs';
import type { AbsolutePath, ProjectPaths } from '@forge/core/fs';
import { ADOPT_TESTS_EXEC_PATTERNS } from '@forge/engine/dispatch';
import { configSchema, testCommandEntrySchema, type TestCommandEntry } from '@forge/schemas/config';
import { readEvents } from '@forge/telemetry/events';
import * as YAML from 'yaml';
import { z } from 'zod';

import { CONFIG_REL_PATH, readConfig } from '../../config.ts';
import { DETECTED_LAYER, detectTestRunners, type DetectedCandidate } from './detect.ts';
import { computeProofSubjectHash, type ProofCheckNumber } from './proof.ts';

const PROPOSAL_ROOT = '.forge/test-adopt';

function proposalRelPath(layer: string): string {
  return `${PROPOSAL_ROOT}/${layer}.proposal.yaml`;
}

/** Resolves (containment-checked, `CFG-003`/`CFG-004`) the staged proposal record's own path for
 * `layer`. Exported so a caller that only needs the path (a future `forge doctor` re-verification
 * pass, say) does not have to re-derive `proposalRelPath`'s own naming convention independently. */
export function stagedProposalPath(paths: ProjectPaths, layer: string): AbsolutePath {
  return paths.resolveWithin(proposalRelPath(layer));
}

const proofCheckNumberSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const stagedProofSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      subjectHash: z.string().min(1),
      runnerVersion: z.string().min(1),
      checkedAt: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      failedCheck: proofCheckNumberSchema,
      reason: z.string().min(1),
      subjectHash: z.string().min(1),
      runnerVersion: z.string().min(1),
      checkedAt: z.string().min(1),
    })
    .strict(),
]);

/** A staged proposal record's own schema -- `13` F-TEST-11's own list of what one carries: the
 * layer, the exact proposed `execution.testCommands.<layer>` entry, which path produced it, a human-
 * readable reason, and the translator proof's own full result where one has been run. Unknown keys
 * are rejected (`.strict()`, matching this codebase's own `declaration.ts`/`document.ts` precedent
 * for every other committed, hand-editable project file). */
const stagedProposalRecordSchema = z
  .object({
    layer: z.string().min(1),
    source: z.enum(['detected', 'agent', 'human']),
    command: testCommandEntrySchema,
    reason: z.string().min(1),
    proof: stagedProofSchema.optional(),
  })
  .strict();

/** One `.forge/test-adopt/<layer>.proposal.yaml` document (`13` F-TEST-11). `proof` is absent for a
 * bare detection that has not yet been proven (`runDetectionAndStage` never supplies one -- `proof.ts`'s
 * own doc comment: a probe is a mandatory input this detector cannot author on its own). */
export interface StagedProposalRecord {
  readonly layer: string;
  readonly source: 'detected' | 'agent' | 'human';
  readonly command: TestCommandEntry;
  readonly reason: string;
  readonly proof?:
    | {
        readonly ok: true;
        readonly subjectHash: string;
        readonly runnerVersion: string;
        readonly checkedAt: string;
      }
    | {
        readonly ok: false;
        readonly failedCheck: ProofCheckNumber;
        readonly reason: string;
        readonly subjectHash: string;
        readonly runnerVersion: string;
        readonly checkedAt: string;
      }
    | undefined;
}

/** Writes (or overwrites -- `13` F-TEST-11: "writes OR OVERWRITES one staged proposal record per
 * layer") `record` as `layer`'s own staged proposal, atomically. */
export async function writeStagedProposal(
  paths: ProjectPaths,
  layer: string,
  record: StagedProposalRecord,
): Promise<void> {
  await writeFileAtomic(stagedProposalPath(paths, layer), YAML.stringify(record));
}

/** `readStagedProposal`'s own result -- a real, typed outcome for each of the three ways reading a
 * staged proposal can go, never a thrown exception (that is {@link loadStagedProposalOrThrow}'s own,
 * separate job, the identical "non-throwing validator plus a throwing wrapper" split this codebase's
 * `declaration.ts` already establishes for `.forge/parity/*.parity.yaml`). */
export type ReadStagedProposalResult =
  | { readonly outcome: 'found'; readonly record: StagedProposalRecord }
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'invalid'; readonly key: string; readonly detail: string };

/** Reads and validates `layer`'s own staged proposal record, never throwing. `key` is the first
 * schema issue's own real dotted path when there is one (matching `CFG-510`'s own precedent of
 * naming the real offending key rather than a placeholder); `'(document)'` only for a failure with
 * no field-level location at all (unparseable YAML, or the pathological case of a schema failure
 * with no issues). */
export async function readStagedProposal(
  paths: ProjectPaths,
  layer: string,
): Promise<ReadStagedProposalResult> {
  const abs = stagedProposalPath(paths, layer);
  if (!(await pathExists(abs))) return { outcome: 'missing' };
  const text = await readTextFile(abs);
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (cause) {
    return {
      outcome: 'invalid',
      key: '(document)',
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
  const result = stagedProposalRecordSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return {
      outcome: 'invalid',
      key:
        firstIssue === undefined || firstIssue.path.length === 0
          ? '(document)'
          : firstIssue.path.join('.'),
      detail: result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { outcome: 'found', record: result.data };
}

/** `readStagedProposal`, throwing `CFG-518` (naming the file and the first problem) when the record
 * exists but is invalid -- the throwing counterpart `runPromotion` uses, since a malformed proposal
 * record is a real configuration defect to surface loudly, not a value for `--write` to quietly treat
 * as "nothing staged". Returns `undefined`, not a throw, when no record exists at all -- that is a
 * real, ordinary outcome (`ReadStagedProposalResult`'s own `'missing'`), not a defect. */
export async function loadStagedProposalOrThrow(
  paths: ProjectPaths,
  layer: string,
): Promise<StagedProposalRecord | undefined> {
  const result = await readStagedProposal(paths, layer);
  if (result.outcome === 'missing') return undefined;
  if (result.outcome === 'invalid') {
    throw new ForgeError('CFG-518', {
      file: proposalRelPath(layer),
      key: result.key,
      detail: result.detail,
    });
  }
  return result.record;
}

/** `runDetectionAndStage`'s own result: `'staged'` when `detectTestRunners` found a confident
 * candidate and its proposal is now on disk; `'handoff'` when it did not, carrying the real
 * `DetectedCandidate` (`confident: false`) so a caller can print exactly why, rather than inventing a
 * second, independently-worded explanation. */
export type DetectionStageOutcome =
  | { readonly outcome: 'staged'; readonly layer: string; readonly candidate: DetectedCandidate }
  | { readonly outcome: 'handoff'; readonly candidate: DetectedCandidate };

/** `detectTestRunners`'s own real contract guarantees at least one candidate (`detect.ts`'s own doc
 * comment); this is a defensive fallback only, never exercised by that function's real
 * implementation, kept so this function's own type stays a plain `DetectedCandidate`, never
 * `DetectedCandidate | undefined`, for its own caller to print. */
const NO_CANDIDATE_FALLBACK: DetectedCandidate = {
  dir: '.',
  layer: DETECTED_LAYER,
  ecosystem: 'none',
  confident: false,
  reason: 'detectTestRunners returned no candidate at all.',
};

/**
 * Runs deterministic detection (`detect.ts`) and, when it is confident, stages the proposal (`13`
 * F-TEST-11's own "Detection" paragraph: "proposes a structured entry... written to the STAGED
 * proposal record... never straight to the live config"). Never writes anything when detection is
 * not confident -- that is the hand-off to P7's `adopt-tests` workflow, not a piece this function
 * guesses through.
 *
 * `scanPaths` (`specs/22` M17 P17, a gauntlet critic finding) is the root `detectTestRunners` reads
 * manifests/CI config FROM; `paths` is always where the staged proposal is WRITTEN. They default to
 * the same value — every caller before this one only ever had a single project to both scan and
 * write for (`forge test adopt`'s own dispatch, `packages/cli/test/commands/loop/test/adopt.test.ts`,
 * both still call this with one argument, unaffected). A caller adopting a *different* on-disk
 * repository than the FORGE project it writes reports into (`forge adopt [dir]`, `commands/adopt.ts`)
 * passes that repository's own `ProjectPaths` as `scanPaths` explicitly, so detection never silently
 * scans the wrong root and proposes a runner the actually-adopted repository does not even have the
 * toolchain for.
 */
export async function runDetectionAndStage(
  paths: ProjectPaths,
  scanPaths: ProjectPaths = paths,
): Promise<DetectionStageOutcome> {
  const candidates = await detectTestRunners(scanPaths);
  const candidate = candidates[0] ?? NO_CANDIDATE_FALLBACK;
  if (!candidate.confident || candidate.command === undefined) {
    return { outcome: 'handoff', candidate };
  }
  const record: StagedProposalRecord = {
    layer: candidate.layer,
    source: 'detected',
    command: candidate.command,
    reason: candidate.reason,
  };
  await writeStagedProposal(paths, candidate.layer, record);
  return { outcome: 'staged', layer: candidate.layer, candidate };
}

/** `--write`'s own result -- see this file's own doc comment for why `'gate-not-available'` is the
 * one outcome a passing proof can ever reach in this build. */
export type PromotionResult =
  | { readonly outcome: 'no-staged-proposal'; readonly layer: string }
  | { readonly outcome: 'proof-not-passing'; readonly layer: string; readonly detail: string }
  | { readonly outcome: 'gate-not-available'; readonly layer: string }
  | { readonly outcome: 'not-approved'; readonly layer: string }
  | { readonly outcome: 'promoted'; readonly layer: string };

/** Every real `execution.testCommands.<layer>` key `G-TestAdopt`'s own `kind: gate` step may reach --
 * `detect.ts`'s own `DETECTED_LAYER` ('unit') today, but this piece never hardcodes that: `--check-
 * proof <layer>` and `runPromotion` both take a real layer argument. */
export interface TestAdoptionApprovalResult {
  readonly v: 1;
  readonly layer: string;
  /** `0`/`1`, never a `boolean` -- `G-TestAdopt.gate.yaml`'s own `failOn: 'unapproved > 0'`
   * (`evaluate.ts`'s `SUPPORTED_PARSERS`) reads a real JSON number off this command's own stdout, the
   * identical shape every other shipped gate's own `failOn` field already reads (`test/gates.test.ts`'s
   * own `PASSING_OUTPUT`/`FAILING_OUTPUT`). */
  readonly unapproved: 0 | 1;
  readonly detail: string;
}

const TRANSLATOR_DIR_REL_PATH = '.forge/test-translators';

/** The exact anchor prefixes a self-contained-translator-as-`run` is ever allowed to start with --
 * derived from `ADOPT_TESTS_EXEC_PATTERNS` itself (`@forge/engine/dispatch`), never a second,
 * hand-kept list that could drift from it. Each of that list's `<interpreter> .forge/test-
 * translators/*` entries is a literal prefix plus one trailing `*` (`matchesExecPattern`'s own "a
 * trailing * is a prefix match and nothing else" contract, `adopt-tests-grant.ts`'s own doc
 * comment) -- stripping that one trailing character recovers the exact string `vetProposedTestCommand`
 * already required `run` to START WITH for this shape to have been accepted at all. A critic round
 * (M17 P21) found this file's own FIRST attempt at this check -- `run.includes('.forge/test-
 * translators/')`, a bare substring test -- genuinely wrong: several OTHER granted patterns
 * (`make *`, `rake *`, every bare `<framework>*` pattern) are unconstrained trailing wildcards, so a
 * real, conventional command that merely PASSES the translator directory as an argument (a real
 * `--exclude=.forge/test-translators/**` flag, say) was wrongly flagged as "declares a translator" --
 * reopening the exact permanent-"stale"-at-`G-TestAdopt` failure mode this function exists to close,
 * just via a different trigger (`adopt.test.ts`'s own regression test reproduces this directly).
 * Anchoring to START-WITH, the identical anchor the real vet already enforces, closes it: no
 * conventional pattern's own anchor text can ever start with one of these prefixes (`node
 * --test*`/`npx vitest*`/etc. all start with their OWN verb, never with another interpreter
 * immediately followed by this exact directory), so a command that starts with one of these prefixes
 * can only be a genuine self-contained-translator-as-`run`. */
const TRANSLATOR_RUN_PREFIXES: readonly string[] = ADOPT_TESTS_EXEC_PATTERNS.filter((pattern) =>
  pattern.includes(`${TRANSLATOR_DIR_REL_PATH}/`),
).map((pattern) => pattern.slice(0, -1));

/** Whether `command` declares a translator script -- EITHER `13` F-TEST-11's own structured
 * `execution.testCommands.<layer>.translate` field (a conventional `run` whose raw output still
 * needs reformatting), OR `command.run` ITSELF starting with one of `TRANSLATOR_RUN_PREFIXES` (M17
 * P21: the self-contained-translator-as-`run` shape a genuinely bespoke, non-conventional runner
 * needs -- `briefs/adopt-tests.md`'s own "Produce the configuration" worked example). This is the
 * ONE thing the translator proof actually exists to gate ("the one path by which ANY format that is
 * not one of F-TEST-7 point 2's built-ins ... is ever trusted"), and `runTranslatorProof`'s own
 * `computeProofSubjectHash` call (`adopt-agent.ts`) already hashes the REAL translator bytes for
 * BOTH shapes alike, whenever a `translatorPath` was given at all -- so this function checking only
 * `.translate` (its pre-M17-P21 shape) made `evaluateTestAdoptionApproval`, below, recompute a
 * bespoke-runner proposal's subject hash from the command's own canonical JSON instead of the
 * translator's real bytes, which could never match the hash the proof actually recorded: a real,
 * reproduced live-run finding, not a hypothetical -- every self-contained-translator-as-`run`
 * proposal would stage successfully (the proof passes) and then permanently fail `G-TestAdopt`'s own
 * re-verification as "stale," forever, with nothing ever having changed. Factored out so the
 * `'detected'`-source proof bypass below (`evaluateTestAdoptionApproval`/`runPromotion`) can require
 * this is `false` as well as `source === 'detected'`, rather than trusting `source` alone -- a fresh
 * critic round's own hardening: `source === 'detected'` is only EVER written by
 * `runDetectionAndStage` today, and that function's seven static detectors (`detect.ts`) never set
 * `translate` or a translator-shaped `run`, so the two conditions happen to coincide in every build
 * that exists right now. But `detect.ts`'s own doc comment already names real expansion targets
 * (Rust, .NET, Ruby, Maven/Gradle) that could legitimately need a translator while still being a
 * deterministic, non-agent detection; if a future change proposed one of those under
 * `source: 'detected'` and this function only checked `source`, the bypass would silently reopen the
 * exact unproven-translator hole this mechanism exists to close. Requiring BOTH makes the exemption
 * safe by construction, not by the `source` convention being maintained correctly forever. */
function declaresTranslator(command: TestCommandEntry): boolean {
  if (typeof command === 'string') return false;
  return (
    command.translate !== undefined ||
    TRANSLATOR_RUN_PREFIXES.some((prefix) => command.run.startsWith(prefix))
  );
}

/** The real, current content of `<layer>`'s own translator script, re-read off disk at check time --
 * never the content a PAST proof run happened to see. There is no dedicated path field anywhere in
 * `StagedProposalRecord` (`13` F-TEST-11's own fixed shape; this piece reuses it rather than widening
 * it): the translator always lands at exactly `.forge/test-translators/<layer>.<ext>`
 * (`adopt-agent.ts`'s own `TRANSLATOR_CLAIM_PREFIX`), so the one unknown -- `<ext>` -- is resolved by
 * listing the directory and matching the layer's own prefix, never by storing the path redundantly.
 * `undefined` when none exists, or when more than one does (ambiguous -- `checkTestAdoptionApproved`
 * treats either as "cannot re-verify," never as a guess at which one is current). */
async function currentTranslatorContent(
  paths: ProjectPaths,
  layer: string,
): Promise<string | undefined> {
  const dir = paths.resolveWithin(TRANSLATOR_DIR_REL_PATH);
  if (!(await pathExists(dir))) return undefined;
  const entries = await listDirSorted(dir);
  const matches = entries.filter((name) => name.startsWith(`${layer}.`));
  if (matches.length !== 1) return undefined;
  const only = matches[0];
  return only === undefined
    ? undefined
    : readTextFile(paths.resolveWithin(`${TRANSLATOR_DIR_REL_PATH}/${only}`));
}

/**
 * `G-TestAdopt.gate.yaml`'s own `test-adoption:approved` deterministic check (`10` §10.3 rule 8,
 * `specs/22` M17 P7) -- the EXACT same logic `forge test adopt --check-proof <layer> --json`
 * (`bin.ts`) runs for that gate's own `run:` command, exported here so `runPromotion` can ask the
 * identical question in-process rather than shelling a second `forge` subprocess for its own,
 * narrower purpose (deciding whether `--write` may proceed, not producing a gate report).
 *
 * Passes (`unapproved: 0`) when: a staged proposal exists for `layer`; AND EITHER (a) its own
 * `source` is `'detected'` and it carries no proof at all -- `13` F-TEST-11's own translator proof
 * "is the one path by which ANY format that is NOT one of F-TEST-7 point 2's built-ins ... is ever
 * trusted"; `detect.ts`'s own confident candidates always map to a built-in `TEST_REPORT_FORMATS`
 * entry with no `translate`, so the proof this mechanism exists for structurally does not apply to
 * them, and `runDetectionAndStage` never supplies one (`StagedProposalRecord`'s own doc comment) --
 * OR (b) it carries a RECORDED, PASSING translator proof that is still CURRENT -- its own
 * `subjectHash` matches the proposal's current canonical form (`computeProofSubjectHash`,
 * `proof.ts`), re-derived from the translator's own REAL, CURRENT file content when one is declared,
 * never the content a past run happened to see (`10` §10.3 rule 8's own "no older than the
 * translator's own current content hash"). A `'detected'` proposal that nonetheless carries a
 * recorded proof (there is no real writer that does this today, but nothing stops a future one, or a
 * hand edit) is NOT exempted by (a) -- it is evaluated under (b) exactly like any other source, so an
 * explicit recorded failure is never silently waved through.
 *
 * Human approval at `G-TestAdopt` (`roles: [human]`, `quorum: 1`, `G-TestAdopt.gate.yaml`) is a
 * SEPARATE, later requirement `runPromotion` still enforces for every source including `'detected'`
 * -- this function only ever answers the deterministic half of that gate's own check.
 *
 * **Disclosed, not solved** (the same honest-limitation discipline `proof.ts`'s own doc comment
 * already models): the OTHER half of that same spec sentence -- "and the detected runner's own
 * current version" -- is not independently re-derived here. `proof.ts`'s own `TranslatorProofInput
 * .runnerVersion` doc comment is explicit that the version is caller-supplied, never derived by the
 * proof harness itself ("this keeps the harness a pure function of its real inputs, with no opinion
 * of its own about how a runner's version is obtained"); re-deriving it at check time would mean
 * guessing a `--version` invocation for an arbitrary runner, which no schema field here names a
 * convention for. A translator or proposal edited since the proof was taken is still caught (the
 * subject-hash half); a runner silently upgraded in place, with nothing else changed, is not.
 *
 * @see specs/10 rule 8
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P7
 */
export async function checkTestAdoptionApproved(
  paths: ProjectPaths,
  layer: string,
): Promise<TestAdoptionApprovalResult> {
  const staged = await loadStagedProposalOrThrow(paths, layer);
  return evaluateTestAdoptionApproval(staged, paths, layer);
}

/**
 * `checkTestAdoptionApproved`'s own real logic, factored out so a caller that has ALREADY loaded the
 * staged record (`runPromotion`, below) can ask the identical question without reading
 * `.forge/test-adopt/<layer>.proposal.yaml` a second time.
 *
 * **Why the second read mattered (a fresh critic round's own live repro).** `runPromotion` used to
 * read the staged record once itself, then call `checkTestAdoptionApproved` (which reads it AGAIN,
 * independently) to decide whether to proceed, and finally merge the FIRST read's own `command` --
 * three real reads of the identical file, with real work between them and no locking. A concurrent
 * rewrite of the staged file between the first and second read let the approval decision and the
 * merged command disagree: `--write` could promote a DIFFERENT command than the one its own check
 * had just verified. Reading once, here, and threading that SAME in-memory record through both the
 * evaluation and the merge closes it -- there is no longer a second or third read of this file for
 * `runPromotion` to race against at all.
 */
async function evaluateTestAdoptionApproval(
  staged: StagedProposalRecord | undefined,
  paths: ProjectPaths,
  layer: string,
): Promise<TestAdoptionApprovalResult> {
  if (staged === undefined) {
    return { v: 1, layer, unapproved: 1, detail: `no staged proposal exists for "${layer}".` };
  }
  if (staged.proof === undefined) {
    // `13` F-TEST-11's own translator proof exists only for a format that is NOT one of F-TEST-7
    // point 2's built-ins -- a confident, built-in-format `'detected'` candidate structurally never
    // has one (`detect.ts`'s own confident candidates always map to a built-in `TEST_REPORT_FORMATS`
    // entry with no `translate`; `StagedProposalRecord`'s own doc comment: `runDetectionAndStage`
    // never supplies one) and does not need one -- the refusal below is real for every OTHER source
    // (`'agent'`/`'human'`), which this mechanism exists to hold to a real, passing proof before
    // anything trusts them (`adopt-agent.ts`'s own `stageNoTestSetup`, for one, depends on exactly
    // this refusal to keep an unproven agent-proposed runner choice out of the live config), AND for
    // a `'detected'` proposal that -- contrary to every detector in this build today -- declares a
    // translator (`declaresTranslator`'s own doc comment: the bypass never trusts `source` alone).
    if (staged.source !== 'detected' || declaresTranslator(staged.command)) {
      return {
        v: 1,
        layer,
        unapproved: 1,
        detail: "no translator proof has been recorded for this layer's staged proposal yet.",
      };
    }
    return {
      v: 1,
      layer,
      unapproved: 0,
      detail:
        "this layer's staged proposal is a confident, built-in-format detection -- the translator " +
        "proof (`13` F-TEST-11) exists only for a format that is not one of F-TEST-7 point 2's " +
        'built-ins, so it does not gate a detected proposal; a human must still approve it at ' +
        'G-TestAdopt before `--write` promotes it.',
    };
  }
  if (!staged.proof.ok) {
    return {
      v: 1,
      layer,
      unapproved: 1,
      detail: `the recorded translator proof failed check ${String(staged.proof.failedCheck)}: ${staged.proof.reason}`,
    };
  }
  const needsTranslator = declaresTranslator(staged.command);
  const translatorContent = needsTranslator
    ? await currentTranslatorContent(paths, layer)
    : undefined;
  if (needsTranslator && translatorContent === undefined) {
    return {
      v: 1,
      layer,
      unapproved: 1,
      detail:
        "the staged proposal declares a translator, but this layer's own translator script is " +
        'missing (or ambiguous: more than one file) under .forge/test-translators/, so the ' +
        "recorded proof's freshness cannot be re-verified.",
    };
  }
  // `runTranslatorProof` (`proof.ts`) only ever accepts a STRUCTURED command -- a staged record whose
  // own `proof.ok` is `true` (the only way this line is reached, both returns above it already
  // handled `proof === undefined`/`!proof.ok`) can only have gotten there by actually passing that
  // proof, which cannot happen for the legacy bare-string form. The type system cannot see that
  // invariant across `writeStagedProposal`'s own real callers, so it is named here instead.
  const currentHash = computeProofSubjectHash(
    staged.command as Exclude<TestCommandEntry, string>,
    translatorContent,
  );
  if (currentHash !== staged.proof.subjectHash) {
    return {
      v: 1,
      layer,
      unapproved: 1,
      detail:
        'the recorded translator proof is stale: the proposal or its translator changed since ' +
        'the proof was taken.',
    };
  }
  return {
    v: 1,
    layer,
    unapproved: 0,
    detail: 'the recorded translator proof passed and is current.',
  };
}

/** Whether a human has recorded approval of `gateId` in `runId`'s own real event log
 * (`@forge/telemetry/events`) -- the identical source `gate-commands.ts`'s own `recordedWaivers`
 * reads for waivers, read here for approvals instead. A LATER `GateRejected` for the same gate
 * supersedes an earlier `GateApproved` (events are read in their real append order, so the last one
 * this function sees wins) -- approval is never sticky past an explicit later rejection. */
async function isGateApprovedForRun(
  projectRoot: string,
  runId: string,
  gateId: string,
): Promise<boolean> {
  let approved = false;
  for await (const event of readEvents(projectRoot, runId)) {
    if (event.type !== 'GateApproved' && event.type !== 'GateRejected') continue;
    const payload = event.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    if ((payload as Readonly<Record<string, unknown>>)['gateId'] !== gateId) continue;
    approved = event.type === 'GateApproved';
  }
  return approved;
}

/** `staged.command`, merged into the LIVE `.forge/config.yaml` at `execution.testCommands.<layer>` --
 * never through `configSet` (`../../config.ts`), whose own `testCommandValue` forces every
 * `execution.testCommands.<layer>` value through its "never YAML-parsed, always the bare-string
 * form" path (`configSet`'s own doc comment: "the value as written... `true`, `123` and `a: b` would
 * parse into other types" is about avoiding an ACCIDENTAL type change, not about ever accepting the
 * real, intentional structured form). Re-validates the WHOLE config against `configSchema` before
 * writing, the identical discipline `configSet` itself already applies, so a merge that would
 * produce an invalid config is refused (`CFG-001`) rather than written. */
async function mergeStagedCommandIntoConfig(
  paths: ProjectPaths,
  layer: string,
  command: TestCommandEntry,
): Promise<void> {
  const config = await readConfig(paths);
  const merged = {
    ...config,
    execution: {
      ...config.execution,
      testCommands: { ...config.execution.testCommands, [layer]: command },
    },
  };
  const result = configSchema.safeParse(merged);
  if (!result.success) {
    throw new ForgeError('CFG-001', { path: CONFIG_REL_PATH, line: 0 });
  }
  await writeFileAtomic(paths.resolveWithin(CONFIG_REL_PATH), YAML.stringify(result.data));
}

/** `--write`'s own promotion context: where this project's gates live, its real root (for the real
 * event log `isGateApprovedForRun` reads), and how to resolve the run whose own `G-TestAdopt`
 * approval is being asked about (`forge test adopt --write --run <runId>`, mirroring `forge gate
 * approve <id> --run <runId>`'s identical convention -- approval is always run-scoped, never a
 * standalone, global record).
 *
 * `resolveRunId` is a THUNK, not a plain `runId` string, called only once `runPromotion` actually
 * needs one -- `no-staged-proposal`/`proof-not-passing`/`gate-not-available` are all real, reachable
 * refusals for a project that has never run anything at all (bin.ts's own `resolveDispatchRunId`
 * throws `RUN-048` when `--run` is omitted and no `last-run.json` exists yet), and a fresh critic
 * round confirmed directly that resolving it eagerly made every ONE of those three refusals fail
 * with `RUN-048` instead of their own real, named reason on a project with no prior run at all. */
export interface PromotionContext {
  readonly checksRoot: string;
  readonly projectRoot: string;
  readonly resolveRunId: () => Promise<string>;
}

/**
 * `--write`'s own promotion check (`13` F-TEST-11): refuses, typed, for every real reason short of
 * an actual, recorded `G-TestAdopt` approval, and -- now that `G-TestAdopt.gate.yaml` exists
 * (`specs/22` M17 P7) -- really promotes once one exists. Never a silent no-op: `'promoted'` is the
 * one outcome that writes anything at all, and it is reached only after BOTH the deterministic check
 * ({@link checkTestAdoptionApproved}) and a real recorded human approval ({@link isGateApprovedForRun})
 * agree.
 *
 * **The translator-proof requirement does not apply to a confident, built-in-format `'detected'`
 * candidate with no proof** (a fresh critic round's own live repro, `process/plans/PLAN-M17.md` P21:
 * `forge test adopt --write` could NEVER promote the single most common case -- Vitest, pytest,
 * `node --test`, Jest, Mocha -- because this function refused unconditionally the instant
 * `staged.proof === undefined`, which is the ONLY state a bare detection ever reaches
 * (`runDetectionAndStage` never supplies one; `StagedProposalRecord`'s own doc comment already said
 * so). `13` F-TEST-11's own "The translator proof" paragraph is explicit that this proof "is the one
 * path by which ANY format that is NOT one of F-TEST-7 point 2's built-ins ... is ever trusted" --
 * it was never meant to gate a built-in-format detection at all. The early refusal below is now
 * skipped for exactly that one case (`source === 'detected'` AND no proof recorded AND the staged
 * command does not itself declare a translator -- {@link declaresTranslator}'s own doc comment has
 * the hardening rationale: `source` alone is never trusted as a proxy for "no translator", even
 * though the two happen to coincide for every detector this build ships today); every other
 * reachable state -- no staged proposal, a FAILED or STALE proof regardless of source, or an
 * agent/human-authored proposal with no proof at all -- refuses exactly as before, and human
 * approval at `G-TestAdopt` is still required for every source, including `'detected'`.
 */
export async function runPromotion(
  paths: ProjectPaths,
  layer: string,
  context: PromotionContext,
): Promise<PromotionResult> {
  const staged = await loadStagedProposalOrThrow(paths, layer);
  if (staged === undefined) return { outcome: 'no-staged-proposal', layer };
  if (staged.proof === undefined) {
    if (staged.source !== 'detected' || declaresTranslator(staged.command)) {
      return {
        outcome: 'proof-not-passing',
        layer,
        detail: "no translator proof has been recorded for this layer's staged proposal yet.",
      };
    }
    // `source === 'detected'` with no proof AND no declared translator: the translator proof does
    // not gate this case at all (see this function's own doc comment) -- falls through to the
    // gate-availability/approval checks below, the same as a passing proof would.
  } else if (!staged.proof.ok) {
    return {
      outcome: 'proof-not-passing',
      layer,
      detail: `the recorded translator proof failed check ${String(staged.proof.failedCheck)}: ${staged.proof.reason}`,
    };
  }
  const gatePath = paths.resolveWithin(`${context.checksRoot}/G-TestAdopt.gate.yaml`);
  if (!(await pathExists(gatePath))) {
    return { outcome: 'gate-not-available', layer };
  }
  // The SAME `staged` this function already read, above -- never a second read of the staged-proposal
  // file (`evaluateTestAdoptionApproval`'s own doc comment has the full critic finding this closes).
  const check = await evaluateTestAdoptionApproval(staged, paths, layer);
  if (check.unapproved === 1) {
    return { outcome: 'proof-not-passing', layer, detail: check.detail };
  }
  const runId = await context.resolveRunId();
  const approved = await isGateApprovedForRun(context.projectRoot, runId, 'G-TestAdopt');
  if (!approved) {
    return { outcome: 'not-approved', layer };
  }
  // The identical `staged.command` the check above just verified -- never re-read, so the merge can
  // never disagree with what was actually checked.
  await mergeStagedCommandIntoConfig(paths, layer, staged.command);
  return { outcome: 'promoted', layer };
}
