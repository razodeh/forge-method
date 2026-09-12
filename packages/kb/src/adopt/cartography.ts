/**
 * `assembleCartography` — `17` §17.2 phase 3 (CARTOGRAPHY)'s own pure assembly step: takes whatever raw
 * claims an `architect`/`data-architect` dispatch produced (`@forge/engine/adopt`'s own job, per the
 * layering resolution recorded in `SPEC-QUESTIONS.md`'s P16 entry) and the real `EvidenceIndex` P15's
 * SURVEY/INVENTORY output builds, and returns only the claims every one of whose citations resolves
 * against that index — "every claim cites evidence from phases 1-2... a claim with no citable evidence
 * is rejected at assembly time, not merely discouraged by prompt wording" (`PLAN-M10.md` P16), enforced
 * here structurally rather than left to an LLM's own good behaviour.
 *
 * Also implements phase 3's own "highest-value finding" call-out directly: `flagSharedWriteTables`
 * groups every *accepted* `data-ownership` finding by table name and flags any table more than one
 * component claims to write, immediately and unconditionally — never gated behind a caller opting in.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import type { KbEntryConfidence } from '../schema/kb-entry.ts';
import { isKnownEvidence, type EvidenceIndex, type EvidenceRef } from './evidence.ts';

export type CartographyClaimKind =
  'component' | 'layering' | 'runtime-topology' | 'data-ownership' | 'critical-path';

/**
 * One claim as a dispatched session reported it — untrusted until `assembleCartography` checks it.
 * `component`/`owner` are used only by `data-ownership` claims (`flagSharedWriteTables` reads them);
 * every other kind leaves them `undefined`. `confidence` is the claim's own self-reported rating —
 * CARTOGRAPHY, unlike INFERENCE, is not confidence-capped (`17` §17.2: "confidence high where
 * structurally evidenced"), so this is passed through to the accepted `CartographyFinding` unchanged,
 * not clamped.
 */
export interface RawCartographyClaim {
  readonly kind: CartographyClaimKind;
  readonly statement: string;
  readonly evidence: readonly EvidenceRef[];
  readonly confidence: KbEntryConfidence;
  /** `data-ownership` only: the table/collection this claim says is written. */
  readonly table?: string;
  /** `data-ownership` only: the component this claim says writes `table`. */
  readonly owner?: string;
}

export interface CartographyFinding {
  readonly kind: CartographyClaimKind;
  readonly statement: string;
  readonly evidence: readonly EvidenceRef[];
  readonly confidence: KbEntryConfidence;
  readonly table?: string;
  readonly owner?: string;
}

export interface RejectedCartographyClaim {
  readonly claim: RawCartographyClaim;
  readonly reason: string;
}

export interface SharedWriteTableFinding {
  readonly table: string;
  readonly owners: readonly string[];
}

export interface CartographyResult {
  readonly findings: readonly CartographyFinding[];
  readonly rejected: readonly RejectedCartographyClaim[];
  readonly sharedWriteTables: readonly SharedWriteTableFinding[];
}

/**
 * A claim is citable only when it names at least one piece of evidence and *every* named piece resolves
 * against `index` — a claim mixing one real citation with one fabricated one is rejected whole, not
 * accepted on the strength of its real half: partial credit here would let a fabricated component ride
 * in alongside one genuine, unrelated fact, which is precisely the "confident fabrication" `17` §17.1
 * names as brownfield ingestion's core risk.
 */
export function validateClaimEvidence(
  claim: RawCartographyClaim,
  index: EvidenceIndex,
): string | undefined {
  if (claim.evidence.length === 0) return 'no evidence cited';
  const unknown = claim.evidence.find((ref) => !isKnownEvidence(ref, index));
  if (unknown !== undefined) {
    const named = unknown.kind === 'path' ? unknown.path : unknown.description;
    return `evidence not found in SURVEY/INVENTORY: ${named}`;
  }
  if (
    claim.kind === 'data-ownership' &&
    (claim.table === undefined ||
      claim.table.trim().length === 0 ||
      claim.owner === undefined ||
      claim.owner.trim().length === 0)
  ) {
    return 'data-ownership claim missing table or owner';
  }
  return undefined;
}

function flagSharedWriteTables(
  findings: readonly CartographyFinding[],
): readonly SharedWriteTableFinding[] {
  const ownersByTable = new Map<string, Set<string>>();
  for (const finding of findings) {
    if (finding.kind !== 'data-ownership' || finding.table === undefined) continue;
    const owners = ownersByTable.get(finding.table) ?? new Set<string>();
    // An empty/whitespace-only `owner` is not a real component name -- treating it as a distinct
    // owner would flag two claims as "shared" when one of them names no owner at all, or collapse two
    // genuinely different empty self-reports into one, misleadingly non-shared entry. Neither claim's
    // own `table`/`owner` pair loses its evidence backing by being excluded here; it simply contributes
    // nothing to the owner *set* for this table.
    if (finding.owner !== undefined && finding.owner.trim().length > 0) owners.add(finding.owner);
    ownersByTable.set(finding.table, owners);
  }
  const shared: SharedWriteTableFinding[] = [];
  for (const [table, owners] of ownersByTable) {
    if (owners.size > 1) {
      shared.push({ table, owners: [...owners].sort() });
    }
  }
  return shared.sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
}

/**
 * Runs every raw claim through `validateClaimEvidence`, splitting the result into `findings` (real,
 * evidence-backed claims) and `rejected` (claims that failed, with the reason) — a rejected claim never
 * silently vanishes, so a caller (or a test) can always see what was refused and why. `sharedWriteTables`
 * is derived only from `findings`, never from a rejected claim's own unverified `table`/`owner` fields.
 */
export function assembleCartography(
  rawClaims: readonly RawCartographyClaim[],
  index: EvidenceIndex,
): CartographyResult {
  const findings: CartographyFinding[] = [];
  const rejected: RejectedCartographyClaim[] = [];
  for (const claim of rawClaims) {
    const reason = validateClaimEvidence(claim, index);
    if (reason === undefined) {
      findings.push({
        kind: claim.kind,
        statement: claim.statement,
        evidence: claim.evidence,
        confidence: claim.confidence,
        ...(claim.table === undefined ? {} : { table: claim.table }),
        ...(claim.owner === undefined ? {} : { owner: claim.owner }),
      });
    } else {
      rejected.push({ claim, reason });
    }
  }
  return { findings, rejected, sharedWriteTables: flagSharedWriteTables(findings) };
}
