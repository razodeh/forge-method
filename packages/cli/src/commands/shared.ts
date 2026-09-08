/**
 * Shared helpers for `@forge/cli/commands` — `03` §3.2.1/§3.2.2's lifecycle and discovery commands.
 * Every command in this module is a thin wrapper over an already-built package function (`02` §2.2's
 * own `cli ← everything` framing): this file exists so that wrapping is written once, not once per
 * command.
 *
 * @see specs/03 §3.2.1
 * @see specs/03 §3.2.2
 */
import { type ArtifactDocument, readArtifact } from '@forge/core/artifacts';
import { IdAllocator, SYSTEM_CLOCK, type Clock } from '@forge/core';
import { listDirEntriesSorted, pathExists, readTextFile, ProjectPaths } from '@forge/core/fs';
import type { KbParsedEntry } from '@forge/kb/schema';
import { TEMPLATE_INDEX, type TemplateArtifactTypeId } from '@forge/templates';

import { resolvePackageRoot } from '../init/package-root.ts';

const templatesPaths = new ProjectPaths(resolvePackageRoot('@forge/templates'));

/**
 * One `IdAllocator` per real project root, reused across every `adrNew`/`specNew` call against it —
 * `IdAllocator`'s own "never reuse an id" guarantee (`18` §18.8) is enforced by a per-*instance*
 * FIFO queue (`packages/core/src/ids/allocator.ts`), which does nothing to serialize two separate
 * instances racing each other. A gauntlet critic demonstrated this directly:
 * `Promise.all([adrNew(...), adrNew(...)])` against the same project, each constructing its own
 * fresh `IdAllocator`, allocated the identical id to both. Keyed by the project root's own resolved
 * absolute path (the one stable identity two `ProjectPaths` instances over the same real directory
 * both agree on) rather than by the `ProjectPaths` object's own identity, which a caller could
 * construct fresh per call.
 */
const idAllocatorsByRoot = new Map<string, IdAllocator>();

export function getSharedIdAllocator(paths: ProjectPaths, clock: Clock = SYSTEM_CLOCK): IdAllocator {
  const root = paths.resolveWithin('.');
  let allocator = idAllocatorsByRoot.get(root);
  if (allocator === undefined) {
    allocator = new IdAllocator({ paths, clock });
    idAllocatorsByRoot.set(root, allocator);
  }
  return allocator;
}

/** Every artifact file under `<paths root>/<specsRoot>` — `03` §3.2.2's `forge spec <sub>` family's
 * own real content: `docs/forge/specs/**`'s real Vision/Capability/NFR/Epic/Story/Task/
 * InterfaceContract/DataModel documents. A plain recursive directory walk, not `renderArtifactPath`
 * reversed — every real path template under `specs/` nests by a real hierarchy this function does
 * not need to know, it only needs every file that is there. */
export async function listSpecArtifacts(
  paths: ProjectPaths,
  specsRoot: string,
): Promise<readonly ArtifactDocument[]> {
  if (!(await pathExists(paths.resolveWithin(specsRoot)))) return [];
  const relPaths = await walkFiles(paths, specsRoot, '');
  const docs: ArtifactDocument[] = [];
  for (const relPath of relPaths) {
    docs.push(await readArtifact(paths, relPath));
  }
  return docs;
}

async function walkFiles(
  paths: ProjectPaths,
  root: string,
  relativeDir: string,
): Promise<readonly string[]> {
  const dirRelPath = relativeDir === '' ? root : `${root}/${relativeDir}`;
  const entries = await listDirEntriesSorted(paths.resolveWithin(dirRelPath));
  const files: string[] = [];
  for (const entry of entries) {
    const childRel = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...(await walkFiles(paths, root, childRel)));
    } else {
      files.push(`${root}/${childRel}`);
    }
  }
  return files;
}

/** Reads the real, shipped artifact template for `type` (`@forge/templates`' own
 * `templates/artifacts/<Type>.md` — the identical content `forge init` copies into
 * `.forge/templates/`), for `adr new`/`spec new` to scaffold from. */
export async function readArtifactTemplate(type: TemplateArtifactTypeId): Promise<string> {
  return readTextFile(templatesPaths.resolveWithin(TEMPLATE_INDEX[type]));
}

/** The id/title/kind every `KbParsedEntry` variant carries, read uniformly regardless of which of
 * `parseKbTree`'s nine kinds a given file parsed as. Every one of the nine schemas extends
 * `baseFrontMatterShape` (`id`/`title`) except `kb-entry` (its own `id`/`title` fields, same names,
 * different id pattern) and the four `collection: true` register files (`risks-file`/
 * `assumptions-file`/`open-questions-file`/`environments-file`), which have no single id/title of
 * their own — a whole file of many items, not one item — so those four report a synthetic id (their
 * own path) rather than a fabricated title.
 */
export interface KbEntrySummary {
  readonly id: string;
  readonly title: string;
  readonly kind: KbParsedEntry['kind'];
  readonly path: string;
}

/**
 * `kbRoot` is prepended to every returned `path`: `KbParsedEntry.path` is relative to `kbRoot`
 * (`parseKbTree`'s own convention), but a path a human reads (`kb open`'s own real output) or a path
 * `readArtifact`/`writeArtifact` resolves (project-root-relative) both need the full, real,
 * unambiguous location — a bare `kbRoot`-relative path silently assumes the reader already knows to
 * prepend `docs/forge/kb/` themselves.
 */
export function summarize(entry: KbParsedEntry, kbRoot: string): KbEntrySummary {
  const path = `${kbRoot}/${entry.path}`;
  switch (entry.kind) {
    case 'adr':
    case 'diagram':
    case 'runbook':
      return { id: entry.value.id, title: entry.value.title, kind: entry.kind, path };
    case 'kb-entry':
      return { id: entry.value.id, title: entry.value.title, kind: entry.kind, path };
    case 'components-file':
      return { id: path, title: 'Components', kind: entry.kind, path };
    case 'risks-file':
      return { id: path, title: 'Risks', kind: entry.kind, path };
    case 'assumptions-file':
      return { id: path, title: 'Assumptions', kind: entry.kind, path };
    case 'open-questions-file':
      return { id: path, title: 'Open Questions', kind: entry.kind, path };
    case 'environments-file':
      return { id: path, title: 'Environments', kind: entry.kind, path };
  }
}
