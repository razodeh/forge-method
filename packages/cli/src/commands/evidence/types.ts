/**
 * `forge evidence prune` — shared types.
 *
 * `18` §18.7 Retention names three retention-managed artifact types, never any other; this closed
 * union is what keeps that fixed rather than widenable by a future accidental call site.
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */

/** The three retention-managed artifact types (`18` §18.7, Retention) — never `Exemption`,
 * `Disclosure` or the event log, which the same section names as explicitly NOT pruned by this
 * command. */
export type RetentionType = 'MutationEvidence' | 'EvidenceBundle' | 'ParityEvidence';

/** `RetentionType` as a real, iterable array (for a `for`/`groupBy` loop) rather than re-derived from
 * a union type at every call site — the identical "declare the closed set once, as data" shape
 * `ERROR_CODE_PREFIXES` (`@forge/core/errors`) already uses for its own closed union. */
export const RETENTION_TYPES: readonly RetentionType[] = [
  'MutationEvidence',
  'EvidenceBundle',
  'ParityEvidence',
];

/**
 * One real `MutationEvidence`/`EvidenceBundle`/`ParityEvidence` record, as found on disk by
 * {@link enumerateEvidence} (`enumerate.ts`).
 *
 * `subject` is the retention grouping key (`18` §18.7: the story id the record was written for, or
 * the single shared literal `"project"` for a story-less `ParityEvidence` — `process/SPEC-QUESTIONS.md`
 * Q294 Decision 5/A4). `references` is only ever non-empty for `EvidenceBundle` (its own
 * `bindingEvidence`/`parityEvidence` id lists); `MutationEvidence` and `ParityEvidence` cite no other
 * evidence id, so it is always `[]` for them — not optional, so a caller never needs an existence
 * check before iterating it.
 */
export interface EvidenceRecordInfo {
  readonly id: string;
  readonly type: RetentionType;
  readonly subject: string;
  /** The numeric part of `id`, for "newest" comparisons (`18` §18.7: "newest means highest id
   * compared as a number... never a file's modification time"). */
  readonly numericId: number;
  /** Project-relative path to the record's own file. */
  readonly relPath: string;
  /** sha256 of the record file's raw bytes, as read — the tombstone's own `recordSha256` field
   * (`18` §18.7: "the record's sha256"). */
  readonly sha256: string;
  /** Every other retention-managed id this record's own content cites (`EvidenceBundle` only). */
  readonly references: readonly string[];
}

/**
 * One specific-id citation found in a committed gate definition's own `evidence:` block
 * (`.forge/checks/*.gate.yaml`, `10` §10.3) — `process/SPEC-QUESTIONS.md` Q294 Decision 9's "a gate
 * approval or waiver under `10` §10.3's evidence resolution" store. A `Type(*)`/bare-type wildcard
 * reference is never one of these: it names no single id to protect, so pruning can never break it
 * (`resolveGateEvidence`, `gate-commands.ts`, fails the WHOLE type only when nothing of it survives at
 * all, which this command cannot cause — see this piece's own report for why `--keep` always protects
 * at least the highest id of a type that has ever been written).
 */
export interface GateEvidenceCitation {
  readonly gateId: string;
  /** The raw `evidence:` entry text, e.g. `"MutationEvidence(MUT-003)"` — echoed in a refusal so a
   * reader sees exactly what the gate declared, the identical `RUN-112` convention. */
  readonly ref: string;
  readonly type: RetentionType;
  readonly id: string;
}

/** Every real store `forge evidence prune` must read before it can safely decide anything —
 * `process/SPEC-QUESTIONS.md` Q294 Decision 9: "the enumeration of every store that can hold an
 * evidence id." See this piece's own report for the exhaustive, file:line list of what was checked. */
export interface EvidenceEnumeration {
  readonly records: readonly EvidenceRecordInfo[];
  readonly gateCitations: readonly GateEvidenceCitation[];
}

/** Why a record survives this prune, or why it does not — attached to every entry
 * `runEvidencePrune` reports, never silently (`18` §18.7: "protected and reported with the reason"). */
export type PruneReason =
  | { readonly kind: 'newest'; readonly keep: number }
  | { readonly kind: 'highest-id' }
  | { readonly kind: 'referenced-by-record'; readonly by: string }
  | { readonly kind: 'referenced-by-gate'; readonly gateId: string; readonly ref: string }
  | { readonly kind: 'removed' }
  | { readonly kind: 'pending'; readonly by: string };

/** Renders a {@link PruneReason} as the one human/`--json`-shared sentence fragment every report
 * entry carries — kept as a pure function of the typed reason rather than inlined at each call site,
 * so the CLI's human output and its `--json` envelope can never drift against each other. */
export function describePruneReason(reason: PruneReason): string {
  switch (reason.kind) {
    case 'newest':
      return `newest ${String(reason.keep)} for its (type, subject)`;
    case 'highest-id':
      return 'the highest allocated id of its type';
    case 'referenced-by-record':
      return `referenced by ${reason.by}`;
    case 'referenced-by-gate':
      return `referenced by gate ${reason.gateId}'s evidence (${reason.ref})`;
    case 'removed':
      return 'removed';
    case 'pending':
      return `tombstoned, but referenced by ${reason.by} since the first enumeration; not removed this run`;
  }
}

/** One record in a {@link RunEvidencePruneResult} report — every bucket (`kept`/`removed`/`pending`)
 * shares this shape, so a reader never has to special-case a field present in one bucket and absent
 * in another. */
export interface PruneReportEntry {
  readonly id: string;
  readonly type: RetentionType;
  readonly subject: string;
  readonly relPath: string;
  readonly reason: string;
}
