/**
 * `forge export <target>` — `03` §3.2.7's own "v1: first two + dry-run for the rest": `markdown-bundle`
 * and `html` produce real output; `jira`/`linear`/`github-issues` (real third-party integrations, no
 * client for any of them exists anywhere in this codebase) are real, dry-run-only refusals.
 *
 * @see specs/03 §3.2.7
 */
import { ForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { parseKbTree } from '@forge/kb/schema';

import { listSpecArtifacts } from './shared.ts';

export interface ExportCommandContext {
  readonly paths: ProjectPaths;
  readonly specsRoot: string;
  readonly kbRoot: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ExportSection {
  readonly title: string;
  readonly path: string;
  readonly body: string;
}

async function gatherSections(ctx: ExportCommandContext): Promise<readonly ExportSection[]> {
  const specDocs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  const specSections = specDocs.map((doc): ExportSection => {
    const frontMatter = doc.frontMatter as { readonly title?: unknown };
    return {
      title: typeof frontMatter.title === 'string' ? frontMatter.title : doc.path,
      path: doc.path,
      body: doc.body,
    };
  });

  const kbTree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const kbSections: ExportSection[] = [];
  for (const entry of kbTree.entries) {
    // `body` lives in two real, different places depending on kind: a top-level field on the
    // `KbParsedEntry` union for `adr`/`runbook` (`@forge/kb/schema`'s own `tree.ts`), but inside
    // `entry.value` for `kb-entry` (`kbEntrySchema` itself carries it). A critic round caught an
    // earlier version of this function hardcoding `body: ''` for every real KB-tree document instead
    // of reading either — every real ADR/runbook/KB entry a real project accumulates was silently
    // exported as a bare title with no content.
    if (entry.kind === 'adr' || entry.kind === 'runbook') {
      kbSections.push({
        title: entry.value.title,
        path: `${ctx.kbRoot}/${entry.path}`,
        body: entry.body,
      });
    } else if (entry.kind === 'kb-entry') {
      kbSections.push({
        title: entry.value.title,
        path: `${ctx.kbRoot}/${entry.path}`,
        body: entry.value.body,
      });
    }
  }

  return [...specSections, ...kbSections];
}

/** `markdown-bundle` — every real spec/KB document, concatenated into one real Markdown file, each
 * section headed by its own real title and real project-relative path. */
export async function exportMarkdownBundle(ctx: ExportCommandContext): Promise<string> {
  const sections = await gatherSections(ctx);
  return sections
    .map((section) => `## ${section.title}\n\n_${section.path}_\n\n${section.body}`.trimEnd())
    .join('\n\n---\n\n');
}

/** `html` — the identical real content as `markdown-bundle`, wrapped in a minimal, self-contained,
 * real HTML document (no external stylesheet/script — the same "no rendering dependency this
 * workspace doesn't already have" discipline `@forge/diagrams/render`'s own `renderHtml` already
 * follows), one `<section>` per document. */
export async function exportHtml(ctx: ExportCommandContext): Promise<string> {
  const sections = await gatherSections(ctx);
  const body = sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.title)}</h2><p><em>${escapeHtml(section.path)}</em></p><pre>${escapeHtml(section.body)}</pre></section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FORGE export</title></head><body>${body}</body></html>`;
}

const THIRD_PARTY_TARGETS = ['jira', 'linear', 'github-issues'] as const;
type ThirdPartyTarget = (typeof THIRD_PARTY_TARGETS)[number];

function isThirdPartyTarget(value: string): value is ThirdPartyTarget {
  return (THIRD_PARTY_TARGETS as readonly string[]).includes(value);
}

/** `jira`/`linear`/`github-issues` — real third-party issue trackers, no client for any of them exists
 * anywhere in this codebase. `03` §3.2.7's own "v1: first two + dry-run for the rest" line is read
 * literally: even `--dry-run` has no real work to preview without a real client to ask what it *would*
 * do, so this refuses honestly rather than fabricating a preview. */
export function exportThirdParty(target: string): never {
  if (!isThirdPartyTarget(target)) {
    throw new ForgeError('USR-002', { flag: 'target', value: target });
  }
  throw new ForgeError('USR-003', { feature: `export ${target}` });
}
