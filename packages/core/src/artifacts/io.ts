/**
 * `readArtifact`, `writeArtifact` — `ArtifactDocument` through `@forge/core/fs`'s contained,
 * atomic operations.
 *
 * @see specs/02 §2.5
 * @see PLAN-M1.md P12
 */
import { readTextFile } from '../fs/operations.ts';
import { writeFileAtomic } from '../fs/atomic.ts';
import type { ProjectPaths } from '../fs/paths.ts';
import { ArtifactDocument } from './document.ts';

/** Reads and parses the artifact at `relative` (a path within `paths`'s project or lane worktree). */
export async function readArtifact(
  paths: ProjectPaths,
  relative: string,
): Promise<ArtifactDocument> {
  const absolute = paths.resolveWithin(relative);
  const source = await readTextFile(absolute);
  return ArtifactDocument.parse(source, relative);
}

/** Writes `doc` back to the path it was parsed from (`doc.path`), atomically. */
export async function writeArtifact(paths: ProjectPaths, doc: ArtifactDocument): Promise<void> {
  const absolute = paths.resolveWithin(doc.path);
  await writeFileAtomic(absolute, doc.toString());
}
