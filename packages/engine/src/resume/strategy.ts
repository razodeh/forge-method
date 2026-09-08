/**
 * `decideResumeStrategy` — `06` §6.10 step 2's own first decision: "resume the adapter session if
 * supported and still valid, else roll [it] back... and re-run." A pure function, deliberately: whether
 * a session id is even worth *attempting* to resume is knowable from `AdapterCapabilities.sessionResume`
 * and the presence of a remembered `sessionId` alone, with no I/O of its own — the same "structural/
 * config errors throw; expected runtime outcomes are data" purity discipline this whole package already
 * holds `Scheduler`'s own admission checks to (`@forge/engine/scheduler`, P12). "Still valid" (this
 * function's own second half) is not something a pure decision can determine without actually attempting
 * the resume: `PlatformAdapter` has no separate "probe a session id" method, only `resumeSession` itself,
 * which either succeeds or throws (`@forge/adapter-kit`'s own `adapter.ts`) — so genuine validity is
 * confirmed empirically, at execution time, by `orchestrate.ts`'s own `resumeAgentStep`, which attempts
 * the resume and falls back to a fresh reroll if that attempt does not succeed, not predicted here in
 * advance.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import type { AdapterCapabilities } from '@forge/adapter-kit';

export type ResumeStrategy = 'resume-session' | 'reroll';

/** `sessionId` is `RunState.sessionIds.get(stepId)` — `undefined` for a step that never reached an
 * acquired session handle at all (`RunState.sessionIds`' own doc comment), which always means `'reroll'`
 * regardless of what the adapter otherwise supports: there is nothing to resume. */
export function decideResumeStrategy(
  sessionId: string | undefined,
  capabilities: AdapterCapabilities,
): ResumeStrategy {
  return capabilities.sessionResume && sessionId !== undefined ? 'resume-session' : 'reroll';
}
