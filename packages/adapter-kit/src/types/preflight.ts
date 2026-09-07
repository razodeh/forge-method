/**
 * `PreflightContext`/`PreflightResult`/`PreflightIssue`/`ModelInfo` — none given a field-level shape
 * anywhere in the spec pack; designed here from `07` §7.2's own one-line description of each method.
 * See `SPEC-QUESTIONS.md` Q58 points 1–3.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */

/** `env` is passed explicitly, never read from `process.env` ambiently inside an adapter — the same
 * determinism stance `SessionRequest.env` already takes (Q58 point 1). */
export interface PreflightContext {
  readonly projectRoot: string;
  readonly env: Readonly<Record<string, string>>;
}

/** The same `code`/`message`/`remedy` shape `ForgeError` already uses everywhere else in this
 * codebase (Q58 point 2) — preflight can find more than one real problem at once (not installed *and*
 * wrong version), so `PreflightResult` carries a list, not one error. */
export interface PreflightIssue {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
}

export interface PreflightResult {
  readonly ok: boolean;
  readonly version?: string;
  readonly issues: readonly PreflightIssue[];
}

/** "Models this platform can currently use, for tier mapping validation" (`07` §7.2) — `id` is the
 * one field a tier-mapping comparison actually needs; `displayName`/`contextWindowTokens` are what a
 * `forge doctor`-style report would show a human (Q58 point 3). */
export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindowTokens?: number;
}
