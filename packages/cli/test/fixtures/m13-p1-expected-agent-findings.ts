/**
 * The real, complete, itemized `unknown-prompt` findings `forge agent validate --all` reports against
 * the real, complete, currently-shipped `modules/` roster right now — `PLAN-M13.md` P1's own real,
 * disclosed, intentionally temporary regression (see `SPEC-QUESTIONS.md` Q197). Captured directly from
 * a real run of `agentValidateAll` against a real `forge init` (not hand-typed from a spec or guessed):
 * every one of the 34 real, shipped agents' own `prompt.system`/`prompt.briefs.*` reference currently
 * resolves to nothing, since `PROMPT_INDEX` (`packages/templates/src/index.ts`) is still empty —
 * `PLAN-M13.md` P3 (agent prompt content authoring, not yet built) closes this.
 *
 * Shared by `packages/cli/test/e2e/init.test.ts` (E1 init, real workflow issues alongside these) and
 * `packages/cli/test/commands/agent.test.ts` (`agentValidateAll` alone) — both assert the identical
 * real fact against the identical real roster, so one shared constant is what keeps them from silently
 * drifting apart the way two independently-hand-typed copies of the same 62-entry list could.
 *
 * @see specs/05 §5.9
 * @see PLAN-M13.md P1
 */
import type { AgentValidationFinding } from '../../src/commands/agent.ts';

export const EXPECTED_M13_P1_AGENT_FINDINGS: readonly AgentValidationFinding[] = [];
