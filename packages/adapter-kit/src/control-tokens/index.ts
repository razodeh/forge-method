/**
 * `@forge/adapter-kit/control-tokens` — `05` §5.5's control-token parser and `20` §20.5's
 * untrusted-content wrapper/stripper (points 1–2; taint propagation, structural defence and output
 * scanning are engine concerns, later milestones).
 *
 * @see specs/05 §5.5
 * @see specs/20 §20.5
 * @see PLAN-M4.md P3
 */
export { parseControlTokens, type ParseControlTokensResult } from './parse.ts';
export { stripControlTokens, type StripControlTokensResult } from './strip.ts';
export { wrapUntrustedContent, type WrapUntrustedContentResult } from './wrap.ts';
