/**
 * What a Story document says a run of a story-level workflow needs (`09` §9.3): who implements it, the paths it
 * claims (`files_expected`, of which `testPaths` are the tests by the rule the stage run plan uses), and whether it
 * is in a state that can be implemented at all. The one place `forge implement` and `forge run <workflow> --story`
 * read a Story from, so the two cannot disagree (`PLAN-M13.md` P21).
 *
 * @see specs/09 §9.3
 */
import { ForgeError } from '@forge/core/errors';
import { isTestPath } from '@forge/engine/dispatch';

import { listSpecArtifacts } from '../shared.ts';
import type { RunDeps } from './run.ts';

export interface StoryRunInputs {
  readonly ownerRole: string;
  readonly filesExpected: readonly string[];
  readonly testPaths: readonly string[];
  /** `status` as written (`undefined` when it is not a string). */
  readonly status: string | undefined;
  readonly blockedBy: readonly string[];
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? (value as readonly unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** @throws {ForgeError} `SPEC-024` (no such Story), `SPEC-025` (no `owner_role`). */
export async function readStoryRunInputs(
  deps: RunDeps,
  specsRoot: string,
  storyId: string,
): Promise<StoryRunInputs> {
  const docs = await listSpecArtifacts(deps.paths, specsRoot);
  const story = docs.find((doc) => {
    const frontMatter = doc.frontMatter as { readonly id?: unknown; readonly type?: unknown };
    return frontMatter.id === storyId && frontMatter.type === 'Story';
  });
  if (story === undefined) throw new ForgeError('SPEC-024', { id: storyId });
  const frontMatter = story.frontMatter as {
    readonly owner_role?: unknown;
    readonly files_expected?: unknown;
    readonly status?: unknown;
    readonly blocked_by?: unknown;
  };
  const ownerRole = frontMatter.owner_role;
  if (typeof ownerRole !== 'string' || ownerRole.length === 0) {
    throw new ForgeError('SPEC-025', { id: storyId });
  }
  const filesExpected = strings(frontMatter.files_expected);
  return {
    ownerRole,
    filesExpected,
    testPaths: filesExpected.filter(isTestPath),
    status: typeof frontMatter.status === 'string' ? frontMatter.status : undefined,
    blockedBy: strings(frontMatter.blocked_by),
  };
}
