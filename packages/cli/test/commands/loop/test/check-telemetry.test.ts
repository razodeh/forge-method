/**
 * `emitBindingCheckTelemetry` — direct, unit-level redaction coverage (round-2 gauntlet fix, `specs/22`
 * M16 P15). `check-telemetry.ts`'s own `emitBindingCheckTelemetry`/`emitExemptionDeclaredTelemetry`
 * (M15 P11) had no test file of their own calling either directly: `bin-binding-hunks-evidence.test.ts`
 * exercises `emitBindingCheckTelemetry` only indirectly, through a full, spawned `forge test binding`
 * subprocess, and no test anywhere in this suite called it directly to prove redaction before this file
 * existed (grep confirmed, this fix's own report has the command).
 *
 * This matters because the M16 P15 commit's own message claimed "packages/telemetry's own redaction
 * guarantee had never been re-proven at the CLI call-site level for the existing binding emitter...
 * added here" -- false: the only new redaction test that piece added
 * (`check-command.test.ts`'s own parity-emitter test) exercises the NEW parity emitter's
 * `declarationNames` field, never this, pre-existing M15 emitter's own payload. Two independent round-2
 * critics confirmed, via their own direct calls to the real `emitBindingCheckTelemetry`, that redaction
 * mechanically DOES already work correctly here (not a live security bug) -- this file is the missing
 * proof, mirroring what both critics independently built.
 *
 * `@forge/telemetry`'s own package-level tests already prove the general redaction mechanism; this
 * proves the identical mechanism at THIS call site, with this payload's real shape -- not a second
 * opinion about how redaction itself works.
 *
 * @see specs/22 M15 P11
 * @see specs/22 M16 P15
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SYSTEM_CLOCK } from '@forge/core';
import { readEvents } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { emitBindingCheckTelemetry } from '../../../../src/commands/loop/test/check-telemetry.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-binding-telemetry-'));
  dirs.push(dir);
  return dir;
}

async function readBindingCheckRuns(
  dir: string,
  runId: string,
): Promise<readonly Record<string, unknown>[]> {
  const events = [];
  for await (const event of readEvents(dir, runId)) events.push(event);
  return events
    .filter((event) => event.type === 'CheckRun')
    .map((event) => event.payload as Record<string, unknown>)
    .filter((payload) => payload['kind'] === 'binding');
}

describe('emitBindingCheckTelemetry: redaction at the CLI call site (specs/22 M16 P15)', () => {
  it('a secret-shaped storyId is redacted at write time -- never previously proven by a direct call at this call site', async () => {
    const dir = await scratchProject();
    const secret = `ghp_${'a'.repeat(36)}`;

    await emitBindingCheckTelemetry({
      projectRoot: dir,
      runId: 'run-binding-redaction-story',
      clock: SYSTEM_CLOCK,
      storyId: secret,
      testsNamed: 3,
      bound: 2,
      nonBinding: 1,
      exempted: 0,
    });

    const bindingRuns = await readBindingCheckRuns(dir, 'run-binding-redaction-story');
    expect(bindingRuns).toHaveLength(1);
    const storyId = bindingRuns[0]?.['storyId'];
    expect(storyId).not.toContain(secret);
    expect(storyId).toContain('[REDACTED]');
  });

  it('a secret-shaped entry inside expiredExemptionIds is also redacted', async () => {
    const dir = await scratchProject();
    const secret = `ghp_${'b'.repeat(36)}`;

    await emitBindingCheckTelemetry({
      projectRoot: dir,
      runId: 'run-binding-redaction-exemptions',
      clock: SYSTEM_CLOCK,
      storyId: 'STORY-001',
      testsNamed: 1,
      bound: 0,
      nonBinding: 1,
      exempted: 1,
      expiredExemptionIds: [secret],
    });

    const bindingRuns = await readBindingCheckRuns(dir, 'run-binding-redaction-exemptions');
    expect(bindingRuns).toHaveLength(1);
    const ids = bindingRuns[0]?.['expiredExemptionIds'] as readonly string[];
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toContain(secret);
    expect(ids[0]).toContain('[REDACTED]');
  });

  it('with no runId at all, nothing is written (the pre-existing FORGE_RUN_ID-gated stance, unaffected by this fix)', async () => {
    const dir = await scratchProject();
    await emitBindingCheckTelemetry({
      projectRoot: dir,
      runId: undefined,
      clock: SYSTEM_CLOCK,
      storyId: 'STORY-001',
      testsNamed: 1,
      bound: 1,
      nonBinding: 0,
      exempted: 0,
    });
    // No run directory was ever created: `readEvents` on a run that never started yields nothing,
    // never throws (its own doc comment: "a legitimate state... not corruption").
    const bindingRuns = await readBindingCheckRuns(dir, 'run-that-never-happened');
    expect(bindingRuns).toHaveLength(0);
  });
});
