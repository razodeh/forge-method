/**
 * Types for `@forge/agents/prompt` — `05` §5.3's nine-block prompt compiler.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A5
 */
import type { AgentToolGrant, AgentLimits } from '../schema/types.ts';

/** `15` §15.5.2's own three-value project autonomy setting (`@forge/schemas/config`'s
 * `configSchema.autonomy`) — this piece cannot import the zod-inferred `Config` type directly (no
 * boundary-graph edge from `agents` to a config-parsing package), so the three literal values are
 * re-declared here, the same "duplicate a small shape rather than force a disallowed cross-package
 * edge" precedent A4 already established for `StepContext`. */
export type AutonomyLevel = 'supervised' | 'guided' | 'autonomous';

/**
 * Block [6]'s own real content — `05` §5.3's own "tool grants, forbidden actions, budget, autonomy
 * level". `tools` reuses the base document's own `AgentToolGrant` shape (the step's actually-granted
 * tools, not necessarily the agent's full base-document grant — a caller may narrow it per step); an
 * empty `forbiddenActions` array is a real, valid "nothing is specifically forbidden beyond the
 * granted tools themselves" state, not an omission.
 */
export interface PromptConstraints {
  readonly tools: AgentToolGrant;
  readonly forbiddenActions: readonly string[];
  readonly budget: AgentLimits;
  readonly autonomy: AutonomyLevel;
}

/** One of the nine ordered blocks `compilePrompt` assembles, kept individually addressable so a test
 * can assert on one block's own content without parsing the joined `CompiledPrompt.text`. */
export interface CompiledPromptBlock {
  readonly index: number;
  readonly name: string;
  readonly content: string;
}

export interface CompiledPrompt {
  readonly blocks: readonly CompiledPromptBlock[];
  /** The nine blocks joined into the one real system-prompt string a session actually receives. */
  readonly text: string;
}
