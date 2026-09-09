/**
 * `parseKbTree` — a single parse/validate entry point over the whole `docs/forge/kb/**` tree (`08`
 * §8.2), dispatching each file to the right schema by path: ADR files and `views/*.mmd.yaml` sidecars
 * reuse `@forge/schemas`'s already-built schemas untouched; the four `collection: true` register
 * files use the new wrapper schemas `SPEC-QUESTIONS.md` Q50 added; everything else uses
 * `kbEntrySchema`.
 *
 * Never throws for one bad file — mirrors `@forge/core/ids/scan.ts`'s own "best-effort per file, not
 * best-effort per scan" `IdAllocator.scan()` precedent and `@forge/extensions`' established
 * never-throws-on-boundary-input pattern: a `KbParseError` is collected per failing file instead, so
 * one malformed document never hides every other file's result.
 *
 * @see specs/08 §8.2
 * @see SPEC-QUESTIONS.md Q50
 * @see SPEC-QUESTIONS.md Q51
 * @see PLAN-M3.md P6
 */
import { ArtifactDocument, parseFrontMatterYaml } from '@forge/core/artifacts';
import { listDirEntriesSorted, pathExists, readTextFile, type ProjectPaths } from '@forge/core/fs';
import {
  adrSchema,
  assumptionsFileSchema,
  diagramSchema,
  environmentsFileSchema,
  openQuestionsFileSchema,
  risksFileSchema,
  runbookSchema,
  type ADR,
  type AssumptionsFile,
  type Diagram,
  type EnvironmentsFile,
  type OpenQuestionsFile,
  type RisksFile,
  type Runbook,
} from '@forge/schemas';

import { componentsFileSchema, type ComponentsFile } from './components-file.ts';
import { kbEntrySchema, type KbEntry } from './kb-entry.ts';
import { KB_SECTIONS, type KbSection } from './sections.ts';

/** The default KB root, per `08` §8.2 ("Root: `<project>/docs/forge/kb/` (configurable via
 * `paths.kb`)") — the `kbRoot` parameter is how a caller supplies the configured value instead. */
export const DEFAULT_KB_ROOT = 'docs/forge/kb';

/** Files this piece deliberately does not attempt to parse — see `SPEC-QUESTIONS.md` Q51: `index.md`
 * (both the KB root's and `decisions/`'s own) is "generated," not hand-authored content with a
 * schema to validate against. `README.md` joins it for the identical reason, found only once a real
 * caller (`forge doctor`'s own `kb-lint` check, driven against a real `forge init`-produced project
 * for the first time by `PLAN-M6.md` C9's own `"E1 init"` test) parsed a real, materialized KB tree
 * rather than a hand-built minimal fixture with no README: `forge init`'s own real `writeDocsSkeleton`
 * (`03` §3.3) writes a hand-authored `<kbRoot>/README.md` with no front matter at all into every real
 * project this codebase ever produces, and this function had no way to tell it apart from a real,
 * malformed KB entry — the identical shape of bug `@forge/cli/commands/shared.ts`'s own
 * `listSpecArtifacts` already had for the `<specsRoot>/README.md` case (`SPEC-QUESTIONS.md` Q110). */
const GENERATED_FILE_NAMES = new Set(['index.md', 'README.md']);

export interface KbParseError {
  readonly path: string;
  readonly message: string;
}

export type KbParsedEntry =
  | { readonly path: string; readonly kind: 'adr'; readonly value: ADR; readonly body: string }
  | { readonly path: string; readonly kind: 'diagram'; readonly value: Diagram }
  | {
      readonly path: string;
      readonly kind: 'runbook';
      readonly value: Runbook;
      readonly body: string;
    }
  | { readonly path: string; readonly kind: 'risks-file'; readonly value: RisksFile }
  | { readonly path: string; readonly kind: 'assumptions-file'; readonly value: AssumptionsFile }
  | {
      readonly path: string;
      readonly kind: 'open-questions-file';
      readonly value: OpenQuestionsFile;
    }
  | { readonly path: string; readonly kind: 'environments-file'; readonly value: EnvironmentsFile }
  | { readonly path: string; readonly kind: 'components-file'; readonly value: ComponentsFile }
  | { readonly path: string; readonly kind: 'kb-entry'; readonly value: KbEntry };

export interface KbTree {
  readonly entries: readonly KbParsedEntry[];
  readonly errors: readonly KbParseError[];
}

/** The KB section a file's own relative path implies — its first path segment, or, for a file
 * directly at the KB root, the file itself when it is `glossary.md` (the one root-level file this
 * piece routes to `kbEntrySchema` — see `SPEC-QUESTIONS.md` Q51). `undefined` for a root-level file
 * with no directory-implied section (a collection file, or `index.md`, neither of which reaches this
 * function — see `classifyFile`). */
function directoryImpliedSection(relativePath: string): KbSection | undefined {
  const firstSegment = relativePath.split('/')[0];
  if (firstSegment === 'glossary.md') return 'glossary';
  return KB_SECTIONS.find((section) => section === firstSegment);
}

type FileKind =
  | 'adr'
  | 'diagram-sidecar'
  | 'runbook'
  | 'risks-file'
  | 'assumptions-file'
  | 'open-questions-file'
  | 'environments-file'
  | 'components-file'
  | 'kb-entry'
  | 'skip';

/** Which schema (if any) `relativePath` should be validated against, decided purely from the path —
 * mirrors `08` §8.2's own fixed layout, not file content. `ops/runbooks/RUN-###-*.md` (`08` §8.2:
 * "per-failure runbooks"; `18` §18.7's own `Runbook` row: `pathTemplate: kb/ops/runbooks/{id}-{slug}.md`)
 * routes to the already-built `runbookSchema`, not `kbEntrySchema` — a gauntlet critic found this
 * subtree fell through to the generic case and always failed there, since a Runbook uses the 21-type
 * registry's own `RUN-###`/base-front-matter shape, not a `KB-{SECTION}-####` one. */
function classifyFile(relativePath: string): FileKind {
  const fileName = relativePath.split('/').at(-1) ?? relativePath;
  if (GENERATED_FILE_NAMES.has(fileName)) return 'skip';
  if (relativePath.endsWith('.mmd.yaml')) return 'diagram-sidecar';
  if (!relativePath.endsWith('.md')) return 'skip';
  if (/^decisions\/ADR-\d{4}-.+\.md$/.test(relativePath)) return 'adr';
  if (/^ops\/runbooks\/RUN-\d{3}-.+\.md$/.test(relativePath)) return 'runbook';
  if (relativePath === 'risks.md') return 'risks-file';
  if (relativePath === 'assumptions.md') return 'assumptions-file';
  if (relativePath === 'open-questions.md') return 'open-questions-file';
  if (relativePath === 'delivery/environments.md') return 'environments-file';
  if (relativePath === 'architecture/components.md') return 'components-file';
  return 'kb-entry';
}

async function parseOneFile(
  paths: ProjectPaths,
  kbRoot: string,
  relativePath: string,
  kind: FileKind,
): Promise<KbParsedEntry> {
  const absolute = paths.resolveWithin(`${kbRoot}/${relativePath}`);

  if (kind === 'diagram-sidecar') {
    const raw = await readTextFile(absolute);
    const data = parseFrontMatterYaml(raw, relativePath);
    return { path: relativePath, kind: 'diagram', value: diagramSchema.parse(data) };
  }

  const source = await readTextFile(absolute);
  const doc = ArtifactDocument.parse(source, relativePath);
  const frontMatter = doc.frontMatter;

  switch (kind) {
    case 'adr':
      // `body` carries the ADR's real Context/Decision/Consequences prose — a P9 gauntlet round
      // found `adrSchema` itself has no body field at all (front matter only), so a declared-input
      // ADR had no way to surface its own substantive content into a context pack without this.
      return {
        path: relativePath,
        kind: 'adr',
        value: adrSchema.parse(frontMatter),
        body: doc.body,
      };
    case 'runbook':
      return {
        path: relativePath,
        kind: 'runbook',
        value: runbookSchema.parse(frontMatter),
        body: doc.body,
      };
    case 'risks-file':
      return { path: relativePath, kind: 'risks-file', value: risksFileSchema.parse(frontMatter) };
    case 'assumptions-file':
      return {
        path: relativePath,
        kind: 'assumptions-file',
        value: assumptionsFileSchema.parse(frontMatter),
      };
    case 'open-questions-file':
      return {
        path: relativePath,
        kind: 'open-questions-file',
        value: openQuestionsFileSchema.parse(frontMatter),
      };
    case 'environments-file':
      return {
        path: relativePath,
        kind: 'environments-file',
        value: environmentsFileSchema.parse(frontMatter),
      };
    case 'components-file':
      return {
        path: relativePath,
        kind: 'components-file',
        value: componentsFileSchema.parse(frontMatter),
      };
    case 'kb-entry': {
      // Cast, not a runtime check: `ArtifactDocument.frontMatter`'s getter (`parseFrontMatterYaml`)
      // never returns anything but a non-null, non-array object — it throws `CFG-007` instead, which
      // the caller of `parseOneFile` already catches. `kbEntrySchema.parse` itself still validates
      // every field's real shape; this cast only makes the object spreadable.
      const entry = kbEntrySchema.parse({
        ...(frontMatter as Record<string, unknown>),
        body: doc.body,
      });
      const expectedSection = directoryImpliedSection(relativePath);
      if (expectedSection !== undefined && entry.section !== expectedSection) {
        throw new Error(
          `section ${JSON.stringify(entry.section)} does not match this file's own directory (expected ${JSON.stringify(expectedSection)}).`,
        );
      }
      return { path: relativePath, kind: 'kb-entry', value: entry };
    }
    case 'skip':
      // Unreachable: `parseKbTree`'s own walk never calls this function for `skip` — narrowed here
      // only so the switch is exhaustive over the remaining `FileKind` members without a `default`
      // swallowing a genuinely new, unhandled kind.
      throw new Error(`parseOneFile called with an unexpected kind: ${kind}`);
  }
}

/** Every file under `kbRoot`, relative to it, sorted — depth-first, byte-order, mirroring
 * `@forge/core/ids/scan.ts`'s own `listArtifactFiles` walk. Exported for `@forge/kb/write`'s
 * `KbIdAllocator`, which needs the same file set for its own, lighter-weight id scan (P7). */
export async function listKbFiles(
  paths: ProjectPaths,
  kbRoot: string,
  relativeDir = '',
): Promise<string[]> {
  const entries = await listDirEntriesSorted(paths.resolveWithin(`${kbRoot}/${relativeDir}`));
  const files: string[] = [];
  for (const entry of entries) {
    const relativeChild = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...(await listKbFiles(paths, kbRoot, relativeChild)));
    } else {
      files.push(relativeChild);
    }
  }
  return files;
}

/**
 * Parses and validates every file under `<paths root>/<kbRoot>` (default `docs/forge/kb`), dispatched
 * to the right schema by path. Never throws: a file this function cannot parse or validate is
 * recorded in `errors` (naming its own relative path), while every other file's result is still
 * returned in `entries`.
 */
export async function parseKbTree(
  paths: ProjectPaths,
  kbRoot: string = DEFAULT_KB_ROOT,
): Promise<KbTree> {
  // A brand-new project with no KB written yet is the ordinary starting state, not a failure — a
  // gauntlet critic found this function threw `RUN-034` instead of honouring its own "never throws"
  // contract when `kbRoot` did not exist at all.
  if (!(await pathExists(paths.resolveWithin(kbRoot)))) {
    return { entries: [], errors: [] };
  }

  // `pathExists` alone doesn't distinguish a directory from a stray file at the same path — a verify
  // pass found that exact case (a plain file sitting where `kbRoot` should be a directory) still threw
  // `RUN-034` (`ENOTDIR`) out of `listKbFiles`'s own `listDirEntriesSorted` call. Any failure walking
  // the tree, not only that one, is now reported as a single tree-level `KbParseError` instead.
  let relativeFiles: readonly string[];
  try {
    relativeFiles = await listKbFiles(paths, kbRoot);
  } catch (error) {
    return {
      entries: [],
      errors: [{ path: kbRoot, message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const entries: KbParsedEntry[] = [];
  const errors: KbParseError[] = [];

  for (const relativePath of relativeFiles) {
    const kind = classifyFile(relativePath);
    if (kind === 'skip') continue;

    try {
      entries.push(await parseOneFile(paths, kbRoot, relativePath, kind));
    } catch (error) {
      errors.push({
        path: relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { entries, errors };
}
