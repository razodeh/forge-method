/**
 * `forge kb lint --rule <name>` — the two KB checks the shipped gates name: `adr-coverage` (`G-Design`, `08` §8.7
 * "ADR coverage: every component in components.md has ≥1 owning ADR", error at G-Design) and `kb-synced`
 * (`G-Operate`, `10` §10.3 "KB not synced"; `08` §8.9: "Human edits are detected via content hash; `forge kb sync`
 * re-indexes"). `PLAN-M13.md` P25.
 *
 * Both read the KB tree (and, for `kb-synced`, the derived index) and nothing else, are deterministic (findings are
 * sorted), and treat anything they cannot read as a finding. `adr-coverage` reuses `lintKb`'s own
 * `kb:component-coverage` check rather than a second implementation, plus the tree's parse errors: an ADR or the
 * components register that fails its schema is missing from what the rule can see, so it must not pass silently.
 *
 * `errors` in the envelope is the number of `error` findings, which is what `failOn: 'errors > 0'` reads.
 *
 * @see specs/08 §8.7, §8.9
 * @see specs/10 §10.3
 * @see PLAN-M13.md P25
 */
import {
  lintKb,
  parseKbTree,
  readKbIndexEntries,
  rebuildIndex,
  type EntryRow,
  type KbFinding,
  type KbIndexBackend,
  type KbTree,
} from '@forge/kb';
import { SYSTEM_CLOCK } from '@forge/core';

import type { KbCommandContext } from './kb.ts';
import { hashKbFiles, readKbSyncRecord } from './kb-sync-record.ts';

export const KB_LINT_RULE_IDS = ['adr-coverage', 'kb-synced'] as const;
export type KbLintRuleId = (typeof KB_LINT_RULE_IDS)[number];

export function isKbLintRuleId(value: string | undefined): value is KbLintRuleId {
  return value !== undefined && (KB_LINT_RULE_IDS as readonly string[]).includes(value);
}

export interface KbRuleFinding extends KbFinding {
  readonly remedy: string;
}

export interface KbLintRuleResult {
  readonly rule: KbLintRuleId;
  readonly findings: readonly KbRuleFinding[];
}

const SYNC_REMEDY = 'Run `forge kb sync`, then run the check again.';

/** Same ordering `lintKb` uses for its own findings: rule id, then entry id, then message. */
function sorted(findings: readonly KbRuleFinding[]): readonly KbRuleFinding[] {
  return [...findings].sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    const aEntry = a.entryId ?? '';
    const bEntry = b.entryId ?? '';
    if (aEntry !== bEntry) return aEntry < bEntry ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });
}

/** A file the tree could not read: the rule cannot see what is in it, so it cannot pass. */
function unreadableFindings(tree: KbTree): readonly KbRuleFinding[] {
  return tree.errors.map((error) => ({
    ruleId: 'kb:schema',
    severity: 'error',
    message: `${error.path}: ${error.message}`,
    remedy: `Repair ${error.path} so it passes its schema (forge kb lint shows the same finding), then run the check again.`,
  }));
}

/** The tree with every ADR that is not in force removed. A `rejected`, `superseded` or `deprecated` decision owns
 * nothing (`08` §8.7 says "owning ADR"); a `proposed` one does count, because nothing in the design phase promotes an
 * ADR to `accepted` (the ADR template defaults to `proposed`, only `forge adr accept` changes it), so requiring
 * `accepted` would force a Waiver on every project that follows the shipped briefs. */
function inForceOnly(tree: KbTree): KbTree {
  return {
    ...tree,
    entries: tree.entries.filter(
      (entry) =>
        entry.kind !== 'adr' ||
        entry.value.status === 'accepted' ||
        entry.value.status === 'proposed',
    ),
  };
}

async function adrCoverage(ctx: KbCommandContext): Promise<readonly KbRuleFinding[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const findings: KbRuleFinding[] = [...unreadableFindings(tree)];

  const register = tree.entries.find((entry) => entry.kind === 'components-file');
  const components = register?.kind === 'components-file' ? register.value.components : [];
  if (components.length === 0) {
    // `08` §8.7's rule is per component; with none registered it holds for nothing, which is not a pass at a
    // gate whose evidence is the ArchitectureSpec. A register that failed its schema is already reported above.
    if (!tree.errors.some((error) => error.path === 'architecture/components.md')) {
      findings.push({
        ruleId: 'kb:component-coverage',
        severity: 'error',
        message:
          'No components register (architecture/components.md) with at least one component was found, so ADR coverage cannot be shown.',
        remedy:
          'Write the components register (architecture/components.md) from the architecture decision, then write the ADR that owns each component, and run the check again.',
      });
    }
  }

  // `kb:component-coverage` reads only the KB tree; the specs feed other lint rules, so a corrupt spec document must
  // not stop this one (the spec-reading rules would refuse, and a refusal is not a verdict).
  const linted = lintKb(
    inForceOnly(tree),
    { capabilities: [], epics: [] },
    ctx.level,
    ctx.now ?? new Date(SYSTEM_CLOCK.now()),
  );
  // Components an ADR owns only on paper: covered when every ADR counts, uncovered when only those in force do.
  const coveredByAnyAdr = new Set(
    lintKb(
      tree,
      { capabilities: [], epics: [] },
      ctx.level,
      ctx.now ?? new Date(SYSTEM_CLOCK.now()),
    )
      .filter((finding) => finding.ruleId === 'kb:component-coverage')
      .map((finding) => finding.entryId),
  );
  for (const finding of linted) {
    if (finding.ruleId !== 'kb:component-coverage') continue;
    const id = finding.entryId ?? 'the component';
    const notInForce = finding.entryId !== undefined && !coveredByAnyAdr.has(finding.entryId);
    findings.push(
      notInForce
        ? {
            ...finding,
            message: `Component ${JSON.stringify(id)} is owned only by ADRs that are not in force (rejected, superseded or deprecated).`,
            remedy: `Write, or accept, an ADR that owns ${id}, then run the check again.`,
          }
        : {
            ...finding,
            remedy: `Write an ADR that owns ${id}, and a KB entry that applies_to it and cites that decision as a source, then run the check again.`,
          },
    );
  }
  return sorted(findings);
}

/** An in-memory `KbIndexBackend` that keeps the rows `rebuildIndex` would write, so "what the index should hold"
 * comes from the same code that builds it (`rebuildIndex`), not a second reading of the tree. */
function collectingBackend(rows: EntryRow[]): KbIndexBackend {
  return {
    upsertEntry: (row) => {
      rows.push(row);
    },
    upsertLinks: () => undefined,
    search: () => [],
    expand: () => [],
    clear: () => undefined,
    close: () => undefined,
  };
}

/** File-level drift the index comparison cannot see. `reported` holds the paths that comparison already named. */
async function fileDrift(
  ctx: KbCommandContext,
  reported: ReadonlySet<string>,
): Promise<readonly KbRuleFinding[]> {
  const record = await readKbSyncRecord(ctx.paths);
  if (record.status !== 'ok') {
    return [
      {
        ruleId: 'kb:sync',
        severity: 'error',
        message:
          record.status === 'missing'
            ? 'No record of the KB files at the last sync was found (.forge/state/kb-files.json), so edits made since cannot be ruled out.'
            : `The record of the KB files at the last sync could not be read: ${record.detail}.`,
        remedy: SYNC_REMEDY,
      },
    ];
  }
  const now = await hashKbFiles(ctx.paths, ctx.kbRoot);
  const drift: KbRuleFinding[] = [];
  const paths = [...new Set([...Object.keys(record.files), ...Object.keys(now)])].sort();
  for (const path of paths) {
    // An entry the index comparison already named is not reported twice.
    if (reported.has(path)) continue;
    const before = record.files[path];
    const after = now[path];
    if (before === after) continue;
    const what =
      before === undefined
        ? 'was added since the last sync'
        : after === undefined
          ? 'was deleted since the last sync'
          : 'changed since the last sync';
    drift.push({
      ruleId: 'kb:sync',
      severity: 'error',
      message: `${path} ${what}.`,
      remedy: SYNC_REMEDY,
    });
  }
  return drift;
}

async function kbSynced(ctx: KbCommandContext): Promise<readonly KbRuleFinding[]> {
  const tree = await parseKbTree(ctx.paths, ctx.kbRoot);
  const findings: KbRuleFinding[] = [...unreadableFindings(tree)];

  const indexed = readKbIndexEntries(ctx.paths);
  if (indexed.status === 'missing') {
    findings.push({
      ruleId: 'kb:sync',
      severity: 'error',
      message: 'The KB index has never been built (no index under .forge/state).',
      remedy: SYNC_REMEDY,
    });
    return sorted(findings);
  }
  if (indexed.status === 'unreadable') {
    findings.push({
      ruleId: 'kb:sync',
      severity: 'error',
      message: `The KB index could not be read: ${indexed.detail}.`,
      remedy: SYNC_REMEDY,
    });
    return sorted(findings);
  }

  const expectedRows: EntryRow[] = [];
  rebuildIndex(tree, collectingBackend(expectedRows));
  const expected = new Map(expectedRows.map((row) => [row.id, row]));
  const reported = new Set<string>();
  const actual = new Map(indexed.entries.map((entry) => [entry.id, entry]));

  for (const [id, row] of expected) {
    const entry = actual.get(id);
    if (entry === undefined) {
      reported.add(row.path);
      findings.push({
        ruleId: 'kb:sync',
        severity: 'error',
        message: `${id} (${row.path}) is in the KB but not in the index.`,
        entryId: id,
        remedy: SYNC_REMEDY,
      });
    } else if (entry.hash !== row.hash || entry.path !== row.path) {
      reported.add(row.path);
      findings.push({
        ruleId: 'kb:sync',
        severity: 'error',
        message: `${id} (${row.path}) changed since the last sync.`,
        entryId: id,
        remedy: SYNC_REMEDY,
      });
    }
  }
  for (const [id, entry] of actual) {
    if (expected.has(id)) continue;
    reported.add(entry.path);
    findings.push({
      ruleId: 'kb:sync',
      severity: 'error',
      message: `${id} (${entry.path}) is in the index but no longer in the KB.`,
      entryId: id,
      remedy: SYNC_REMEDY,
    });
  }
  // The index hashes parsed front matter of four kinds only, so it cannot see an edit to an ADR or runbook body or to
  // `components.md`, `environments.md` or a register. The sync record hashes every KB file (`kb-sync-record.ts`).
  findings.push(...(await fileDrift(ctx, reported)));
  return sorted(findings);
}

export async function kbLintRule(
  ctx: KbCommandContext,
  rule: KbLintRuleId,
): Promise<KbLintRuleResult> {
  return { rule, findings: rule === 'adr-coverage' ? await adrCoverage(ctx) : await kbSynced(ctx) };
}
