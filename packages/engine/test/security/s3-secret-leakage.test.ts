/**
 * `20` §20.10 S3 — "Secrets never appear in any file under `.forge/` or `docs/forge/` after a fixture
 * run."
 *
 * **A real, disclosed Surface deviation, the same kind `PLAN-M11.md` P9 already established for S1**:
 * `PLAN-M11.md` P10's own mandate names `packages/kb/test/security/s3-secret-leakage.test.ts` as this
 * invariant's file. Confirmed directly before writing anything (`tools/eslint-plugin-forge-boundaries/
 * src/graph.mjs`): `kb: ['core', 'schemas', 'diagrams']` — no edge to `engine`, `telemetry`,
 * `adapter-kit`, `testkit`, or `extensions`. A real "fixture run" (the engine's own step-dispatch
 * pipeline, a scripted adapter, a real on-disk event log) and `@forge/extensions`'s own `SECRET_PATTERNS`
 * (this invariant's own stated detection oracle) are both structurally unreachable from `@forge/kb`'s
 * own test tree — the identical class of "the plan's own stated location cannot exist" finding P9 made
 * for S1's own `packages/vcs` location. This file lives in `@forge/engine`'s own `test/security/`
 * instead, alongside S2/S6, the one package with every edge this test genuinely needs.
 *
 * **A real, previously-unknown gap this piece found and fixed, not merely tested around.** Direct
 * inspection of `@forge/telemetry`'s own `redactPayload`/`appendEvent` (the one real mechanism that runs
 * on every event before it reaches `.forge/state/runs/<runId>/events.ndjson`) found exactly two checks:
 * `redactPatterns`, matched against payload *key names* (`api[_-]?key`, `authorization` — words you'd
 * expect as a field name), and `knownSecrets`, matched against string *values* by *exact* equality
 * (always empty in practice — resolved-secret-value tracking is not wired into any real caller yet,
 * `SPEC-QUESTIONS.md` Q62). Neither check can ever catch a secret-*shaped* value landing in an
 * innocuously-named field — a failed session's own `error.message` (a realistic shape for a tool/API
 * call that echoes a credential back in its own error text), threaded straight through
 * `dispatch/steps.ts`'s `runAgentStep` into the real `StepFailed` event's `payload.message` — and,
 * confirmed directly, `@forge/engine`'s own real production telemetry-facade constructor
 * (`createTelemetryFacade`, `dispatch/facades.ts`) called `appendEvent` with **no options at all**, not
 * even the two checks that do exist. The first assertion below demonstrates this was a real, currently-
 * exploitable leak (skipped once the fix is in place, both are asserted together below instead — see
 * that test's own comment for why a "prove it still leaks on an unpatched facade" assertion is kept as
 * a real, runnable regression rather than deleted once the fix landed).
 *
 * **The fix** (`@forge/telemetry/redact.ts`, `events.ts`; `@forge/engine/dispatch/facades.ts`): a third,
 * additive `valuePatterns` check in `redactPayload`, tested against string *values* by shape rather than
 * exact equality — exactly `SECRET_PATTERNS`' own contract — defaulted into `createTelemetryFacade`'s
 * own real `appendEvent` call, so every real production run gets this for free without any caller
 * needing to remember to opt in.
 *
 * **A disclosed, deliberate scope limit, not a second silent gap**: this test proves the real
 * telemetry-event-log leak is closed — the dominant, reliably-populated `.forge/` file any real fixture
 * run produces through this engine's own dispatch pipeline. `20` §20.5 point 5's own "Output scanning"
 * control (agent output checked *before* it becomes an artifact) is a distinct, entirely unbuilt
 * mechanism this piece did not attempt: an agent's own raw file writes inside a real adapter's lane
 * worktree happen entirely inside that adapter/session sandbox, with no FORGE-owned choke point between
 * "the agent wrote bytes" and "those bytes are part of the lane's own diff" for this piece to intercept
 * without inventing a materially larger new feature (a post-session, pre-merge diff scan) — recorded
 * here and in `SPEC-QUESTIONS.md` rather than silently assumed already covered.
 *
 * @see specs/20 §20.4
 * @see specs/20 §20.5 point 5
 * @see specs/20 §20.10 S3
 * @see SPEC-QUESTIONS.md Q169
 * @see PLAN-M11.md P9
 * @see PLAN-M11.md P10
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import { appendEvent, readEvents } from '@forge/telemetry/events';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import { createTelemetryFacade } from '../../src/dispatch/facades.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext, node } from '../dispatch/helpers.ts';

/** A real-shaped AWS access key id — `SECRET_PATTERNS`' own first pattern (`AKIA[0-9A-Z]{16}`), the
 * exact detection oracle `20` §20.10 S3 names, matched against a value that is realistically fabricated
 * (an AWS-published documentation placeholder, never a real credential). */
const SEEDED_SECRET = 'AKIAIOSFODNN7EXAMPLE';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function tempRepo(prefix: string): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), `forge-security-s3-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function scanEventLogForSecret(projectRoot: string, runId: string): Promise<boolean> {
  let sawSecret = false;
  for await (const event of readEvents(projectRoot, runId)) {
    const raw = JSON.stringify(event);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(raw))) sawSecret = true;
  }
  return sawSecret;
}

describe('S3: secret leakage into the real telemetry event log under .forge/', () => {
  it('reproduces the real, pre-fix gap directly against @forge/telemetry: an unconfigured appendEvent call lets a secret-shaped value straight through to a real on-disk event', async () => {
    const projectRoot = await tempRepo('unpatched');
    const runId = 'run-s3-unpatched';
    // The exact call shape `createTelemetryFacade`'s own predecessor made: no `options` at all.
    await appendEvent(projectRoot, runId, {
      runId,
      ts: new Date(0).toISOString(),
      type: 'AdapterError',
      stepId: 'wf:step',
      payload: { message: `Auth failed for token ${SEEDED_SECRET}` },
    });

    expect(await scanEventLogForSecret(projectRoot, runId)).toBe(true);
  });

  it('the real, fixed createTelemetryFacade redacts the identical payload shape, proving the fix closes the reproduced gap above, not merely a differently-shaped one', async () => {
    const projectRoot = await tempRepo('facade-direct');
    const runId = 'run-s3-facade-direct';
    const now = (() => {
      let tick = 0;
      return () => tick++;
    })();
    const telemetry = createTelemetryFacade(projectRoot, runId, now);

    await telemetry.emit({
      type: 'AdapterError',
      stepId: 'wf:step',
      payload: { message: `Auth failed for token ${SEEDED_SECRET}` },
    });

    expect(await scanEventLogForSecret(projectRoot, runId)).toBe(false);
    const events = [];
    for await (const event of readEvents(projectRoot, runId)) events.push(event);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]?.payload)).toContain('[REDACTED]');
  });

  it('a real fixture run through the full engine dispatch pipeline (executeStep -> a failed FakePlatformAdapter session -> the real StepFailed event) never lands the seeded secret in the real on-disk event log', async () => {
    const projectRoot = await tempRepo('e2e');
    const runId = 'run-s3-e2e';
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      endReason: 'error',
      errorInfo: {
        code: 'UPSTREAM_AUTH_FAILED',
        message: `Auth failed for token ${SEEDED_SECRET}`,
      },
    });
    const ctx = createTestContext({ projectRoot, adapter, runId });
    const stepNode = node({
      id: 'wf:agent',
      kind: 'agent',
      agent: toAgentId('engineer'),
      produces: [],
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('failed');
    expect(await scanEventLogForSecret(projectRoot, runId)).toBe(false);

    // Positive control on the harness itself: confirm the unredacted secret genuinely would have been
    // found had it not been redacted, so "no secret found" above is not merely "the scan never ran."
    const events = [];
    for await (const event of readEvents(projectRoot, runId)) events.push(event);
    const stepFailed = events.find((event) => event.type === 'StepFailed');
    expect(stepFailed).toBeDefined();
    expect(JSON.stringify(stepFailed?.payload)).toContain('[REDACTED]');
  });

  it('negative control: an ordinary, non-secret-shaped failure message is left completely untouched -- proves redaction is scoped to secret-shaped values, not over-redacting arbitrary text', async () => {
    const projectRoot = await tempRepo('negative-control');
    const runId = 'run-s3-negative-control';
    const now = (() => {
      let tick = 0;
      return () => tick++;
    })();
    const telemetry = createTelemetryFacade(projectRoot, runId, now);
    const ordinaryMessage = 'the build failed because tsc exited with code 2';

    await telemetry.emit({
      type: 'AdapterError',
      stepId: 'wf:step',
      payload: { message: ordinaryMessage },
    });

    const events = [];
    for await (const event of readEvents(projectRoot, runId)) events.push(event);
    expect(JSON.stringify(events[0]?.payload)).toContain(ordinaryMessage);
  });
});
