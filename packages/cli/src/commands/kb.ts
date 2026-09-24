/**
 * `forge kb <list|show|search|lint|diff|sync|open|graph|verify>` — `03` §3.2.2, `17` §17.4 point 6 /
 * §17.6 for `verify`.
 *
 * @see specs/03 §3.2.2
 * @see specs/17 §17.4
 * @see specs/17 §17.6
 */
import { ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import {
  PROPOSED_ENV_FIXED,
  runConfinedCommand,
  STORED_COMMAND_LIMITS,
  vetStoredCommand,
} from '@forge/engine/dispatch';
import {
  extractVerificationCommand,
  lintKb,
  openKbIndex,
  parseKbTree,
  rebuildIndex,
  type KbFinding,
  type KbParsedEntry,
  type KbTree,
  type LintKbSpecArtifacts,
} from '@forge/kb';
import type { Capability, Epic } from '@forge/schemas';
import type { ProjectLevel } from '@forge/methods/level';
import { SYSTEM_CLOCK } from '@forge/core';
import { errorMessage } from '@forge/vcs';

import { writeKbSyncRecord } from './kb-sync-record.ts';
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
  /** The real process environment a stored `## Verification` command is confined to
   * (`runStoredVerificationCommand`'s own doc comment, `PLAN-M14.md` P28) — required, injected rather
   * than read ambiently here (R10): `bin.ts`'s own `buildKbContext` is the one real caller allowed to
   * read `process.env`, via `realEnvSnapshot()`. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export async function loadLintSpecArtifacts(ctx: KbCommandContext): Promise<LintKbSpecArtifacts> {
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
  const found = tree.entries
    .map((entry) => summarize(entry, ctx.kbRoot))
    .find((entry) => entry.id === id);
  if (found === undefined) {
    throw new ForgeError('KB-015', { id });
  }
  return found;
}

/** `open <id>`: resolves and prints the real file path — no TUI/`$EDITOR` launch this milestone
 * (`22`'s own "Do not build" line), so "open" means "tell you exactly where it is," the honest
 * non-interactive equivalent. */
export async function kbOpen(
  ctx: KbCommandContext,
  id: string,
): Promise<{ readonly path: string }> {
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
export async function kbSearch(
  ctx: KbCommandContext,
  query: string,
): Promise<readonly KbSearchHit[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const summaries = new Map(
    tree.entries.map((entry) => summarize(entry, ctx.kbRoot)).map((entry) => [entry.id, entry]),
  );
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
  // The record `kb lint --rule kb-synced` compares against: taken after the index is written, from the same files.
  await writeKbSyncRecord(ctx.paths, ctx.kbRoot);
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
  const startIds =
    id !== undefined ? [id] : tree.entries.map((entry) => summarize(entry, ctx.kbRoot).id);
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

export type KbVerifyOutcome = 'pass' | 'fail' | 'timeout' | 'error' | 'skipped' | 'refused';

export interface KbVerifyFinding {
  readonly id: string;
  readonly path: string;
  readonly command: string | undefined;
  readonly outcome: KbVerifyOutcome;
  readonly detail: string;
}

function isKnowledgeEntry(
  entry: KbParsedEntry,
): entry is Extract<KbParsedEntry, { readonly kind: 'kb-entry' }> {
  return entry.kind === 'kb-entry';
}

/** Runs `command` for real, in the live project's own current working tree (never a sandboxed clone —
 * unlike `forge adopt`'s own phase-5 VERIFICATION, this checks whether the code a developer already
 * has checked out still matches what a KB entry claims, not an isolated snapshot of it) and reports the
 * one real outcome.
 *
 * The command is a real, stored KB entry's own text — written by an agent or by `forge adopt`
 * (`kbVerify`'s own doc comment), so a hostile or simply careless entry cannot become an arbitrary shell
 * command: it runs only after `vetStoredCommand` accepts it (the identical confinement `PLAN-M14.md`
 * P28 gives `forge adopt`'s own detected build/test command, `@forge/engine/adopt/verification.ts`'s
 * own `runCommandCheck`), then through `runConfinedCommand` (a scrubbed environment — `env`, never read
 * ambiently here, R10 — closed stdin, the project root as cwd, a timeout and an output cap). A refused
 * command never runs at all: reported as `outcome: 'refused'`, never `fail` (it disproved nothing) and
 * never silently skipped (it is real, actionable drift in what the entry claims can even run), with a
 * detail that starts `refused (<reason>)` and a remedy: move the command into a script the `##
 * Verification` section names instead. */
async function runStoredVerificationCommand(
  id: string,
  path: string,
  command: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<KbVerifyFinding> {
  try {
    const refusal = await vetStoredCommand(command, cwd);
    if (refusal !== undefined) {
      return {
        id,
        path,
        command,
        outcome: 'refused',
        detail:
          `refused (${refusal.reason}): ${refusal.detail} Put the command in a script this ` +
          'entry can name instead (a package.json script, a shell script committed to the repo).',
      };
    }
    const result = await runConfinedCommand(command, cwd, {
      limits: STORED_COMMAND_LIMITS,
      parentEnv: env,
      extraEnv: PROPOSED_ENV_FIXED,
    });
    if (result.timedOut) {
      return {
        id,
        path,
        command,
        outcome: 'timeout',
        detail: `"${command}" did not finish within ${String(STORED_COMMAND_LIMITS.timeoutMs)}ms and was killed.`,
      };
    }
    if (result.exitCode === 0) {
      return { id, path, command, outcome: 'pass', detail: `"${command}" exited 0.` };
    }
    // Truncated for the identical reason `runCommandCheck`'s own doc comment gives: a genuinely broken
    // command's own output can run to many kilobytes, and the fact that it failed (plus enough output
    // to act on) matters more here than every byte of it.
    const output = (result.stderr || result.stdout).slice(0, 2000);
    return {
      id,
      path,
      command,
      outcome: 'fail',
      detail: `"${command}" exited ${String(result.exitCode)}: ${output}`,
    };
  } catch (cause) {
    return {
      id,
      path,
      command,
      outcome: 'error',
      detail: `"${command}" could not be run: ${errorMessage(cause)}`,
    };
  }
}

/**
 * `forge kb verify` — `17` §17.4 point 6 / §17.6: "run stored verification commands." Walks every real
 * KB entry with `confidence: 'verified'` (`08` §8.3's own rule: only a `verified` entry is required to
 * carry a `## Verification` section with real content at all), extracts the one, real, machine-runnable
 * command each entry's own section names via the established `` Command: `<cmd>` `` convention
 * (`extractVerificationCommand`, `SPEC-QUESTIONS.md` Q159/`PLAN-M10.md` P20), and runs it for real
 * against the live project. An entry whose section has no such line is reported `skipped`, never
 * `fail` — a human-only verification step ("open the admin panel and confirm...") is not drift, it is
 * simply not machine-checkable by this command.
 *
 * This is the real, disclosed-as-missing CLI surface `SPEC-QUESTIONS.md` Q159 named: the underlying
 * command-running mechanism (`@forge/engine/adopt`'s `runVerificationPhase`) exists for `forge adopt`'s
 * own onboarding-time, sandboxed-clone use; this command is deliberately not that — it runs directly
 * against the caller's own already-checked-out working tree, since its job is "does reality still match
 * what the KB claims right now," not "does a clean clone build."
 *
 * **Trust model, considered directly, not overlooked.** `command` ultimately traces back (via
 * RECONSTRUCTION, `PLAN-M10.md` P18) to a `package.json` `scripts.build`/`scripts.test` entry the
 * *target repository itself* wrote, or to whatever an agent typed into the entry's own `##
 * Verification` section — so it is not confined the way a session's own `exec` grant confines a live
 * model turn. `PLAN-M14.md` P28 closes the gap that left open before it: `runStoredVerificationCommand`
 * (above) now runs `command` through the identical confinement a model-proposed command is held to
 * (`vetStoredCommand`, `runConfinedCommand`, `@forge/engine/dispatch/confined-command.ts`) rather than
 * straight to a shell with the whole parent environment — this does not run in a sandboxed clone the
 * way `forge adopt`'s own onboarding-time VERIFICATION does (`SPEC-QUESTIONS.md` Q159's own sandbox-
 * clone rationale is for a repository nobody has decided to adopt yet, not a project you already run
 * `npm test`/`npm run build` against directly yourself), but it is no longer unvetted: a chained, network-
 * reaching or secret-reading command is refused, never run, and the child that does run sees a scrubbed
 * environment. Still disclosed, not fixed by this piece (Q222): a refused command's own remaining
 * exec allowlist still lets a granted test runner run whatever project code it runs.
 */
export async function kbVerify(ctx: KbCommandContext): Promise<readonly KbVerifyFinding[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const projectRoot = ctx.paths.resolveWithin('.');
  const verifiedEntries = tree.entries
    .filter(isKnowledgeEntry)
    .filter((entry) => entry.value.confidence === 'verified');

  const findings: KbVerifyFinding[] = [];
  for (const entry of verifiedEntries) {
    const command = extractVerificationCommand(entry.value.body);
    if (command === undefined) {
      findings.push({
        id: entry.value.id,
        path: entry.path,
        command: undefined,
        outcome: 'skipped',
        detail:
          'no machine-runnable "Command: `...`" line found in this entry\'s own ## Verification ' +
          'section — it may still be a genuine, human-checkable verification step.',
      });
      continue;
    }
    findings.push(
      await runStoredVerificationCommand(entry.value.id, entry.path, command, projectRoot, ctx.env),
    );
  }
  return findings;
}

/** `diff`: `03` §3.2.2 names this subcommand but no real mechanism to diff two versions of a KB
 * entry (across commits, across a proposal vs. the committed version) exists anywhere in this
 * codebase — refused rather than fabricated. See `SPEC-QUESTIONS.md`. */
export function kbDiff(): never {
  throw new ForgeError('USR-003', { feature: 'kb diff' });
}

export type { KbTree };
