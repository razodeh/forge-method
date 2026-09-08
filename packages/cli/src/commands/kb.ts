/**
 * `forge kb <list|show|search|lint|diff|sync|open|graph>` — `03` §3.2.2.
 *
 * @see specs/03 §3.2.2
 */
import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import {
  lintKb,
  openKbIndex,
  parseKbTree,
  rebuildIndex,
  type KbFinding,
  type KbTree,
  type LintKbSpecArtifacts,
} from '@forge/kb';
import type { Capability, Epic } from '@forge/schemas';
import type { ProjectLevel } from '@forge/methods/level';
import { SYSTEM_CLOCK } from '@forge/core';

import { listSpecArtifacts, summarize, type KbEntrySummary } from './shared.ts';

export interface KbCommandContext {
  readonly paths: ProjectPaths;
  readonly kbRoot: string;
  readonly specsRoot: string;
  readonly level: ProjectLevel;
  /** Injected, not read from the real clock — `kb lint`'s own staleness check (`08` §8.7) needs
   * "now," and this project's own determinism discipline (`QUALITY-BAR.md` R10) forbids reading it
   * ambiently. Defaults to the real time for real callers. */
  readonly now?: Date;
}

async function loadLintSpecArtifacts(ctx: KbCommandContext): Promise<LintKbSpecArtifacts> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const capabilities: Capability[] = [];
  const epics: Epic[] = [];
  for (const doc of docs) {
    const frontMatter = doc.frontMatter as { readonly type?: unknown };
    if (frontMatter.type === 'Capability') capabilities.push(frontMatter as Capability);
    else if (frontMatter.type === 'Epic') epics.push(frontMatter as Epic);
  }
  return { capabilities, epics };
}

export async function kbList(ctx: KbCommandContext): Promise<readonly KbEntrySummary[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  return tree.entries.map((entry) => summarize(entry, ctx.kbRoot));
}

export async function kbShow(ctx: KbCommandContext, id: string): Promise<KbEntrySummary> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const found = tree.entries.map((entry) => summarize(entry, ctx.kbRoot)).find((entry) => entry.id === id);
  if (found === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  return found;
}

/** `open <id>`: resolves and prints the real file path — no TUI/`$EDITOR` launch this milestone
 * (`22`'s own "Do not build" line), so "open" means "tell you exactly where it is," the honest
 * non-interactive equivalent. */
export async function kbOpen(ctx: KbCommandContext, id: string): Promise<{ readonly path: string }> {
  const entry = await kbShow(ctx, id);
  return { path: entry.path };
}

export interface KbSearchHit {
  readonly id: string;
  readonly title: string;
  readonly score: number;
}

/**
 * `search <q>`: real term-overlap search against the on-disk index (`@forge/kb/db`'s own
 * `KbIndexBackend.search`). The index reflects whatever `kb sync` last wrote — this does not
 * implicitly rebuild it first, so a search against a project that has never run `sync` (or has
 * changed since) returns whatever the last real sync produced, not a silently-stale-but-hidden
 * result; `kb sync`'s own job is keeping it current.
 */
export async function kbSearch(ctx: KbCommandContext, query: string): Promise<readonly KbSearchHit[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const summaries = new Map(tree.entries.map((entry) => summarize(entry, ctx.kbRoot)).map((entry) => [entry.id, entry]));
  const backend = openKbIndex(ctx.paths);
  try {
    return backend
      .search(query)
      .map((hit) => {
        const summary = summaries.get(hit.id);
        return summary === undefined
          ? undefined
          : { id: hit.id, title: summary.title, score: hit.score };
      })
      .filter((hit): hit is KbSearchHit => hit !== undefined);
  } finally {
    backend.close();
  }
}

/** `sync`: rebuilds the on-disk index from the real, current KB tree — `@forge/kb/db`'s own
 * `rebuildIndex`, the exact function `kb search`'s own doc comment says this is responsible for
 * keeping current. */
export async function kbSync(ctx: KbCommandContext): Promise<{ readonly entryCount: number }> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const backend = openKbIndex(ctx.paths);
  try {
    rebuildIndex(tree, backend);
  } finally {
    backend.close();
  }
  return { entryCount: tree.entries.length };
}

export async function kbLint(ctx: KbCommandContext): Promise<readonly KbFinding[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const specArtifacts = await loadLintSpecArtifacts(ctx);
  return lintKb(tree, specArtifacts, ctx.level, ctx.now ?? new Date(SYSTEM_CLOCK.now()));
}

export interface KbGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly hops: number;
}

/** `graph [id] [--hops n]`: the real link graph `@forge/kb/db`'s own `KbIndexBackend.expand` already
 * computes from the synced index — `id` omitted expands from every real entry id in the current tree
 * (the whole graph); given, expands from just that one node. Reads the *synced* index, the same real
 * data `kb search` reads, for the identical reason (see its own doc comment). */
export async function kbGraph(
  ctx: KbCommandContext,
  id: string | undefined,
  hops = 1,
): Promise<readonly KbGraphEdge[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const startIds = id !== undefined ? [id] : tree.entries.map((entry) => summarize(entry, ctx.kbRoot).id);
  const backend = openKbIndex(ctx.paths);
  try {
    const edges: KbGraphEdge[] = [];
    for (const from of startIds) {
      for (const to of backend.expand([from], hops)) {
        if (to !== from) edges.push({ from, to, hops });
      }
    }
    return edges;
  } finally {
    backend.close();
  }
}

/** `diff`: `03` §3.2.2 names this subcommand but no real mechanism to diff two versions of a KB
 * entry (across commits, across a proposal vs. the committed version) exists anywhere in this
 * codebase — refused rather than fabricated. See `SPEC-QUESTIONS.md`. */
export function kbDiff(): never {
  throw new ForgeError('USR-003', { feature: 'kb diff' });
}

export type { KbTree };
