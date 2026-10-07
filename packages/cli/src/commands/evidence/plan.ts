/**
 * `computeProtection`/`computeStillReferenced` — the pure decision logic `forge evidence prune`
 * builds on, kept free of any filesystem or clock access so it is testable as plain data in and data
 * out (`QUALITY-BAR.md` §1.3's "pure packages... testable with a builder, asserting the whole
 * result").
 *
 * `18` §18.7 (Retention): "What survives is computed to a fixed point: it starts from what `--keep`
 * and the highest-id rule keep, and adds whatever a surviving record, or a store outside the evidence
 * records, references, until nothing more is added, so a record referenced only by a record this
 * prune removes is not protected, and the outcome does not depend on the order in which records are
 * visited." `computeProtection` below is exactly that: a seed (newest `n` per (type, subject), the
 * highest id of each type, every gate-cited specific id), then a `while`-loop propagation through
 * every SURVIVING `EvidenceBundle`'s own reference lists, run to a fixed point rather than a single
 * pass (`process/SPEC-QUESTIONS.md` Q294 Decision 9's own worked example: a bundle kept only by an
 * external citation must still protect what IT references, which a single union computed before that
 * citation is applied would miss).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 * @see process/SPEC-QUESTIONS.md Q294 Decision 9
 */
import type {
  EvidenceEnumeration,
  EvidenceRecordInfo,
  PruneReason,
  RetentionType,
} from './types.ts';

/** The result of {@link computeProtection}: which ids survive, and why — one reason per id, the FIRST
 * one that granted it protection (a record can be protected for more than one real reason at once;
 * `18` §18.7 only ever asks for ONE reason to report, not an exhaustive list of every reason that
 * would independently suffice). */
export interface ProtectionResult {
  readonly protectedIds: ReadonlySet<string>;
  readonly reasons: ReadonlyMap<string, PruneReason>;
}

/** Groups `records` by `(type, subject)` — the exact key `18` §18.7's "newest `n` per type and
 * subject" counts against. A plain string join rather than a nested `Map<RetentionType, Map<string,
 * ...>>`: the three retention types' own id prefixes are already globally distinct (`MUT-`/`EVID-`/
 * `PAR-`), so no subject string from one type could ever collide with another's under this key, and a
 * single flat `Map` is simpler to iterate than two nested ones for no loss of correctness. */
function groupKey(type: RetentionType, subject: string): string {
  return `${type}\u0000${subject}`;
}

function groupRecords(
  records: readonly EvidenceRecordInfo[],
): ReadonlyMap<string, EvidenceRecordInfo[]> {
  const groups = new Map<string, EvidenceRecordInfo[]>();
  for (const record of records) {
    const key = groupKey(record.type, record.subject);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [record]);
    else group.push(record);
  }
  return groups;
}

/**
 * Computes the full, fixed-point set of ids `forge evidence prune` must not remove, and the reason
 * each one survives.
 *
 * `keep` must already be a validated positive integer (`prune-command.ts`'s own `--keep` check runs
 * before this is ever called) — this function trusts its caller and does not re-validate it.
 */
export function computeProtection(
  enumeration: EvidenceEnumeration,
  keep: number,
): ProtectionResult {
  const protectedIds = new Set<string>();
  const reasons = new Map<string, PruneReason>();
  const protect = (id: string, reason: PruneReason): void => {
    if (protectedIds.has(id)) return;
    protectedIds.add(id);
    reasons.set(id, reason);
  };

  // Seed 1: the newest `keep` records per (type, subject), "newest" meaning highest id (§18.7).
  for (const group of groupRecords(enumeration.records).values()) {
    const newestFirst = [...group].sort((a, b) => b.numericId - a.numericId);
    for (const record of newestFirst.slice(0, keep)) {
      protect(record.id, { kind: 'newest', keep });
    }
  }

  // Seed 2: the highest id of each type, globally (across every subject) — `n >= 1` already implies
  // this for a type with at least one subject's worth of records, but §18.7 states it as its own,
  // explicit rule because the allocator's no-reuse guarantee rests on it, so it is enforced here
  // directly rather than left as a consequence this function would merely happen to produce.
  const highestByType = new Map<RetentionType, EvidenceRecordInfo>();
  for (const record of enumeration.records) {
    const current = highestByType.get(record.type);
    if (current === undefined || record.numericId > current.numericId) {
      highestByType.set(record.type, record);
    }
  }
  for (const record of highestByType.values()) {
    protect(record.id, { kind: 'highest-id' });
  }

  // Seed 3: a gate definition's own specific-id evidence citation (`process/SPEC-QUESTIONS.md` Q294
  // Decision 9's "a gate approval or waiver" store) — only when the cited id actually names a real
  // record this enumeration found; a citation naming an id nothing on disk matches cannot protect
  // something that does not exist, and is this command's job neither to create nor to complain about
  // (a stale gate reference is `gate-commands.ts`'s own, separate concern at approval time).
  const realIds = new Set(enumeration.records.map((record) => record.id));
  for (const citation of enumeration.gateCitations) {
    if (!realIds.has(citation.id)) continue;
    protect(citation.id, {
      kind: 'referenced-by-gate',
      gateId: citation.gateId,
      ref: citation.ref,
    });
  }

  // Propagate to a fixed point: a SURVIVING `EvidenceBundle`'s own references are protected too, and
  // since protecting one can itself be new news to a later iteration (Decision 9's own example), this
  // keeps looping until a full pass adds nothing.
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of enumeration.records) {
      if (record.type !== 'EvidenceBundle' || !protectedIds.has(record.id)) continue;
      for (const referencedId of record.references) {
        if (protectedIds.has(referencedId) || !realIds.has(referencedId)) continue;
        protect(referencedId, { kind: 'referenced-by-record', by: record.id });
        grew = true;
      }
    }
  }

  return { protectedIds, reasons };
}

/**
 * Whether each of `candidateIds` is referenced by a store this enumeration finds, EXCLUDING any
 * `EvidenceBundle` whose own id is in `deadBundleIds` (a bundle this very prune is about to remove:
 * its own citations never counted at pass one either, by the identical "only a surviving record
 * propagates" rule `computeProtection` enforces, so they must not count here either).
 *
 * `18` §18.7: "The stores are enumerated once more after the tombstones are written and before any
 * record is removed... a record referenced since the first enumeration is not removed." This is that
 * SECOND check — deliberately not a second call to `computeProtection` (which would also re-run the
 * `--keep`/highest-id seeding, a question pass one already, permanently, answered): it asks only
 * whether a store now cites one of pass one's own candidates, off a FRESH enumeration taken after the
 * tombstones were written.
 */
export function computeStillReferenced(
  enumeration: EvidenceEnumeration,
  candidateIds: ReadonlySet<string>,
  deadBundleIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const referenced = new Set<string>();
  for (const record of enumeration.records) {
    if (record.type !== 'EvidenceBundle' || deadBundleIds.has(record.id)) continue;
    for (const referencedId of record.references) {
      if (candidateIds.has(referencedId)) referenced.add(referencedId);
    }
  }
  for (const citation of enumeration.gateCitations) {
    if (candidateIds.has(citation.id)) referenced.add(citation.id);
  }
  return referenced;
}
