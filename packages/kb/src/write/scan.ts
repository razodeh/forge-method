/**
 * `countKbIdsFromFiles` — the expensive phase of `KbIdAllocator`'s scan: the highest claimed numeric
 * id per `KbSection`, found by reading real files.
 *
 * Deliberately does *not* reuse `parseKbTree`'s full-validation results: `parseKbTree` puts a document
 * that fails `kbEntrySchema` validation (for any reason, including a field with nothing to do with its
 * `id`) into `errors`, not `entries` — reusing that here would silently free an id that is really
 * still claimed, exactly the mistake `@forge/core/ids/scan.ts`'s own `countIdsFromFiles` doc comment
 * warns against for the 21-type registry's own allocator. This reads each file's raw front matter
 * directly instead, the same "a schema-invalid document's id still counts as claimed" rule.
 *
 * @see specs/08 §8.6
 * @see PLAN-M3.md P7
 */
import { ArtifactDocument } from '@forge/core/artifacts';
import { pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';

import { listKbFiles } from '../schema/tree.ts';
import { sectionForIdToken, type KbSection } from '../schema/sections.ts';

const KB_ID_PATTERN = /^KB-([A-Z]+)-(\d{4})(-\d+)?$/;

/** The `(section, numeric)` a raw `id` string claims, or `undefined` if it is not a `KB-*` id at all,
 * or names a token no registered section uses. */
function claimedByKbId(id: string): { readonly section: KbSection; readonly numeric: number } | undefined {
  const match = KB_ID_PATTERN.exec(id);
  const token = match?.[1];
  const digits = match?.[2];
  if (token === undefined || digits === undefined) return undefined;
  const section = sectionForIdToken(token);
  if (section === undefined) return undefined;
  return { section, numeric: Number(digits) };
}

/** Every `.md` file under `kbRoot`, relative to it, sorted — the same file set `parseKbTree` walks,
 * reused directly rather than re-derived. `[]` (not a throw) if `kbRoot` does not exist yet — a
 * project with no KB written at all is the ordinary starting state, the same case `parseKbTree` (P6)
 * was itself fixed to handle gracefully after a gauntlet round found it threw instead. */
export async function listKbMdFiles(paths: ProjectPaths, kbRoot: string): Promise<readonly string[]> {
  if (!(await pathExists(paths.resolveWithin(kbRoot)))) return [];
  const files = await listKbFiles(paths, kbRoot);
  return files.filter((file) => file.endsWith('.md'));
}

/** The highest claimed numeric id per `KbSection`, found by reading `files`. Best-effort per file: a
 * file that is not a `KbEntry`-shaped document at all, or fails to parse, is skipped, not fatal. */
export async function countKbIdsFromFiles(
  paths: ProjectPaths,
  kbRoot: string,
  files: readonly string[],
): Promise<Partial<Record<KbSection, number>>> {
  const counters: Partial<Record<KbSection, number>> = {};

  for (const relativeFile of files) {
    let frontMatter: Record<string, unknown>;
    try {
      const source = await readTextFile(paths.resolveWithin(`${kbRoot}/${relativeFile}`));
      // Cast, not a runtime check: `ArtifactDocument.frontMatter`'s getter never returns anything but
      // a non-null object — it throws instead, which the catch below already handles.
      const doc = ArtifactDocument.parse(source, relativeFile);
      frontMatter = doc.frontMatter as Record<string, unknown>;
    } catch {
      continue;
    }

    const id = frontMatter['id'];
    if (typeof id !== 'string') continue;

    const claim = claimedByKbId(id);
    if (claim === undefined) continue;

    counters[claim.section] = Math.max(counters[claim.section] ?? 0, claim.numeric);
  }

  return counters;
}
