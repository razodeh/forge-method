/**
 * The tombstone: `docs/forge/reports/pruned/<id>.json`, created atomically, before the record it
 * marks is ever removed.
 *
 * `18` §18.7 (Retention): "Pruning a record is two steps in a fixed order. A tombstone for its id
 * (`docs/forge/reports/pruned/<id>.json`: the id, the type, the subject, the record's sha256 and the
 * time) is created first, atomically (written whole to a temporary file beside it and renamed into
 * place, so one that exists is never partial); the record is removed second." `process/
 * SPEC-QUESTIONS.md` Q294 Decision 9 identifies the real primitive that gives this (and the identical
 * exclusive-create cross-process safety `18` §18.8's own id allocation rests on): `@forge/core/fs`'s
 * `writeNewFileAtomic` — `fsp.link`, not `rename`, so an existing target is `RUN-114`, never an
 * overwrite, and a file that exists on disk is never partial either way. "Renamed into place" in the
 * spec's own prose is the simpler description of the identical never-partial guarantee; this module
 * does not literally rename, and does not need to.
 *
 * Two SEPARATE real processes racing to tombstone the identical id are exactly two processes racing
 * `writeNewFileAtomic`'s own `link()` the identical way two `IdAllocator` callers racing to write the
 * SAME freshly-allocated id already do (`process/SPEC-QUESTIONS.md` Q294 Decision 9: "one `link()`
 * wins and the other gets a real `RUN-114` refusal... a concurrent prune that meets `RUN-114` on a
 * tombstone has met 'already tombstoned' and is not an error") — `writeTombstone` below is this
 * piece's own code that treats that refusal as success, built and proven with a real multi-process
 * test (this piece's own report names the real concurrency level tested).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */
import { isForgeError, type Clock } from '@forge/core';
import { pathExists, readTextFile, writeNewFileAtomic, type ProjectPaths } from '@forge/core/fs';

import type { EvidenceRecordInfo } from './types.ts';

/** One tombstone's own real content (`18` §18.7's own exhaustive field list: "the id, the type, the
 * subject, the record's sha256 and the time"). A plain, versionless JSON object — unlike a registered
 * artifact, a tombstone is never read back by `@forge/core/ids`'s own scan (it is not a `.md` file at
 * all, so `listArtifactFiles` never lists it, the identical reason a parity capture is never seen by
 * that scan either), so it carries no front matter and needs no schema migration path of its own. */
export interface TombstoneContent {
  readonly id: string;
  readonly type: EvidenceRecordInfo['type'];
  readonly subject: string;
  readonly recordSha256: string;
  readonly prunedAt: string;
}

/** Project-relative path to `id`'s own tombstone, under `reportsRoot` (the project's real, configured
 * `paths.reports`, defaulting to `"docs/forge/reports"` — `resolveReportsRoot`, `prune-command.ts`). */
export function tombstoneRelPath(reportsRoot: string, id: string): string {
  return `${reportsRoot}/pruned/${id}.json`;
}

/**
 * Creates `record`'s own tombstone, atomically, idempotently across any number of real concurrent
 * processes.
 *
 * Returns normally both when THIS call created the tombstone and when another process (or an earlier,
 * interrupted run of this very one) already had — `RUN-114` from `writeNewFileAtomic` is caught and
 * swallowed here, specifically, for that one reason (`18` §18.7's own "a repeated or concurrent prune
 * is idempotent"); any OTHER failure `writeNewFileAtomic` can raise (`RUN-034`, a real I/O error)
 * still propagates, since that genuinely is not "someone else already finished this".
 */
export async function writeTombstone(
  paths: ProjectPaths,
  reportsRoot: string,
  record: EvidenceRecordInfo,
  clock: Clock,
): Promise<void> {
  const content: TombstoneContent = {
    id: record.id,
    type: record.type,
    subject: record.subject,
    recordSha256: record.sha256,
    prunedAt: clock.now(),
  };
  const target = paths.resolveWithin(tombstoneRelPath(reportsRoot, record.id));
  try {
    await writeNewFileAtomic(target, `${JSON.stringify(content, null, 2)}\n`);
  } catch (error) {
    if (isForgeError(error) && error.code === 'RUN-114') return;
    throw error;
  }
}

/** Whether `id` has a tombstone on disk — the one fact `gate-commands.ts`'s own "pruned, not dangling"
 * check needs (`RUN-146`): by the time that check runs, the record itself has already been confirmed
 * absent (`resolveGateEvidence`'s own scan found nothing), so "a tombstone exists" and "this id was
 * pruned, not merely never written" are, at that point, the same fact. */
export async function hasTombstone(
  paths: ProjectPaths,
  reportsRoot: string,
  id: string,
): Promise<boolean> {
  return pathExists(paths.resolveWithin(tombstoneRelPath(reportsRoot, id)));
}

/**
 * Reads `id`'s own tombstone back, or `undefined` if it is absent OR unparseable.
 *
 * "Unparseable reads as absent" is not expected to be reachable in practice — `writeNewFileAtomic`'s
 * own `link()`-based publish means a file at this path is either the complete, valid JSON this module
 * wrote or does not exist at all, never a partial write (this module's own file header) — but this
 * function still treats a parse failure the identical, conservative way rather than throwing, so a
 * caller never has to special-case "exists but is garbage" differently from "does not exist" for a
 * file this module alone ever creates.
 */
export async function readTombstone(
  paths: ProjectPaths,
  reportsRoot: string,
  id: string,
): Promise<TombstoneContent | undefined> {
  const target = paths.resolveWithin(tombstoneRelPath(reportsRoot, id));
  if (!(await pathExists(target))) return undefined;
  try {
    return JSON.parse(await readTextFile(target)) as TombstoneContent;
  } catch {
    return undefined;
  }
}
