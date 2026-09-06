/**
 * `listArtifactFiles`, `countIdsFromFiles`, `scanProject` — `18` §18.8's "truth is a scan of existing
 * artifacts," split into a cheap phase (which files exist) and an expensive one (what ids they
 * claim), so `IdAllocator` can skip the expensive phase entirely when the cheap one proves nothing
 * has changed since the last real scan.
 *
 * Best-effort per file, not best-effort per scan: a file that is not an artifact document at all (a
 * README, a spec page under `specs/`) or one that fails to parse is skipped, not fatal — a scan that
 * aborted on the first non-artifact Markdown file in the repository would never finish. A file whose
 * `id`/`type` are well-formed but otherwise wrong (schema violations elsewhere) still counts here:
 * "never reused" only needs to know the id was claimed, not that the rest of the document is valid,
 * and treating a schema-invalid document as if its id were free would be the one mistake this
 * function exists to prevent. See `SPEC-QUESTIONS.md` Q29 for why this does not also parse a
 * `collection: true` type's shared register file for more than one entry.
 *
 * @see specs/18 §18.8
 * @see specs/09 §9.2
 * @see PLAN-M1.md P13
 */
import type { ArtifactTypeId } from '@forge/schemas';

import { ArtifactDocument } from '../artifacts/document.ts';
import { listDirEntriesSorted, readTextFile } from '../fs/operations.ts';
import type { ProjectPaths } from '../fs/paths.ts';
import { DEFAULT_ID_REGISTRY, type IdRegistry } from './registry.ts';

/**
 * Directories a scan never descends into. `.git` and `node_modules` own their own content; `.forge`
 * is FORGE's own working state (including the very cache this module's callers maintain), never a
 * place an artifact document lives. Compared case-insensitively — `specs/02` §2.7 makes Windows and
 * macOS's default filesystem both first-class, and both are case-insensitive.
 */
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.forge', 'node_modules']);

/** The cheap phase: every `.md` file in the project, sorted, without reading any of them. */
export async function listArtifactFiles(paths: ProjectPaths, relativeDir = '.'): Promise<string[]> {
  const entries = await listDirEntriesSorted(paths.resolveWithin(relativeDir));
  const files: string[] = [];
  for (const entry of entries) {
    const relativeChild = relativeDir === '.' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
      files.push(...(await listArtifactFiles(paths, relativeChild)));
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      files.push(relativeChild);
    }
  }
  return files;
}

function isRegisteredType(value: unknown, registry: IdRegistry): value is ArtifactTypeId {
  return typeof value === 'string' && Object.hasOwn(registry, value);
}

/** The numeric part of `id` — the digits right after `<idPrefix>-`, ignoring a `-<suffix>` sub-id. */
function numericIdPart(id: string, type: ArtifactTypeId, registry: IdRegistry): number | undefined {
  const entry = registry[type];
  const pattern = new RegExp(`^${entry.idPrefix}-(\\d{${String(entry.idWidth)}})(-\\d+)?$`);
  const match = pattern.exec(id);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The expensive phase: the highest claimed numeric id per type, found by reading `files`. */
export async function countIdsFromFiles(
  paths: ProjectPaths,
  files: readonly string[],
  registry: IdRegistry = DEFAULT_ID_REGISTRY,
): Promise<Partial<Record<ArtifactTypeId, number>>> {
  const counters: Partial<Record<ArtifactTypeId, number>> = {};

  for (const relativeFile of files) {
    let frontMatter: Record<string, unknown>;
    try {
      const source = await readTextFile(paths.resolveWithin(relativeFile));
      // Cast, not a runtime check: `ArtifactDocument.frontMatter`'s getter (`parseFrontMatterYaml`)
      // never returns anything but a non-null object — it throws `CFG-007` instead, which the catch
      // below already handles. If this line completes without throwing, the result is exactly this.
      const doc = ArtifactDocument.parse(source, relativeFile);
      frontMatter = doc.frontMatter as Record<string, unknown>;
    } catch {
      continue;
    }

    const type: unknown = frontMatter['type'];
    const id: unknown = frontMatter['id'];
    if (!isRegisteredType(type, registry) || typeof id !== 'string') continue;

    const numeric = numericIdPart(id, type, registry);
    if (numeric === undefined) continue;

    counters[type] = Math.max(counters[type] ?? 0, numeric);
  }

  return counters;
}

export interface ScanResult {
  /** The highest claimed numeric id per type found by this scan. Absent key: none found. */
  readonly counters: Readonly<Partial<Record<ArtifactTypeId, number>>>;
  /** Every `.md` file this scan looked at, sorted — the file set an `IdIndex`'s hash is built from. */
  readonly scannedFiles: readonly string[];
}

/** Both phases, unconditionally — the full, real scan `18` §18.8 calls "truth". */
export async function scanProject(
  paths: ProjectPaths,
  registry: IdRegistry = DEFAULT_ID_REGISTRY,
): Promise<ScanResult> {
  const scannedFiles = await listArtifactFiles(paths);
  const counters = await countIdsFromFiles(paths, scannedFiles, registry);
  return { counters, scannedFiles };
}
