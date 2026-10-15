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
 * **Why `--write` can never actually promote in THIS build.** `forge gate approve <id>` (`@forge/
 * engine/gates`' own `approveGate`) takes an already-loaded `GateDocument` -- there is structurally no
 * way to approve a gate whose own file does not exist. `G-TestAdopt.gate.yaml` is P7's surface
 * (`process/plans/PLAN-M17.md` P7), not built by this piece, so no approval for it can ever exist yet
 * -- `runPromotion` refuses at exactly that point (`'gate-not-available'`), honestly, rather than
 * writing speculative merge-into-`.forge/config.yaml` logic this build has no way to reach or test
 * (`QUALITY-BAR.md` R7). This IS the hand-off point `process/plans/PLAN-M17.md` P6 asks this piece to
 * build, not a gap in it -- P7 wires the real approval query and the final merge once its own gate
 * file exists, reusing `readStagedProposal`/`PromotionResult` as they stand.
 *
 * **`'gate-not-available'` is correct but not, today, what a real `forge test adopt --write` actually
 * hits.** A fresh critic round confirmed this precisely: `runDetectionAndStage` -- the only path that
 * ever stages a real record through the live CLI today -- never attaches a `proof` to what it writes
 * (`proof.ts`'s own doc comment: a probe is a mandatory input the deterministic detector cannot
 * author on its own), so `runPromotion` always finds `staged.proof === undefined` first and refuses
 * at `'proof-not-passing'` instead. `'gate-not-available'` is real and correctly reachable -- a
 * staged record WITH a recorded, passing proof genuinely reaches it (this file's own tests construct
 * exactly that record directly, and P7's `adopt-tests` workflow is expected to produce one for real)
 * -- it is simply not what fires for the one real caller this piece's own CLI wiring has today.
 *
 * @see specs/10 rule 8 (`G-TestAdopt`)
 * @see specs/13 F-TEST-11
 * @see specs/22 M17 P6
 */
import { ForgeError } from '@forge/core/errors';
import { pathExists, readTextFile, writeFileAtomic } from '@forge/core/fs';
import type { AbsolutePath, ProjectPaths } from '@forge/core/fs';
import { testCommandEntrySchema, type TestCommandEntry } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { z } from 'zod';

import { DETECTED_LAYER, detectTestRunners, type DetectedCandidate } from './detect.ts';
import type { ProofCheckNumber } from './proof.ts';

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
 */
export async function runDetectionAndStage(paths: ProjectPaths): Promise<DetectionStageOutcome> {
  const candidates = await detectTestRunners(paths);
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
  | { readonly outcome: 'gate-not-available'; readonly layer: string };

/**
 * `--write`'s own promotion check (`13` F-TEST-11): refuses, typed, for every real reason short of
 * an actual `G-TestAdopt` approval -- which this build cannot produce at all (this file's own doc
 * comment). Never a silent no-op and never promotes: there is no `'promoted'` branch in
 * {@link PromotionResult} because this function cannot reach one yet.
 */
export async function runPromotion(paths: ProjectPaths, layer: string): Promise<PromotionResult> {
  const staged = await loadStagedProposalOrThrow(paths, layer);
  if (staged === undefined) return { outcome: 'no-staged-proposal', layer };
  if (staged.proof === undefined) {
    return {
      outcome: 'proof-not-passing',
      layer,
      detail: "no translator proof has been recorded for this layer's staged proposal yet.",
    };
  }
  if (!staged.proof.ok) {
    return {
      outcome: 'proof-not-passing',
      layer,
      detail: `the recorded translator proof failed check ${String(staged.proof.failedCheck)}: ${staged.proof.reason}`,
    };
  }
  return { outcome: 'gate-not-available', layer };
}
