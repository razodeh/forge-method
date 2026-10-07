/**
 * `assembleAndWriteMutationEvidence` — turns one of `runBindingCheck`'s own completed results (`specs/22`
 * M15 P3) into a real, committed `MutationEvidence` artifact (`specs/18` §18.7, registered in M15 P1/P2).
 *
 * Deliberately a separate module from `binding.ts`: that file's own doc comment states plainly that it
 * "does NOT itself decide 'bound' vs 'not bound,' write a `MutationEvidence` artifact, or allocate its
 * own id" — those are this piece's job (`PLAN-M15.md` P4, `forge test binding`, the stateless verb that
 * wraps P3). Keeping the split real, not just stated, means this file — not `binding.ts` — is the one
 * that imports `@forge/schemas`'s artifact machinery and `getSharedIdAllocator`.
 *
 * Mirrors the real, already-shipped `GateReport` writer (`packages/cli/src/commands/run/
 * gate-commands.ts`'s own `writeGateReportFile`) almost exactly — id allocation, `renderArtifactPath`,
 * `documentProblems` self-check, reroot under the configured `reports` path — with two real
 * differences: id allocation goes through the standard, registry-driven `getSharedIdAllocator` (`Mutat
 * ionEvidence` has no `GateReport`-style historical reason for a bespoke scan), and the final write
 * uses `writeNewFileAtomic` (`specs/18` §18.7, `RUN-114`, M15 P2), not plain `writeFileAtomic` —
 * `MutationEvidence` is genuinely append-only; `GateReport` is not.
 *
 * **`revert-hunks` (`specs/22` M16 P13, additive).** When `WriteMutationEvidenceInput.hunkMutation` is
 * given (`M16 P12`'s own `HunkMutationReport`, present only when `forge test binding --hunks`'s own
 * change-level check reached `'completed'`), this same function writes the OTHER real shape
 * `mutationEvidenceSchema` already carries (`M16 P5`, `hunkRun`): `schemaVersion: 2`,
 * `mutationKind: 'revert-hunks'`, and `hunkRun` ALONGSIDE the unchanged `revertedRange` — never
 * instead of it (`SPEC-QUESTIONS.md` Q299 Decision 2: "beyond" names an addition, not a replacement).
 * One call, one write, one new record either way: `forge test binding` never had a record-skipping
 * flag for the plain shape (no `--no-record` exists anywhere in its own flag surface, confirmed
 * directly against `bin.ts`), so this extension mirrors that exact convention rather than inventing a
 * new one — writing the hunk-level shape is unconditional on `hunkMutation` being present, the same
 * way writing the plain shape is unconditional on the check having completed.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-10
 * @see specs/22 M15 P4
 * @see specs/22 M16 P13
 * @see PLAN-M15.md P4
 * @see process/SPEC-QUESTIONS.md Q299
 */
import { writeNewFileAtomic, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { documentProblems } from '@forge/engine/dispatch';
import { definitionForType, renderArtifactPath } from '@forge/schemas';
import YAML from 'yaml';

import { getSharedIdAllocator } from '../../shared.ts';
import type { BindingCheckCompleted } from './binding.ts';
import type { HunkMutationEntry, HunkMutationReport } from './hunk-mutation.ts';

const MUTATION_EVIDENCE_TYPE = definitionForType('MutationEvidence');

export interface WriteMutationEvidenceInput {
  readonly paths: ProjectPaths;
  readonly reportsRoot: string;
  readonly storyId: string;
  readonly runId: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly result: BindingCheckCompleted;
  readonly clock: Clock;
  /**
   * Present iff `forge test binding --hunks` ran and the change-level check reached `'completed'`
   * with real per-hunk verdicts (`specs/22` M16 P12's own `HunkMutationReport`). When given, this
   * call's own written record carries `mutationKind: 'revert-hunks'`, `schemaVersion: 2` and
   * `hunkRun` instead of the plain `revert-implementation` shape — every other field (`revertedRange`
   * included) is built exactly as it always was. Absent for every M15-shaped caller: that path is
   * unchanged byte-for-byte (`specs/22` M16 P13).
   */
  readonly hunkMutation?: HunkMutationReport;
}

export interface WrittenMutationEvidence {
  readonly id: string;
  /** Project-relative path the file was written to. */
  readonly path: string;
}

/** Flattens one `HunkMutationEntry`'s own discriminated `HunkVerdict` into `hunkEntrySchema`'s flat
 * `{id, path, ranges, contentHash, verdict, killedBy?}` shape (`specs/22` M16 P13) — `killedBy` only
 * for `kind: 'killed'`, omitted (never a value of `undefined`) otherwise, the identical
 * `exactOptionalPropertyTypes` convention this module's own `mutationEvidenceFrontMatter` already
 * follows. Deliberately carries no `reason`: `18` §18.7's own hunk-list bullet names exactly
 * "id, path, ranges, content hash, verdict and killedBy" — an `invalid`/`skipped` hunk's own `reason`
 * is real and surfaced (the `--json` envelope, `bin.ts`'s own `hunkEntryToJson`; human output, this
 * piece's own `bin.ts` addition) but deliberately NOT persisted here, matching the spec's own
 * exhaustive field list rather than silently widening it. */
function hunkEntryToRecord(entry: HunkMutationEntry): Record<string, unknown> {
  const { verdict } = entry;
  return {
    id: entry.id,
    path: entry.path,
    ranges: entry.ranges,
    contentHash: entry.contentHash,
    verdict: verdict.kind,
    ...(verdict.kind === 'killed' ? { killedBy: verdict.killedBy } : {}),
  };
}

/** `hunkRunSchema`'s own shape, built from a real `HunkMutationReport` (`specs/22` M16 P13). */
function hunkRunFrontMatter(report: HunkMutationReport): Record<string, unknown> {
  return {
    baseSha: report.baseSha,
    diffAlgorithm: report.diffAlgorithm,
    granularity: report.granularity,
    hunks: report.hunks.map(hunkEntryToRecord),
  };
}

function mutationEvidenceFrontMatter(
  id: string,
  input: WriteMutationEvidenceInput,
): Record<string, unknown> {
  const today = input.clock.now().slice(0, 10);
  const { hunkMutation } = input;
  return {
    id,
    type: 'MutationEvidence',
    schemaVersion: hunkMutation === undefined ? 1 : 2,
    title: `forge test binding — ${input.storyId}`,
    status: 'recorded',
    created: today,
    updated: today,
    revision: 1,
    author: 'engine',
    run: input.runId,
    changelog: [],
    story: input.storyId,
    mutationKind: hunkMutation === undefined ? 'revert-implementation' : 'revert-hunks',
    revertedRange: input.result.revertedRange,
    namedTests: input.result.namedTests,
    failedUnderMutation: input.result.failedUnderMutation,
    restoreVerified: input.result.restoreVerified,
    toolVersions: input.toolVersions,
    ranAt: input.result.ranAt,
    ...(hunkMutation === undefined ? {} : { hunkRun: hunkRunFrontMatter(hunkMutation) }),
  };
}

/** `---\n<yaml>---\n\n<body>`, the identical shape `renderGateReportFile` already establishes
 * (`packages/engine/src/gates/report.ts`) — `MutationEvidence`'s own real template (`packages/
 * templates/templates/artifacts/MutationEvidence.md`) carries no dynamic body content at all (`specs/18`
 * §18.7: "every real finding lives in the front matter above, not the body"), so the body here is the
 * identical fixed paragraph, not re-derived per call. */
function renderMutationEvidenceFile(frontMatter: Record<string, unknown>): string {
  const body =
    '<Nothing further: every real finding lives in the front matter above, not the body — a test named in\n' +
    "`namedTests` but absent from `failedUnderMutation` did not fail when the story's implementation was\n" +
    'reverted, which is the finding this artifact exists to record.>\n';
  return `---\n${YAML.stringify(frontMatter)}---\n\n${body}`;
}

/**
 * Allocates a real `MUT-###` id, renders and self-validates a real `MutationEvidence` document, and
 * writes it with `writeNewFileAtomic` — refusing (`RUN-114`) rather than silently overwriting, should
 * two calls ever somehow resolve to the identical `{story}-{ts}` path.
 *
 * @throws {RangeError} if the document this function built is itself invalid — a bug here, not a
 * caller-facing failure with a remedy, the identical stance `writeGateReportFile` already takes.
 * @throws {ForgeError} `RUN-114` if the computed path already exists.
 */
export async function assembleAndWriteMutationEvidence(
  input: WriteMutationEvidenceInput,
): Promise<WrittenMutationEvidence> {
  const allocator = getSharedIdAllocator(input.paths, input.clock);
  const id = await allocator.allocate('MutationEvidence');
  const frontMatter = mutationEvidenceFrontMatter(id, input);
  const text = renderMutationEvidenceFile(frontMatter);

  const ts = input.result.ranAt.replace(/:/g, '-');
  const pathResult = renderArtifactPath('MutationEvidence', { story: input.storyId, ts });
  if (!pathResult.success) {
    // `MutationEvidence`'s own registered `pathTemplate` names exactly `{story}` and `{ts}`, both
    // supplied above -- this would be a bug in this function, not a caller-facing failure.
    throw new RangeError(
      `renderArtifactPath('MutationEvidence', ...) failed: missing ${pathResult.missingVariable}`,
    );
  }
  // `MutationEvidence`'s own registered `pathTemplate` ('reports/mutation/{story}-{ts}.md') names a
  // literal `reports/` top-level segment matching `ForgeConfig.paths.reports`'s own namespace label --
  // the identical "strip the registered top-level label, reroot under the real configured path"
  // `writeGateReportFile` already does.
  const relativePath = `${input.reportsRoot}/${pathResult.path.replace(/^reports\//, '')}`;

  // `documentProblems` -> `validateArtifact` -> `DEFAULT_ARTIFACT_REGISTRY['MutationEvidence']` is the
  // identical `mutationEvidenceSchema` object, `superRefine` subset check included (confirmed by a
  // round-1 gauntlet critic, M15 P4, which caught an earlier version of this function running a second,
  // genuinely redundant direct `mutationEvidenceSchema.safeParse` here under a doc comment that falsely
  // claimed `documentProblems` skips field-level rules) -- one check is the real, whole check.
  const problems = documentProblems(MUTATION_EVIDENCE_TYPE, relativePath, text).problems;
  if (problems.length > 0) {
    throw new RangeError(`the engine built an invalid ${id}: ${problems.join('; ')}`);
  }

  await writeNewFileAtomic(input.paths.resolveWithin(relativePath), text);
  return { id, path: relativePath };
}
