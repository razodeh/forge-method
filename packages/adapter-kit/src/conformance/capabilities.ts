/**
 * C8 (structured output), C9 (resume), C15 (skill scoping), C16 (MCP grant fidelity) — `07` §7.6's own
 * table, verbatim, plus `15` §15.6's C15/C16 addition. Each is gated on the adapter honestly reporting
 * the relevant capability or implementing the relevant optional method — skipped, not failed, when it
 * doesn't (`SPEC-QUESTIONS.md` Q60 point 4): failing an adapter for correctly declaring a capability it
 * does not have would contradict `07` §7.2's own optional-method design. The gating (skip-or-run) lives
 * only in the `it()` wrapper below; each `checkC*` function itself unconditionally assumes it should
 * run (throwing plainly if its own precondition somehow still isn't met) so this piece's own test file
 * can invoke one directly against a deliberately non-compliant stub adapter — outside any vitest test
 * context, with no `skip()` available — and assert it rejects.
 *
 * @see specs/07 §7.6
 * @see specs/15 §15.6
 * @see SPEC-QUESTIONS.md Q60
 * @see PLAN-M4.md P4
 */
import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../types/events.ts';
import type { SkillProvisioning } from '../types/provisioning.ts';
import type { ConformanceContext } from './context.ts';
import { collectEvents, withTimeout } from './helpers.ts';

function textOf(events: readonly AdapterEvent[], finalText: string): string {
  const streamed = events.flatMap((event) => (event.type === 'text' ? [event.text] : []));
  return [finalText, ...streamed].join('\n');
}

export async function checkC8StructuredOutput(context: ConformanceContext): Promise<void> {
  const fixture = context.options.structured;
  if (fixture === undefined) {
    throw new Error('C8: no structured fixture was supplied.');
  }

  const cwd = await context.options.createScratchDir();
  const handle = await context
    .getAdapter()
    .startSession(
      context.buildRequest({ cwd, prompt: fixture.prompt, outputSchema: fixture.schema }),
    );
  await withTimeout(collectEvents(handle), 30000, 'C8: session did not end within 30s');
  const result = await withTimeout(handle.result(), 5000, 'C8: result() did not settle within 5s');

  expect(fixture.isValid(result.structured)).toBe(true);
}

export async function checkC9Resume(context: ConformanceContext): Promise<void> {
  const fixture = context.options.resume;
  if (fixture === undefined) {
    throw new Error('C9: no resume fixture was supplied.');
  }

  const adapter = context.getAdapter();
  const cwd = await context.options.createScratchDir();
  const initialHandle = await adapter.startSession(
    context.buildRequest({ cwd, prompt: fixture.initialPrompt }),
  );
  await withTimeout(
    collectEvents(initialHandle),
    30000,
    'C9: initial session did not end within 30s',
  );
  await withTimeout(initialHandle.result(), 5000, 'C9: initial result() did not settle within 5s');

  const resumedHandle = await adapter.resumeSession(initialHandle.sessionId, {
    prompt: fixture.probePrompt,
    limits: {},
    abortSignal: new AbortController().signal,
  });
  const resumedEvents = await withTimeout(
    collectEvents(resumedHandle),
    30000,
    'C9: resumed session did not end within 30s',
  );
  const resumedResult = await withTimeout(
    resumedHandle.result(),
    5000,
    'C9: resumed result() did not settle within 5s',
  );

  expect(textOf(resumedEvents, resumedResult.finalText)).toContain(fixture.expectedFragment);
}

export async function checkC15SkillScoping(context: ConformanceContext): Promise<void> {
  const adapter = context.getAdapter();
  const fixture = context.options.skill;
  if (fixture === undefined) {
    throw new Error('C15: no skill fixture was supplied.');
  }

  const cwd = await context.options.createScratchDir();
  const sessionCtx = { runId: 'conformance-run', stepId: 'conformance-c15', cwd };
  const provisioning = await adapter.provisionSkills?.([fixture.skill], sessionCtx);
  if (provisioning === undefined) {
    throw new Error('C15: provisionSkills is not implemented, or unexpectedly returned undefined.');
  }
  expect(provisioning.provisionedSkillIds).toContain(fixture.skill.id);

  // "The declared degradation strategy is applied when skills !== 'native'" (07 §7.6's own C15 row) —
  // a gauntlet critic found this half of the row was never checked at all. 15 §15.6's own provisioning
  // table gives the exact mapping: skills:'native' -> strategy:'native'; skills:'inline' ->
  // strategy:'inline'; skills:'none' -> strategy:'bodies-injected' (the table's own words: "inject the
  // highest-priority skills' bodies up to budget").
  const capabilities = context.getCapabilities();
  const expectedStrategy: SkillProvisioning['strategy'] =
    capabilities.skills === 'native'
      ? 'native'
      : capabilities.skills === 'inline'
        ? 'inline'
        : 'bodies-injected';
  expect(provisioning.strategy).toBe(expectedStrategy);

  const handle = await adapter.startSession(
    context.buildRequest({
      cwd,
      prompt: fixture.prompt,
      runId: sessionCtx.runId,
      stepId: sessionCtx.stepId,
    }),
  );
  const events = await withTimeout(
    collectEvents(handle),
    30000,
    'C15: session did not end within 30s',
  );
  const result = await withTimeout(handle.result(), 5000, 'C15: result() did not settle within 5s');
  expect(textOf(events, result.finalText)).toContain(fixture.expectedFragment);

  // Not leaked into an unprovisioned lane: the identical probe prompt, run in a fresh cwd/step that
  // never had provisionSkills called for it, must not surface the skill's own marker text. This is a
  // behavioural proxy, not a filesystem check — a gauntlet critic correctly noted the row's own "or the
  // user's global config" clause (e.g. persistent contamination of a real ~/.claude/skills/-style
  // directory) has no generic, adapter-agnostic path this suite can inspect directly, so it goes
  // unverified by this check; recorded here rather than silently assumed covered.
  const otherCwd = await context.options.createScratchDir();
  const otherHandle = await adapter.startSession(
    context.buildRequest({ cwd: otherCwd, prompt: fixture.prompt }),
  );
  const otherEvents = await withTimeout(
    collectEvents(otherHandle),
    30000,
    'C15: unprovisioned session did not end within 30s',
  );
  const otherResult = await withTimeout(
    otherHandle.result(),
    5000,
    'C15: unprovisioned result() did not settle within 5s',
  );
  expect(textOf(otherEvents, otherResult.finalText)).not.toContain(fixture.expectedFragment);
}

export async function checkC16McpGrantFidelity(context: ConformanceContext): Promise<void> {
  const adapter = context.getAdapter();
  const fixture = context.options.mcp;
  if (fixture === undefined) {
    throw new Error('C16: no mcp fixture was supplied.');
  }

  const cwd = await context.options.createScratchDir();
  const sessionCtx = { runId: 'conformance-run', stepId: 'conformance-c16', cwd };
  const provisioning = await adapter.provisionMcp?.([fixture.server], sessionCtx);
  if (provisioning === undefined) {
    throw new Error('C16: provisionMcp is not implemented, or unexpectedly returned undefined.');
  }
  // Only the one granted server was ever offered, so an ungranted server being "absent from the
  // session's reported server list" means loadedServerIds is exactly this server's id, nothing more.
  // A gauntlet critic correctly noted this checks provisionMcp's own self-reported return value, called
  // before startSession even runs — 15 §15.6's own mcp:true strategy row separately prescribes verifying
  // the loaded-server list "from the session's init metadata," which this does not cross-check (nothing
  // in AdapterEvent gives a *typed* place to read that from generically — session.started.meta is an
  // untyped Record<string, unknown>, the same opacity trade-off already named for C4/C5). Recorded here
  // explicitly as a known limitation, not silently assumed away.
  expect(provisioning.loadedServerIds).toEqual([fixture.server.id]);

  const handle = await adapter.startSession(
    context.buildRequest({
      cwd,
      prompt: fixture.prompt,
      runId: sessionCtx.runId,
      stepId: sessionCtx.stepId,
      // See filesystem.ts's checkC3ToolRestriction doc comment -- the identical, live-confirmed
      // reason: grant fidelity (an ungranted tool genuinely denied) is meaningless under
      // `buildRequest`'s own default `'auto'` permission mode.
      permissionMode: 'deny-unlisted',
    }),
  );
  const events = await withTimeout(
    collectEvents(handle),
    30000,
    'C16: session did not end within 30s',
  );
  await withTimeout(handle.result(), 5000, 'C16: result() did not settle within 5s');

  const nameByCallId = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'tool.call') nameByCallId.set(event.id, event.name);
  }
  const okByToolName = new Map<string, boolean>();
  for (const event of events) {
    if (event.type === 'tool.result') {
      const name = nameByCallId.get(event.id);
      if (name !== undefined) okByToolName.set(name, event.ok);
    }
  }

  expect(okByToolName.get(fixture.allowedToolName)).toBe(true);
  const deniedOutcome = okByToolName.get(fixture.deniedToolName);
  // "Denied" is either an unsuccessful call (ok: false) or no call at all (the adapter refused to
  // expose the tool in the first place) — both are acceptable ways to prevent an ungranted tool from
  // being used.
  expect(deniedOutcome === false || deniedOutcome === undefined).toBe(true);
}

export function registerCapabilityGatedTests(context: ConformanceContext): void {
  // Each `it()` below skips only on the adapter's own honest capability/method report — never on a
  // missing fixture too. A gauntlet critic found the original version skipped on *either* condition,
  // which meant an adapter that genuinely implements (say) `provisionMcp` but whose conformance run
  // simply forgot to supply an `mcp` fixture was silently skipped rather than failed — for C16, one of
  // the five cases `07` §7.6 says "MUST be rejected at load time," that loophole meant the guarantee
  // was only as strong as "nobody forgot a fixture." Each `checkC*` function already throws its own
  // clear "no such-and-such fixture was supplied" error when called with the capability present but the
  // fixture absent (see their own precondition guards, above) — that is deliberately what now surfaces
  // as a real, loud test failure instead of a silent skip.
  describe('C8 — structured output', () => {
    it('result.structured validates against the supplied schema when structuredOutput is reported', async (testCtx) => {
      const capabilities = context.getCapabilities();
      testCtx.skip(!capabilities.structuredOutput, 'adapter does not report structuredOutput');
      await checkC8StructuredOutput(context);
    });
  });

  describe('C9 — resume', () => {
    it('a resumed session retains prior context when sessionResume is reported', async (testCtx) => {
      const capabilities = context.getCapabilities();
      testCtx.skip(!capabilities.sessionResume, 'adapter does not report sessionResume');
      await checkC9Resume(context);
    });
  });

  describe('C15 — skill scoping', () => {
    it('a provisioned skill is visible to its own session and not to an unprovisioned one', async (testCtx) => {
      testCtx.skip(
        context.getAdapter().provisionSkills === undefined,
        'adapter does not implement provisionSkills',
      );
      await checkC15SkillScoping(context);
    });
  });

  describe('C16 — MCP grant fidelity', () => {
    it('a granted tool succeeds, an ungranted tool is denied, ungranted servers are absent', async (testCtx) => {
      testCtx.skip(
        context.getAdapter().provisionMcp === undefined,
        'adapter does not implement provisionMcp',
      );
      await checkC16McpGrantFidelity(context);
    });
  });
}
