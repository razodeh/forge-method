/**
 * `20` §20.10 S6 — "A tainted step cannot approve a gate, escalate a grant, or target production."
 *
 * `PLAN-M11.md` P10's own mandate named this piece's real investigation target directly: for each of
 * the three named surfaces, does a real, structural enforcement mechanism already exist connecting
 * `20` §20.5 point 3 / `15` §15.5.4's own `taint: external` marker (`@forge/agents`'s own
 * `markExternalContent`) to a refusal — or is the connection merely conventional/undocumented, the way
 * `PLAN-M11.md` P9 found for S2's own hard denylist? Direct inspection before writing any test found:
 *
 * - **No `taint` field existed anywhere in `@forge/engine`'s step/plan/dispatch model at all** —
 *   confirmed by grepping `packages/engine/src` for `taint` before this piece began: zero hits outside
 *   unrelated substring matches ("uncertainty", "reproduction"). `runGateStep` (`dispatch/steps.ts`)
 *   unconditionally emitted `GateApproved` whenever a gate's deterministic checks passed, with no
 *   notion of whether the step that reached that point was ever tainted.
 * - **`markExternalContent` (`@forge/agents/context/mark-external-content.ts`) — the taint-marking
 *   function `20` §20.5 point 3 itself names — had zero real production call sites anywhere in the
 *   workspace**, confirmed directly (`grep -rn "markExternalContent("`  outside its own module/tests):
 *   only mentioned in a doc comment (`cartography.ts`), never actually invoked. The taint concept the
 *   spec describes was, before this piece, wired to nothing at runtime.
 * - **Grant escalation has no live runtime call site**: the only escalation mechanism this codebase
 *   implements, `.forge/config.yaml`'s own `security.toolCeilingEscalations` (`15` §15.3.2), is applied
 *   once, at *compile* time, before any step exists to be tainted.
 * - **Production targeting has exactly one real, typed "which environment" call site**, `forge deploy
 *   <env>` (`@forge/cli`'s own `loop/deploy.ts`) — a top-level, human-invoked CLI verb outside
 *   `@forge/engine`'s own step-dispatch model entirely, not a per-step runtime action.
 *
 * Per this piece's own "fix a real gap, don't just document it" mandate: gate approval — the one of
 * the three with a real, already-wired per-step runtime call site — was fixed for real
 * (`StepNode.taint`, `plan/types.ts`; `assertGateApprovalAllowed`, wired into `runGateStep`,
 * `security/taint-guard.ts`). Grant escalation and production targeting have no live call site to wire
 * into without inventing new, disproportionate runtime behaviour (the identical judgement `PLAN-M11.md`
 * P9 already made for S4's `isHostAllowed`) — both guard functions are real, exported, and tested here
 * directly with a genuine positive/negative control, and the zero-callers fact is disclosed rather than
 * silently assumed away. Full record in `SPEC-QUESTIONS.md`.
 *
 * **Read the gate-approval fix precisely, not more broadly than it is: it closes the *enforcement*
 * half, not the *signal* half.** `taint-guard.ts`'s own doc comment (updated after a gauntlet critic
 * round flagged an earlier draft's framing as overclaiming) says this in full: nothing in this
 * codebase's real compile/dispatch pipeline populates `StepNode.taint` on any real step today
 * (`markExternalContent` has zero production callers), so `assertGateApprovalAllowed` is consulted on
 * every real gate step and correctly allows it, because every real step's `taint` is `undefined`. The
 * tests below prove the check is correct and would fire the moment a real signal exists — not that it
 * fires for any real run today. The same critic round also found a second, taint-blind path to
 * `GateApproved`: `forge gate approve <id>` (`@forge/cli`'s own `run/gate-commands.ts`) emits the event
 * unconditionally, with no taint or `StepNode` concept at all — judged a legitimately separate,
 * human-override channel outside this invariant's own "a tainted **step**" wording (the same class of
 * override `gateWaive` already is), not a bypass to close, but disclosed here and in
 * `SPEC-QUESTIONS.md` rather than left for a future reader to discover.
 *
 * @see specs/15 §15.3.2
 * @see specs/15 §15.5.4
 * @see specs/20 §20.5 point 3
 * @see specs/20 §20.10 S6
 * @see SPEC-QUESTIONS.md
 * @see PLAN-M11.md P9
 * @see PLAN-M11.md P10
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { readEvents } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import {
  assertGateApprovalAllowed,
  assertGrantEscalationAllowed,
  assertProductionTargetAllowed,
} from '../../src/security/taint-guard.ts';
import type { GateDefinition } from '../../src/gates/index.ts';
import { createTestContext, node } from '../dispatch/helpers.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function tempRepo(prefix: string): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), `forge-security-s6-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function gate(overrides: Partial<GateDefinition> & { readonly id: string }): GateDefinition {
  return {
    checks: { deterministic: [], advisory: [] },
    openQuestionsPolicy: 'block',
    ...overrides,
  };
}

/** A gate whose one deterministic check always passes — the adversarial scenario needs "every real
 * check says approve," so a refusal can only be attributed to taint, never to the check itself
 * legitimately failing. */
function alwaysPassingGate(id: string): GateDefinition {
  return gate({
    id,
    checks: {
      deterministic: [{ id: 'check-a', run: `echo '{"errors":0}'`, failOn: 'errors > 0' }],
      advisory: [],
    },
  });
}

describe('S6 surface 1 of 3: gate approval', () => {
  it('a tainted step is refused even though every deterministic check passes -- the real, structural runGateStep path, not a convention', async () => {
    const projectRoot = await tempRepo('gate-tainted');
    const gateRegistry = new Map([['G-Test', alwaysPassingGate('G-Test')]]);
    const ctx = createTestContext({ projectRoot, gateRegistry, runId: 'run-s6-gate-tainted' });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test', taint: 'external' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.source).toBe('gate');
    expect(outcome.failure?.message).toContain('tainted');
    // Structural, not merely "the outcome looks failed": the real GateApproved event must never be
    // emitted for this step, and GateRejected must carry the real reason, both readable back from the
    // real on-disk event log.
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-s6-gate-tainted')) events.push(event);
    expect(events.some((event) => event.type === 'GateApproved')).toBe(false);
    const rejected = events.find((event) => event.type === 'GateRejected');
    expect(rejected).toBeDefined();
    expect(JSON.stringify(rejected?.payload)).toContain('tainted');
  });

  it('negative control: an identical, untainted step with the identical always-passing gate IS approved -- proves the harness can detect a real approval, so the tainted refusal above is not vacuous', async () => {
    const projectRoot = await tempRepo('gate-untainted');
    const gateRegistry = new Map([['G-Test', alwaysPassingGate('G-Test')]]);
    const ctx = createTestContext({ projectRoot, gateRegistry, runId: 'run-s6-gate-untainted' });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-s6-gate-untainted')) events.push(event);
    expect(events.map((event) => event.type)).toContain('GateApproved');
  });

  it('a tainted step whose checks genuinely fail is still refused for the taint reason, not silently reclassified as an ordinary check failure', async () => {
    const projectRoot = await tempRepo('gate-tainted-failing');
    const gateRegistry = new Map([
      [
        'G-Test',
        gate({
          id: 'G-Test',
          checks: {
            deterministic: [{ id: 'check-a', run: `echo '{"errors":5}'`, failOn: 'errors > 0' }],
            advisory: [],
          },
        }),
      ],
    ]);
    const ctx = createTestContext({
      projectRoot,
      gateRegistry,
      runId: 'run-s6-gate-tainted-failing',
    });
    const stepNode = node({ id: 'wf:gate', kind: 'gate', gate: 'G-Test', taint: 'external' });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('tainted');
  });
});

describe('S6 surface 2 of 3: grant escalation', () => {
  it('assertGrantEscalationAllowed refuses a tainted attempt', () => {
    const decision = assertGrantEscalationAllowed('external');
    expect(decision.refused).toBe(true);
    if (decision.refused) expect(decision.reason).toContain('escalate a tool grant');
  });

  it('negative control: an untainted attempt is allowed -- proves the guard genuinely discriminates rather than always refusing', () => {
    const decision = assertGrantEscalationAllowed(undefined);
    expect(decision.refused).toBe(false);
  });
});

describe('S6 surface 3 of 3: production targeting', () => {
  it('assertProductionTargetAllowed refuses a tainted step targeting "production"', () => {
    const decision = assertProductionTargetAllowed('external', 'production');
    expect(decision.refused).toBe(true);
    if (decision.refused) expect(decision.reason).toContain('production');
  });

  it('assertProductionTargetAllowed refuses a tainted step targeting the "prod" spelling too -- a guard that only recognised one spelling would be trivially bypassed by the other', () => {
    const decision = assertProductionTargetAllowed('external', 'prod');
    expect(decision.refused).toBe(true);
  });

  it('negative control: a tainted step targeting a non-production environment is allowed by this guard -- proves the refusal above is keyed on "production," not merely on taint alone', () => {
    const decision = assertProductionTargetAllowed('external', 'staging');
    expect(decision.refused).toBe(false);
  });

  it('negative control: an untainted step targeting production is allowed -- proves the guard genuinely discriminates on taint, not merely always refusing production', () => {
    const decision = assertProductionTargetAllowed(undefined, 'production');
    expect(decision.refused).toBe(false);
  });
});

describe('S6: gate-approval guard function itself, independent of runGateStep', () => {
  it('assertGateApprovalAllowed is the exact predicate runGateStep consults -- refuses tainted, allows untainted', () => {
    expect(assertGateApprovalAllowed('external').refused).toBe(true);
    expect(assertGateApprovalAllowed(undefined).refused).toBe(false);
  });
});
