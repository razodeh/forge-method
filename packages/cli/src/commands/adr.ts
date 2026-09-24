/**
 * `forge adr <new|list|show|supersede|accept|reject>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { ArtifactDocument, readArtifact, writeArtifact } from '@forge/core/artifacts';
import { SYSTEM_CLOCK, ForgeError, type Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { parseKbTree } from '@forge/kb/schema';
import { renderArtifactPath } from '@forge/schemas/registry';

import {
  getSharedIdAllocator,
  readArtifactTemplate,
  summarize,
  type KbEntrySummary,
} from './shared.ts';

export interface AdrCommandContext {
  readonly paths: ProjectPaths;
  readonly kbRoot: string;
  readonly clock?: Clock;
  /** The real FORGE run/step/agent marker (`@forge/core/session-marker`, `PLAN-M14.md` P4/P31) -- read
   * once by `bin.ts`'s own `realEnvSnapshot()` and passed down here, mirroring `GateCommandContext.marker`
   * (`run/gate-commands.ts`). Absent when `FORGE_RUN_ID` itself is unset: a real human's own shell never
   * carries this marker. Consulted by `adrAccept`/`adrReject`/`adrSupersede` only (`refuseUnderMarker`,
   * below): confirming, rejecting or superseding an ADR is a person's own act (`20` §20.5 point 3), so
   * ANY marker at all -- an agent id, or a bare run/step only -- refuses. Unlike a gate's own
   * `resolveApprover`, there is no "the run this command targets" for an ADR command to compare the
   * marker's `runId` against (`forge adr` takes no `--run`), so presence alone is the whole test.
   * `adrNew`/`adrList`/`adrShow` never consult it: creating, listing or reading an ADR is not this
   * rule's concern. */
  readonly marker?: {
    readonly runId: string;
    readonly stepId?: string;
    readonly agentId?: string;
  };
}

/** `adrAccept`/`adrReject`/`adrSupersede`'s own shared refusal (`PLAN-M14.md` P31, `KB-017`) -- called
 * before any read, allocation or write those three functions make, so a marker refusal never leaves a
 * stray, half-made change behind (the identical "check before doing any work" ordering `adrSupersede`'s
 * own doc comment already establishes for its `KB-015` existence check). `command` is the exact `forge
 * adr <command>` word, so the error names what was actually refused. */
function refuseUnderMarker(ctx: AdrCommandContext, command: string, id: string): void {
  if (ctx.marker !== undefined) {
    throw new ForgeError('KB-017', { command, id });
  }
}

async function findAdrPath(ctx: AdrCommandContext, id: string): Promise<string> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const entry = tree.entries.find(
    (candidate) => candidate.kind === 'adr' && candidate.value.id === id,
  );
  if (entry === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  // `KbParsedEntry.path` is relative to `kbRoot` (`parseKbTree`'s own convention), while
  // `readArtifact`/`writeArtifact` resolve relative to the project root — prepending `kbRoot` here
  // is what makes `adrShow`/`transition` actually find the real file `findAdrPath` just located.
  return `${ctx.kbRoot}/${entry.path}`;
}

export async function adrList(ctx: AdrCommandContext): Promise<readonly KbEntrySummary[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  return tree.entries
    .filter((entry) => entry.kind === 'adr')
    .map((entry) => summarize(entry, ctx.kbRoot));
}

export async function adrShow(ctx: AdrCommandContext, id: string): Promise<ArtifactDocument> {
  const path = await findAdrPath(ctx, id);
  return readArtifact(ctx.paths, path);
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'decision'
  );
}

/** `new <title>`: allocates a real, never-reused id (`@forge/core/ids`' own `IdAllocator`, `18`
 * §18.8) and scaffolds the real ADR template (`@forge/templates`' own `templates/artifacts/ADR.md`,
 * the exact same content `forge init` copies into `.forge/templates/ADR.md`) with the real id,
 * title, and today's date filled in — every other field is left as the template's own authorable
 * placeholder text for a human or agent to fill in, not fabricated content. */
export async function adrNew(ctx: AdrCommandContext, title: string): Promise<ArtifactDocument> {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const allocator = getSharedIdAllocator(ctx.paths, clock);
  const id = await allocator.allocate('ADR');
  const slug = slugify(title);

  const pathResult = renderArtifactPath('ADR', { id, slug });
  if (!pathResult.success) {
    throw new ForgeError('CFG-001', { path: 'ADR', line: 0 });
  }
  const relativePath = `${ctx.kbRoot}/${pathResult.path.replace(/^kb\//, '')}`;

  const templateText = await readArtifactTemplate('ADR');
  const today = clock.now().slice(0, 10);
  const doc = ArtifactDocument.parse(templateText, relativePath);
  doc.set(['id'], id);
  doc.set(['title'], title);
  doc.set(['created'], today);
  doc.set(['updated'], today);
  doc.set(['date'], today);

  await writeArtifact(ctx.paths, doc);
  return doc;
}

async function transition(
  ctx: AdrCommandContext,
  id: string,
  clock: Clock,
  mutate: (doc: ArtifactDocument, today: string) => void,
  summary: string,
): Promise<ArtifactDocument> {
  const doc = await adrShow(ctx, id);
  const today = clock.now().slice(0, 10);
  mutate(doc, today);
  doc.bumpRevision('forge adr', summary, today);
  await writeArtifact(ctx.paths, doc);
  return doc;
}

export async function adrAccept(ctx: AdrCommandContext, id: string): Promise<ArtifactDocument> {
  refuseUnderMarker(ctx, 'accept', id);
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  return transition(
    ctx,
    id,
    clock,
    (doc) => {
      doc.set(['status'], 'accepted');
    },
    'Accepted.',
  );
}

export async function adrReject(ctx: AdrCommandContext, id: string): Promise<ArtifactDocument> {
  refuseUnderMarker(ctx, 'reject', id);
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  return transition(
    ctx,
    id,
    clock,
    (doc) => {
      doc.set(['status'], 'rejected');
    },
    'Rejected.',
  );
}

/** `supersede <id>`: marks `id` as superseded by a newly-created ADR (`adrNew`'s own real id
 * allocation, not a caller-supplied one — `18` §18.8's "never reuse" guarantee applies here exactly
 * as it does to a fresh `new`), and cross-links both documents (`superseded_by` on the old one,
 * `supersedes` on the new one), matching `adrSchema`'s own mutual-consistency check.
 *
 * Checks the real FORGE session marker (`PLAN-M14.md` P31, `refuseUnderMarker`), then that `id`
 * resolves to a real ADR, *before* allocating an id or writing anything — a gauntlet critic found the
 * original ordering called `adrNew` (a real, unconditional id allocation and file write) first, so a
 * typo'd `id` still left a stray, unlinked replacement ADR on disk before the `KB-015` for the
 * nonexistent original ever fired; the marker check joins that same ordering, first of all, so a
 * refused call under the marker never even reaches that `KB-015` check, let alone `adrNew`. */
export async function adrSupersede(
  ctx: AdrCommandContext,
  id: string,
  newTitle: string,
): Promise<{ readonly superseded: ArtifactDocument; readonly replacement: ArtifactDocument }> {
  refuseUnderMarker(ctx, 'supersede', id);
  await findAdrPath(ctx, id); // throws KB-015 before anything is allocated or written

  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const replacement = await adrNew({ ...ctx, clock }, newTitle);
  const replacementId = replacement.get(['id']) as string;

  const superseded = await transition(
    ctx,
    id,
    clock,
    (doc) => {
      doc.set(['status'], 'superseded');
      doc.set(['superseded_by'], replacementId);
    },
    `Superseded by ${replacementId}.`,
  );

  // Residual risk, not fully solved: if this second write fails after the `transition` write above
  // already succeeded, the old ADR is left correctly marked `superseded`/`superseded_by`, but the
  // replacement is left without its own `supersedes` back-reference — an asymmetric pair (each still
  // individually schema-valid; `adrSchema`'s own refinement only checks `status`/`superseded_by`
  // consistency on one document, not `supersedes` across two). No two-phase-commit exists anywhere
  // in this codebase to close this fully; a caller that sees this throw should treat both ids as
  // needing a manual check.
  replacement.set(['supersedes'], [id]);
  await writeArtifact(ctx.paths, replacement);

  return { superseded, replacement };
}
