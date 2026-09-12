/**
 * `executeStep`'s own dispatch-level concerns, distinct from any one handler's own behaviour (covered by
 * `agent.test.ts`/`command.test.ts`/`gate.test.ts`/`merge.test.ts`/`checkpoint.test.ts`): a `StepNode.kind`
 * this milestone does not yet dispatch to throws `RUN-039`, and a `TelemetryError` escaping any handler is
 * caught once, here, and rethrown as the registered `RUN-038` rather than folded into `StepOutcome` data.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P15
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError } from '@forge/core/errors';
import { TelemetryError } from '@forge/telemetry/errors';
import { describe, expect, it } from 'vitest';

import { executeStep } from '../../src/dispatch/execute.ts';
import type { StepNodeKind } from '../../src/plan/index.ts';
import { createTestContext, node } from './helpers.ts';

// Not in helpers.ts: node:os's tmpdir is R10-restricted in production code, and the test-file
// exemption in eslint.config.js only covers files literally named *.test.ts (matching @forge/vcs's own
// test convention of a small, duplicated per-file helper).
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-dispatch-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('executeStep — unsupported kinds', () => {
  // `session` was removed from this list by `PLAN-M10.md` P10: it now has a real handler
  // (`@forge/engine/interaction`'s own `runSessionStep`). `elicit`/`subworkflow` are this piece's own
  // explicit non-scope, unchanged -- see the dedicated regression test below proving that directly.
  it.each<StepNodeKind>(['elicit', 'subworkflow'])(
    'throws RUN-039 for a %s-kind node, which this milestone does not yet dispatch to',
    async (kind) => {
      const projectRoot = await createTempRepo(`execute-unsupported-${kind}`);
      const ctx = createTestContext({ projectRoot });
      const stepNode = node({ id: 'wf:step', kind });

      let caught: unknown;
      try {
        await executeStep(stepNode, ctx);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForgeError);
      if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
    },
  );

  it('no longer throws RUN-039 for a well-formed session-kind node -- PLAN-M10.md P10 gave it a real handler, while elicit/subworkflow stay refused, exactly as scoped', async () => {
    const projectRoot = await createTempRepo('execute-session-real-handler');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({
      id: 'wf:brainstorm',
      kind: 'session',
      sessionType: 'brainstorm',
      brief: 'How should we cut onboarding time',
    });

    const outcome = await executeStep(stepNode, ctx);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.detail.kind).toBe('agent');
  });

  it('throws RUN-039 for a fanout-kind node -- structurally excluded from a real compiled plan, but a hand-built one reaches this guard directly', async () => {
    // Matches RUN-036's own precedent (@forge/engine/scheduler, P12) for the identical class of guard:
    // kept as a real runtime check and tested directly against a hand-built node, documented as
    // provably unreachable through this module's own real callers (compilePlan always expands a fanout
    // step into per-item children of a different kind before a StepNode ever reaches this dispatcher).
    const projectRoot = await createTempRepo('execute-unsupported-fanout');
    const ctx = createTestContext({ projectRoot });
    const stepNode = node({ id: 'wf:step', kind: 'fanout' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-039');
  });
});

describe('executeStep — TelemetryError wrapping', () => {
  it('rethrows a TelemetryError escaping a handler as the registered RUN-038, not a StepOutcome{failed}', async () => {
    const projectRoot = await createTempRepo('execute-telemetry-error');
    const ctx = createTestContext({
      projectRoot,
      telemetry: {
        emit() {
          throw new TelemetryError({
            code: 'TELEMETRY-EVENT-LOG-WRITE-FAILED',
            message: 'ENOSPC: no space left on device',
            remedy: 'Free disk space and retry.',
          });
        },
      },
    });
    // Any handler works, since the wrap happens once at executeStep's own try/catch; checkpoint is the
    // simplest one that reaches ctx.telemetry.emit at all.
    const stepNode = node({ id: 'wf:checkpoint', kind: 'checkpoint' });

    let caught: unknown;
    try {
      await executeStep(stepNode, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('RUN-038');
      expect(caught.cause).toBeInstanceOf(TelemetryError);
    }
  });
});
