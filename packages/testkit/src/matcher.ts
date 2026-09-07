/**
 * `SessionRequestMatcher` — a plain predicate, not a structured matcher object (`{prompt?, model?,
 * ...}`). `07` §7.2's own `SessionRequest` has enough fields that a structured matcher DSL would
 * eventually need to cover most of them anyway (prompt substring vs. exact vs. regex; stepId; model;
 * ...) — a predicate is strictly more expressive, is what both `FakeSessionScript` registration and
 * `injectFailure` need identically, and needs no DSL this package would have to invent and maintain.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q61 point 1
 * @see PLAN-M4.md P5
 */
import type { SessionRequest } from '@forge/adapter-kit/types';

export type SessionRequestMatcher = (request: SessionRequest) => boolean;
