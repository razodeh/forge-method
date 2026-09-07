/**
 * `AssetContext`/`InstalledAsset` — no field-level shape given anywhere in the spec pack; designed
 * from `07` §7.2's own description: "write platform-native assets (agent files, commands) into the
 * host project." See `SPEC-QUESTIONS.md` Q58 point 5.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q58
 * @see PLAN-M4.md P1
 */
export interface AssetContext {
  readonly projectRoot: string;
  readonly agents: readonly { readonly id: string; readonly displayName: string }[];
}

export interface InstalledAsset {
  readonly path: string;
  readonly kind: string;
}
