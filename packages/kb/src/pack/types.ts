/**
 * `PackRequest`, `PinnedCore`, `ContextPack` — `05` §5.4's context pack, corrected to all seven of
 * its own pinned-core items (`SPEC-QUESTIONS.md` Q54).
 *
 * @see specs/05 §5.4
 * @see specs/08 §8.5
 * @see specs/18 §18.2
 * @see SPEC-QUESTIONS.md Q54
 * @see PLAN-M3.md P9
 */

/**
 * `05` §5.4 point 1's own seven pinned-core items. `glossary`/`constraints`/`adrIndex`/
 * `codingStandards` are always computed from the KB tree (`SPEC-QUESTIONS.md` Q54) — never supplied
 * by a caller. `projectIdentity`/`level`/`stageGoal` are not KB data (config and run-state this
 * package cannot depend on) and only ever come from `PackRequest.pinnedCoreOverrides`.
 */
export interface PinnedCore {
  readonly projectIdentity?: string;
  readonly level?: string;
  readonly glossary: string;
  readonly constraints: string;
  readonly adrIndex: string;
  readonly stageGoal?: string;
  readonly codingStandards: string;
}

export interface PackRequest {
  readonly declaredInputIds: readonly string[];
  readonly briefText: string;
  readonly budgetTokens: number;
  /** Any field here wins over this piece's own computed value — `projectIdentity`/`level`/
   * `stageGoal` have no other source at all (this package cannot depend on config or run-state), and
   * the KB-derived fields accept an override too, matching this interface's own literal
   * `Partial<PinnedCore>` shape (`PLAN-M3.md` P9), for a caller with a real reason to supply one. */
  readonly pinnedCoreOverrides?: Partial<PinnedCore>;
}

export interface PackedEntry {
  readonly id: string;
  readonly content: string;
}

export interface RetrievedEntry extends PackedEntry {
  readonly score: number;
}

/** `18` §18.2's own `context.json`: "context pack manifest (ids + token counts, not content)."
 * Covers `declaredInputs`/`retrieved` only — real, individually-addressable KB ids; `pinnedCore`'s
 * four KB-derived fields are aggregated summaries with no single id of their own in this output shape
 * (`SPEC-QUESTIONS.md` Q54, point 5). */
export interface ContextPackManifest {
  readonly ids: readonly string[];
  readonly tokenCounts: Readonly<Record<string, number>>;
}

export interface ContextPack {
  readonly pinnedCore: PinnedCore;
  readonly declaredInputs: readonly PackedEntry[];
  readonly retrieved: readonly RetrievedEntry[];
  readonly manifest: ContextPackManifest;
}
