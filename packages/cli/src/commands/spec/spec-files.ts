/**
 * Small readers shared by the `PLAN-M13.md` P26 gate checks that walk the specs root themselves
 * (`./interfaces.ts`, `./ops-rules.ts`, `./integration-rules.ts`).
 *
 * They exist because `listSpecArtifacts` (`../shared.ts`) throws on the first file it cannot parse, and a plain YAML
 * interface contract that begins with a `---` line and has no closing one (a form the `freeze-contracts` brief
 * produces and the engine's output check accepts) is exactly such a file. A gate check must report what it could
 * not read and carry on with the rest, never stop reading, and never pass over it.
 *
 * @see PLAN-M13.md P26
 */
import { ArtifactDocument } from '@forge/core/artifacts';
import { isForgeError } from '@forge/core/errors';
import { listDirEntriesSorted, pathExists, readTextFile } from '@forge/core/fs';

import type { GateViolation } from '../gate-check-output.ts';
import type { SpecCommandContext } from '../spec.ts';

/** A directory this large is a runaway tree, not a specs root: stop walking and say so. */
export const MAX_FILES = 5000;

/** Text echoed into a message: one line, bounded (a document can hold megabytes). */
export function oneLine(value: unknown, limit = 120): string {
  // `JSON.stringify(undefined)` is `undefined` at runtime although typed `string`.
  const stringify = JSON.stringify as (input: unknown) => string | undefined;
  const raw = typeof value === 'string' ? value : (stringify(value) ?? 'undefined');
  const line = raw.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit)}...` : line;
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface WalkResult {
  readonly files: readonly string[];
  readonly capped: boolean;
}

/** Every file under `root` (project-relative), depth first in byte order, skipping the top-level directory named
 * `skip`. Bounded by `MAX_FILES`. A missing `root` is an empty walk. */
export async function walkFiles(
  ctx: Pick<SpecCommandContext, 'paths'>,
  root: string,
  skip?: string,
  relative = '',
  found: string[] = [],
): Promise<WalkResult> {
  if (relative === '' && !(await pathExists(ctx.paths.resolveWithin(root)))) {
    return { files: [], capped: false };
  }
  const dir = relative === '' ? root : `${root}/${relative}`;
  for (const entry of await listDirEntriesSorted(ctx.paths.resolveWithin(dir))) {
    if (found.length >= MAX_FILES) return { files: found, capped: true };
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory) {
      if (relative === '' && entry.name === skip) continue;
      const inner = await walkFiles(ctx, root, skip, child, found);
      if (inner.capped) return inner;
    } else {
      found.push(`${root}/${child}`);
    }
  }
  return { files: found, capped: false };
}

export interface SpecDocuments {
  readonly docs: readonly ArtifactDocument[];
  /** One violation per file that could not be read, plus one when the walk hit its bound. */
  readonly unreadable: readonly GateViolation[];
}

/** Every Markdown spec document under `root` (skipping the top-level `skip` directory), read raw. A file with no
 * front matter at all (a README) is not a spec document and is left out; any other failure to read one is reported
 * as unreadable, because it may hold exactly what the rule is looking for. */
export async function readSpecDocuments(
  ctx: Pick<SpecCommandContext, 'paths'>,
  root: string,
  what: string,
  skip?: string,
  /** Paths where a file with no front matter is NOT a README to skip but a spec document that cannot be read (a story
   * missing its front matter may still say what it consumes). */
  requireFrontMatter?: (path: string) => boolean,
): Promise<SpecDocuments> {
  const listing = await walkFiles(ctx, root, skip);
  const docs: ArtifactDocument[] = [];
  const unreadable: GateViolation[] = [];
  if (listing.capped) {
    unreadable.push({
      subject: root,
      message: `More than ${String(MAX_FILES)} files under ${root}: ${what} cannot be read in full.`,
      remedy: `Move what is not a spec document out of ${root}, then run the check again.`,
    });
  }
  for (const path of listing.files) {
    if (!path.endsWith('.md')) continue;
    try {
      docs.push(ArtifactDocument.parse(await readTextFile(ctx.paths.resolveWithin(path)), path));
    } catch (cause) {
      if (isForgeError(cause) && cause.code === 'CFG-005' && requireFrontMatter?.(path) !== true) {
        continue;
      }
      unreadable.push({
        subject: path,
        message: `${path} could not be read (${oneLine(errorMessage(cause))}), so ${what} cannot be checked.`,
        remedy: `Repair the front matter of ${path}, then run the check again.`,
      });
    }
  }
  return { docs, unreadable };
}
