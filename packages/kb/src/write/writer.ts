/**
 * `KbWriter` — `08` §8.6's two write paths: direct `write` (schema-valid, sources mandatory, `updated`
 * bumped, event appended) and `propose` (a structured single-field change, queued, rebased against the
 * target's current value, with an explicit conflict rather than a best-effort merge).
 *
 * Does not perform contradiction detection: `08` §8.6 names it for the direct-write path, but its own
 * algorithm lives entirely in §8.7's KB linter (`PLAN-M3.md` P10), not yet built — see
 * `SPEC-QUESTIONS.md` Q52, point 2.
 *
 * One FIFO queue per project, shared across every `KbWriter` instance pointed at the same project —
 * not a per-instance queue, and not a per-target-entry queue. A gauntlet critic found a first version
 * queued per *instance*: two independently-constructed `KbWriter`s against the same project raced each
 * other for real (double-allocated ids, lost event-log lines), since nothing enforced "exactly one
 * instance per project" despite this file's own earlier claim to be "process-wide." Keying the queue
 * by the project's own resolved root path (a module-level map, not a per-instance field) makes the
 * guarantee actually hold regardless of how many `KbWriter` objects a caller constructs, while still
 * only serialising within one process — the same scope `@forge/core/ids`'s own `IdAllocator` already
 * has, and the scope `08` §8.6's "writes are serialised" is read against here.
 *
 * @see specs/08 §8.6
 * @see SPEC-QUESTIONS.md Q52
 * @see PLAN-M3.md P7
 */
import { ArtifactDocument, splitFrontMatter } from '@forge/core/artifacts';
import type { Clock } from '@forge/core';
import { ForgeError } from '@forge/core';
import { pathExists, readTextFile, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';
import * as YAML from 'yaml';

import { kbEntrySchema, type KbEntry, type KbSource } from '../schema/kb-entry.ts';
import { sectionIdToken } from '../schema/sections.ts';
import { DEFAULT_KB_ROOT, parseKbTree } from '../schema/tree.ts';
import { appendKbEvent } from './event-log.ts';
import { KbIdAllocator } from './id-allocator.ts';

/**
 * One FIFO queue per project root, shared by every `KbWriter` instance — see this file's own doc
 * comment. Keyed by `paths.resolveWithin('.')`'s own resolved absolute path string. Never evicted:
 * FORGE's own architecture operates on one project per process (`CFG-002`: "another FORGE supervisor
 * holds this project"), so the realistic number of distinct keys any one process ever accumulates is
 * small — a long-running test suite touching many temp-dir "projects" is the one case that grows this
 * map without bound, and even there each entry is a settled `Promise` plus a string key, not a
 * meaningful leak.
 */
const projectQueues = new Map<string, Promise<unknown>>();

function enqueueForProject<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(root) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  projectQueues.set(
    root,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** Every `kbEntrySchema` field the caller supplies, minus the three `KbWriter` derives itself
 * (`id`: centrally allocated; `created`/`updated`: the injected clock, R10), plus the destination
 * file's own relative path under the KB root — `08` §8.2 names no rule for choosing one for a
 * brand-new topic, so the caller supplies it (`SPEC-QUESTIONS.md` Q52, point 1). */
export type KbEntryInput = Omit<KbEntry, 'id' | 'created' | 'updated'> & { readonly path: string };

/** `08` §8.3's own four fixed body sections — the only granularity `KbProposal` targets
 * (`SPEC-QUESTIONS.md` Q52, point 3). */
export const KB_PROPOSAL_FIELDS = ['statement', 'rationale', 'implications', 'verification'] as const;
export type KbProposalField = (typeof KB_PROPOSAL_FIELDS)[number];

/**
 * A structured, single-field change to an existing KB entry — not a raw text diff (`SPEC-QUESTIONS.md`
 * Q52, point 3). `baseValue` is the section's content as the proposer last read it; rebasing compares
 * this against the target's *current* content when the proposal's turn in the queue comes.
 */
export interface KbProposal {
  readonly targetId: string;
  readonly field: KbProposalField;
  readonly baseValue: string;
  readonly proposedValue: string;
  readonly rationale: string;
  readonly sources: readonly KbSource[];
}

/** Corrected from the plan's original `Promise<KbProposal>`, which could not report which of the two
 * actually happened (`SPEC-QUESTIONS.md` Q52, point 4). */
export type KbProposalOutcome =
  | { readonly status: 'applied'; readonly proposal: KbProposal; readonly diff: string }
  | { readonly status: 'conflict'; readonly proposal: KbProposal; readonly currentValue: string };

const SECTION_HEADINGS: Record<KbProposalField, string> = {
  statement: 'Statement',
  rationale: 'Rationale',
  implications: 'Implications',
  verification: 'Verification',
};

const NEXT_HEADING_PATTERN = /^ {0,3}##\s+/;

function headingPatternFor(field: KbProposalField): RegExp {
  return new RegExp(`^ {0,3}##\\s+${SECTION_HEADINGS[field]}\\s*$`);
}

function sectionLineRange(
  lines: readonly string[],
  field: KbProposalField,
): { readonly contentStart: number; readonly contentEnd: number } | undefined {
  const headingIndex = lines.findIndex((line) => headingPatternFor(field).test(line));
  if (headingIndex === -1) return undefined;

  // `.findIndex` on the sliced remainder, not a manual indexed loop: its own callback receives each
  // line directly, with no `noUncheckedIndexedAccess` fallback to defend against an index that is
  // always in range by construction.
  const rest = lines.slice(headingIndex + 1);
  const nextHeadingOffset = rest.findIndex((line) => NEXT_HEADING_PATTERN.test(line));
  const contentEnd = nextHeadingOffset === -1 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  return { contentStart: headingIndex + 1, contentEnd };
}

/**
 * Replaces a body section's content with `newValue`, leaving its heading line, every other section,
 * and the surrounding structure untouched. Takes the section's own already-confirmed `range` rather
 * than re-deriving and re-checking it — `doPropose` (this function's only caller) already computes it
 * and rejects a missing section (`KB-008`) before ever reaching here, so a second "does this section
 * exist" branch here would be provably unreachable, not merely unlikely.
 *
 * A gauntlet critic found a first version of this function silently dropped the blank line separating
 * the edited section from the next heading, and that `doPropose`'s own unconditional trailing `\n`
 * appended a *second* one whenever the edited section already ended in one (true for every section
 * except the last), so a repeated edit to a non-last section grew the file by one stray trailing blank
 * line every single time — compounding indefinitely across a KB entry's real editing life. Fixed by
 * re-inserting exactly one blank line before the next heading when one follows (`08` §8.3's own worked
 * example always has exactly one), and leaving the trailing-newline decision entirely to the caller
 * rather than joining in a way that made it depend on ambient state.
 */
function replaceSectionValue(
  body: string,
  range: { readonly contentStart: number; readonly contentEnd: number },
  newValue: string,
): string {
  const lines = body.split(/\r\n|\r|\n/);
  const before = lines.slice(0, range.contentStart);
  const after = lines.slice(range.contentEnd);
  const trimmedNew = newValue.trim();
  // `after` is `[]` only when no heading follows the edited section at all (it is the body's last
  // section) — `contentEnd` is otherwise always the index of that next heading line itself.
  if (after.length === 0) {
    return [...before, trimmedNew].join('\n');
  }
  return [...before, trimmedNew, '', ...after].join('\n');
}

/** Appends exactly one trailing newline — never a second one, regardless of whether `body` already
 * ends with one (a gauntlet critic found this ambient-state dependency was the direct cause of the
 * ever-growing trailing blank lines `replaceSectionValue`'s own doc comment describes). */
function withTrailingNewline(body: string): string {
  return body.endsWith('\n') ? body : `${body}\n`;
}

function renderDiff(baseValue: string, proposedValue: string): string {
  return `- ${baseValue}\n+ ${proposedValue}`;
}

export interface KbWriterDeps {
  readonly paths: ProjectPaths;
  readonly clock: Clock;
  readonly kbRoot?: string;
}

export class KbWriter {
  private readonly paths: ProjectPaths;
  private readonly clock: Clock;
  private readonly kbRoot: string;
  private readonly idAllocator: KbIdAllocator;
  private readonly projectRoot: string;

  constructor(deps: KbWriterDeps) {
    this.paths = deps.paths;
    this.clock = deps.clock;
    this.kbRoot = deps.kbRoot ?? DEFAULT_KB_ROOT;
    this.idAllocator = new KbIdAllocator({ paths: deps.paths, clock: deps.clock, kbRoot: this.kbRoot });
    this.projectRoot = deps.paths.resolveWithin('.');
  }

  /**
   * Creates a brand-new KB entry: allocates its id, sets `created`/`updated` to the injected clock's
   * `now()`, validates the result against `kbEntrySchema`, writes it to `input.path`, and appends one
   * `write` event.
   *
   * @throws {ForgeError} `KB-004` if `input.sources` is empty.
   * @throws {ForgeError} `KB-006` if the entry fails schema validation for a field other than sources.
   * @throws {ForgeError} `KB-009` if `input.path` already names an existing file — a gauntlet critic
   * found a first version silently overwrote it, permanently losing whatever entry was there before.
   */
  async write(input: KbEntryInput): Promise<KbEntry> {
    return this.enqueue(() => this.doWrite(input));
  }

  /**
   * Proposes a change to one of an existing entry's four body sections. Never throws for a rebase
   * conflict — that is a normal, reported outcome (`status: 'conflict'`), not an error.
   *
   * @throws {ForgeError} `KB-004` if `proposal.sources` is empty.
   * @throws {ForgeError} `KB-007` if no entry with `proposal.targetId` exists.
   * @throws {ForgeError} `KB-008` if the target entry's body has no `## {field}` section at all — a
   * legitimate KB entry need not carry all four of `08` §8.3's body sections (`kbEntrySchema` only
   * requires `## Verification` when `confidence: 'verified'`), so a proposal can genuinely name one
   * that was never there.
   * @throws {ForgeError} `KB-011` if more than one entry claims `proposal.targetId` — the KB is meant
   * to be hand-editable (`08` §8.9), so a duplicate id from a copy-paste or a bad merge is real; a
   * gauntlet critic found a first version silently picked whichever matched first (alphabetically,
   * not by any meaningful ordering) and edited that one with no signal anything was ambiguous.
   */
  async propose(proposal: KbProposal): Promise<KbProposalOutcome> {
    return this.enqueue(() => this.doPropose(proposal));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return enqueueForProject(this.projectRoot, operation);
  }

  private async doWrite(input: KbEntryInput): Promise<KbEntry> {
    if (input.sources.length === 0) {
      throw new ForgeError('KB-004', { entryId: input.path });
    }

    const target = this.paths.resolveWithin(`${this.kbRoot}/${input.path}`);
    if (await pathExists(target)) {
      throw new ForgeError('KB-009', { entryId: input.path });
    }

    const now = this.clock.now();
    const today = now.slice(0, 10);
    // `path` is this type's own addition on top of `kbEntrySchema` (Q52, point 1) — kept out of the
    // object handed to a `.strict()` schema that has no such field.
    const { path, ...entryFields } = input;

    // Validated once against a placeholder id (real section token, so the id/section consistency
    // check still passes; the digits are simply not a real allocation) before ever calling the
    // allocator — a gauntlet critic found a first version allocated first and validated after,
    // permanently burning a real id for a typo in any unrelated field (`owner: ''`, and every write
    // after it shifts up by one, forever). Everything this pre-check can catch is caught before an id
    // is ever spent.
    const placeholderId = `KB-${sectionIdToken(input.section)}-0000`;
    const precheck = kbEntrySchema.safeParse({
      ...entryFields,
      id: placeholderId,
      created: today,
      updated: today,
    });
    if (!precheck.success) {
      const issues = precheck.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new ForgeError('KB-006', { entryId: path, issues: issues.join('; ') });
    }

    // Forces a fresh scan before allocating, discarding this allocator's own in-memory cache: a
    // gauntlet critic's cross-`KbWriter`-instance test found that cache going stale the moment a
    // *different* `KbWriter` (each constructs its own `KbIdAllocator`) wrote an entry in between two
    // calls on this one — the outer per-project queue already serialises the two calls themselves,
    // but each allocator's own `cachedIndex` optimisation has no way to know about a sibling
    // instance's write unless it is forced to re-read the real disk state every time.
    await this.idAllocator.scan();
    const id = await this.idAllocator.allocate(input.section);

    // No second `safeParse`: `precheck.data` already validated every field this entry has except its
    // own id, and a real allocated id (any 4 digits, the same section token) can never make the
    // id-format or id/section-consistency checks fail where the placeholder id already passed them —
    // re-parsing here would only ever re-confirm what `precheck` already proved, a provably
    // unreachable failure branch, not a genuinely defensive one.
    const entry: KbEntry = { ...precheck.data, id };
    const { body, ...frontMatter } = entry;
    // `withTrailingNewline`, not an unconditional `${body}\n`: `body` is caller-supplied and may
    // already end in its own newline (this piece's own test fixtures do) — the same sibling gap
    // `doPropose`'s own trailing-newline fix already closed, found by testing the two functions'
    // output together rather than each in isolation.
    const text = `---\n${YAML.stringify(frontMatter)}---\n\n${withTrailingNewline(body)}`;
    await writeFileAtomic(target, text);
    await appendKbEvent(this.paths, { at: now, kind: 'write', entryId: entry.id, section: entry.section });
    return entry;
  }

  private async doPropose(proposal: KbProposal): Promise<KbProposalOutcome> {
    if (proposal.sources.length === 0) {
      throw new ForgeError('KB-004', { entryId: proposal.targetId });
    }

    // Known residual gap, found by a verify pass on the KB-011 fix itself: this only sees files that
    // fully pass `parseKbTree`'s own validation (`tree.entries`). A second file claiming the same id
    // but *also* failing some unrelated check (e.g. filed under a directory that doesn't match its
    // own `section` field) lands in `tree.errors` instead and is invisible here — a narrower instance
    // of the same duplicate-id hazard this check exists for. Full duplicate-id detection across every
    // file regardless of its own validation status is a project-wide integrity check, the same shape
    // already deferred to the KB linter (`08` §8.7, `PLAN-M3.md` P10) for collection-file entries
    // (`SPEC-QUESTIONS.md` Q50's own critic-round addendum) — not reinvented here.
    const tree = await parseKbTree(this.paths, this.kbRoot);
    const matches = tree.entries.filter(
      (entry) => entry.kind === 'kb-entry' && entry.value.id === proposal.targetId,
    );
    if (matches.length > 1) {
      throw new ForgeError('KB-011', { entryId: proposal.targetId });
    }
    const target = matches[0];
    if (target?.kind !== 'kb-entry') {
      throw new ForgeError('KB-007', { entryId: proposal.targetId });
    }

    const absolute = this.paths.resolveWithin(`${this.kbRoot}/${target.path}`);
    const source = await readTextFile(absolute);
    const doc = ArtifactDocument.parse(source, target.path);

    const bodyLines = doc.body.split(/\r\n|\r|\n/);
    const range = sectionLineRange(bodyLines, proposal.field);
    if (range === undefined) {
      throw new ForgeError('KB-008', { entryId: proposal.targetId, field: proposal.field });
    }
    const currentValue = bodyLines.slice(range.contentStart, range.contentEnd).join('\n').trim();
    const now = this.clock.now();

    if (currentValue !== proposal.baseValue.trim()) {
      await appendKbEvent(this.paths, {
        at: now,
        kind: 'propose-conflict',
        entryId: proposal.targetId,
        section: target.value.section,
      });
      return { status: 'conflict', proposal, currentValue };
    }

    const newBody = replaceSectionValue(doc.body, range, proposal.proposedValue);
    doc.set(['updated'], now.slice(0, 10));
    const split = splitFrontMatter(doc.toString(), target.path);
    const finalText = `${split.prefix}${split.frontMatterText}${split.infix}${withTrailingNewline(newBody)}`;
    await writeFileAtomic(absolute, finalText);

    await appendKbEvent(this.paths, {
      at: now,
      kind: 'propose-applied',
      entryId: proposal.targetId,
      section: target.value.section,
    });
    return { status: 'applied', proposal, diff: renderDiff(proposal.baseValue, proposal.proposedValue) };
  }
}
