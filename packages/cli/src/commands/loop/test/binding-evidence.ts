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
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see specs/22 M15 P4
 * @see PLAN-M15.md P4
 */
import { writeNewFileAtomic, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { documentProblems } from '@forge/engine/dispatch';
import { definitionForType, renderArtifactPath } from '@forge/schemas';
import YAML from 'yaml';

import { getSharedIdAllocator } from '../../shared.ts';
import type { BindingCheckCompleted } from './binding.ts';

const MUTATION_EVIDENCE_TYPE = definitionForType('MutationEvidence');

export interface WriteMutationEvidenceInput {
  readonly paths: ProjectPaths;
  readonly reportsRoot: string;
  readonly storyId: string;
  readonly runId: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly result: BindingCheckCompleted;
  readonly clock: Clock;
}

export interface WrittenMutationEvidence {
  readonly id: string;
  /** Project-relative path the file was written to. */
  readonly path: string;
}

function mutationEvidenceFrontMatter(
  id: string,
  input: WriteMutationEvidenceInput,
): Record<string, unknown> {
  const today = input.clock.now().slice(0, 10);
  return {
    id,
    type: 'MutationEvidence',
    schemaVersion: 1,
    title: `forge test binding — ${input.storyId}`,
    status: 'recorded',
    created: today,
    updated: today,
    revision: 1,
    author: 'engine',
    run: input.runId,
    changelog: [],
    story: input.storyId,
    mutationKind: 'revert-implementation',
    revertedRange: input.result.revertedRange,
    namedTests: input.result.namedTests,
    failedUnderMutation: input.result.failedUnderMutation,
    restoreVerified: input.result.restoreVerified,
    toolVersions: input.toolVersions,
    ranAt: input.result.ranAt,
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
