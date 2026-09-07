/**
 * `estimateTokens` — a documented, deterministic, dependency-free token-count approximation.
 *
 * No tokenizer library is named anywhere in the spec pack for this purpose, and matching whichever
 * model actually renders a step's prompt is an adapter-layer concern this package has no visibility
 * into (the identical reasoning `@forge/extensions/skills`' own `approximateTokenCount` already gives
 * for the same ~4-characters-per-token ratio). Reimplemented here, not imported: `@forge/kb` cannot
 * depend on `@forge/extensions` (the package graph runs the other way), so the same ratio is kept for
 * consistency across the codebase rather than picking a different one for no reason.
 *
 * @see PLAN-M3.md P9
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
