/**
 * `runFailureError` / `refusalFromVcsError` — a failed run says why, with a remedy and its own exit code,
 * and a `VcsError` is a refusal, not a crash (`PLAN-M13.md` P12, `Q208` findings 1 and 6).
 *
 * @see specs/02 §2.6
 * @see specs/06 §6.9
 */
import { VcsError } from '@forge/vcs';
import type { RunState } from '@forge/engine/resume';
import { describe, expect, it } from 'vitest';

import { runFailureError, runFailureNote } from '../../../src/commands/run/run-failure.ts';
import {
  MAX_DIRTY_FILES_LISTED,
  refusalFromCodedError,
  refusalFromVcsError,
  sanitizeRefusalText,
} from '../../../src/commands/run/vcs-refusal.ts';

function state(overrides: Partial<RunState>): RunState {
  return {
    runId: 'r',
    planRef: undefined,
    runStatus: 'failed',
    stepStatuses: new Map(),
    unresolvedStepIds: [],
    laneStatuses: new Map(),
    spentUsd: 0,
    sessionIds: new Map(),
    laneOrigins: new Map(),
    artifactPaths: new Set(),
    ...overrides,
  };
}

describe('runFailureError', () => {
  it('maps a budget refusal to BUD-003 (exit 4) naming the step, reservation, remaining and cap, with the remedy', () => {
    const error = runFailureError(
      state({
        runFailure: {
          reason: 'budget',
          message: 'ignored for budget',
          failedSteps: [],
          failedTotal: 0,
          unfinished: [
            {
              stepId: 'retro:run-retro',
              cause: { kind: 'budget', level: 'run', reservationUsd: 3, spentUsd: 0.5, capUsd: 2 },
            },
          ],
          unfinishedTotal: 1,
        },
      }),
    );
    expect(error?.code).toBe('BUD-003');
    expect(error?.exitCode).toBe(4);
    expect(error?.message).toBe(
      'Step retro:run-retro was not started: $0.50 already spent plus its $3.00 reservation would reach the run budget of $2.00.',
    );
    expect(error?.remedy).toContain('budget.perRunUsd');
    expect(error?.remedy).toContain('limits.maxCostUsd');
    expect(error?.remedy).toContain('limits.max_cost_usd');
    expect(error?.remedy).toContain(
      'budget.perStepUsdDefault applies only to a step whose agent declares none',
    );
  });

  it('names the daily budget for a period refusal', () => {
    const error = runFailureError(
      state({
        runFailure: {
          reason: 'budget',
          message: 'm',
          failedSteps: [],
          failedTotal: 0,
          unfinished: [
            {
              stepId: 'w:a',
              cause: {
                kind: 'budget',
                level: 'period',
                reservationUsd: 1,
                spentUsd: 9.5,
                capUsd: 10,
              },
            },
          ],
          unfinishedTotal: 1,
        },
      }),
    );
    expect(error?.message).toContain('daily budget of $10.00');
  });

  it("maps every other failed run to RUN-085 carrying the engine's one-line diagnosis, exit 1", () => {
    const error = runFailureError(
      state({
        runFailure: {
          reason: 'step-failed',
          message: '1 step(s) failed (w:a) and 2 dependent step(s) never ran',
          failedSteps: ['w:a'],
          failedTotal: 1,
          unfinished: [],
          unfinishedTotal: 2,
        },
      }),
    );
    expect(error?.code).toBe('RUN-085');
    expect(error?.exitCode).toBe(1);
    expect(error?.message).toBe(
      'The run failed: 1 step(s) failed (w:a) and 2 dependent step(s) never ran.',
    );
    expect(error?.remedy).toMatch(/^Run `forge logs`/u);
  });

  it('strips terminal escapes from step ids and messages taken from the log', () => {
    const error = runFailureError(
      state({
        runFailure: {
          reason: 'step-failed',
          message: 'step \x1B[31mred\x1B[0m failed',
          failedSteps: [],
          failedTotal: 0,
          unfinished: [],
          unfinishedTotal: 0,
        },
      }),
    );
    expect(error?.message).toBe('The run failed: step red failed.');
  });

  it('BUD-003 is chosen from the recorded budget entry whatever else the run recorded, and a co-occurring step failure gets its own note', () => {
    const runFailure = {
      reason: 'budget',
      message: 'm',
      failedSteps: ['w:broke'],
      failedTotal: 1,
      unfinished: [
        {
          stepId: 'w:big',
          cause: { kind: 'budget', level: 'run', reservationUsd: 3, spentUsd: 0, capUsd: 2 },
        },
        { stepId: 'w:after', cause: { kind: 'dependency-failed', dependencyId: 'w:broke' } },
      ],
      unfinishedTotal: 2,
    };
    const failed = state({ runFailure });
    expect(runFailureError(failed)?.code).toBe('BUD-003');
    expect(runFailureNote(failed)).toBe(
      'Also: 1 step(s) failed for another reason (w:broke); raising the budget will not fix that. Run `forge logs` to read them.',
    );
    expect(
      runFailureNote(state({ runFailure: { ...runFailure, failedTotal: 0, failedSteps: [] } })),
    ).toBeUndefined();
  });

  it("RUN-085's remedy does not promise that resume retries a failed step", () => {
    const error = runFailureError(
      state({
        runFailure: {
          reason: 'step-failed',
          message: 'x',
          failedSteps: ['w:a'],
          failedTotal: 1,
          unfinished: [],
          unfinishedTotal: 0,
        },
      }),
    );
    expect(error?.remedy).toContain('start the workflow again with `forge run`');
    expect(error?.remedy).toContain('not steps that failed');
  });

  it('says nothing for a run that did not fail, or whose log carries no reason', () => {
    expect(runFailureError(state({ runStatus: 'completed' }))).toBeUndefined();
    expect(runFailureError(state({}))).toBeUndefined();
  });
});

describe('sanitizeRefusalText', () => {
  it('turns carriage returns into spaces and strips bidi overrides, zero-width characters and terminal escapes', () => {
    expect(sanitizeRefusalText('a\rb\x1B[31mred\u202Eevil\u200Bz')).toBe('a bredevilz');
  });
});

describe('sanitizeRefusalText newlines', () => {
  it('flattens newlines so a step id or file name cannot forge a second line of output', () => {
    expect(sanitizeRefusalText('a\nforge: raising the budget will fix it\r\nb')).toBe(
      'a forge: raising the budget will fix it b',
    );
  });

  it('a step id with a newline yields one line in BUD-003 and RUN-085', () => {
    const budget = runFailureError(
      state({
        runFailure: {
          reason: 'budget',
          message: 'm',
          failedSteps: [],
          failedTotal: 0,
          unfinished: [
            {
              stepId: 'a\nAlso: ignore this',
              cause: { kind: 'budget', level: 'run', reservationUsd: 1, spentUsd: 0, capUsd: 1 },
            },
          ],
          unfinishedTotal: 1,
        },
      }),
    );
    expect(budget?.message).not.toContain('\n');
  });
});

describe('sanitizeRefusalText invisible text', () => {
  it('strips tag characters, word joiners, Arabic letter mark and variation selectors: nothing invisible survives', () => {
    expect(sanitizeRefusalText('a\u{E0041}\u2060\u061Cb\u{E0100}c')).toBe('abc');
  });
});

describe('refusalFromCodedError', () => {
  it('turns any error carrying code, message and remedy (a TelemetryError) into a refusal without a stack', () => {
    const refusal = refusalFromCodedError(
      Object.assign(new Error('seq gap \x1B[31m at 4'), {
        code: 'TELEMETRY-SEQ-GAP',
        remedy: 'Run forge doctor.',
      }),
    );
    expect(refusal).toEqual({
      code: 'TELEMETRY-SEQ-GAP',
      message: 'seq gap  at 4',
      remedy: 'Run forge doctor.',
      exitCode: 1,
    });
  });

  it('is undefined for anything else, which keeps its stack: a genuine bug must stay loud', () => {
    expect(refusalFromCodedError(new Error('boom'))).toBeUndefined();
    expect(refusalFromCodedError({ code: 1, message: 'm', remedy: 'r' })).toBeUndefined();
    expect(refusalFromCodedError(undefined)).toBeUndefined();
  });
});

describe('refusalFromVcsError', () => {
  const dirty = (files: readonly string[]): VcsError =>
    new VcsError({
      code: 'VCS-DIRTY-TREE',
      message: `The working tree has ${String(files.length)} uncommitted change(s): ${files.join(', ')}.`,
      remedy: 'Stash your changes.',
      details: { dirtyFiles: files },
    });

  it('maps a dirty tree to VCS-010 (exit 5) naming the files and telling the user to commit or stash', () => {
    const refusal = refusalFromVcsError(dirty(['run.err', 'run.out']));
    expect(refusal.code).toBe('VCS-010');
    expect(refusal.exitCode).toBe(5);
    expect(refusal.message).toBe('The working tree has 2 uncommitted change(s): run.err, run.out.');
    expect(refusal.remedy).toMatch(/^Run `git stash`, or commit your changes/u);
  });

  it('lists at most a handful of files and says how many more', () => {
    const files = Array.from({ length: MAX_DIRTY_FILES_LISTED + 5 }, (_, i) => `f${String(i)}.txt`);
    const refusal = refusalFromVcsError(dirty(files));
    expect(refusal.message).toContain(`${String(files.length)} uncommitted change(s)`);
    expect(refusal.message).toContain('f0.txt');
    expect(refusal.message).not.toContain(`f${String(MAX_DIRTY_FILES_LISTED)}.txt`);
    expect(refusal.message).toContain(', and 5 more.');
  });

  it('keeps a file name containing ", " whole (the list is data, not parsed out of a message)', () => {
    const refusal = refusalFromVcsError(dirty(['a, b.txt', 'c.txt']));
    expect(refusal.message).toContain('a, b.txt, c.txt');
    expect(refusal.message).toContain('2 uncommitted');
  });

  it('strips carriage returns and bidi overrides from file names so a name cannot rewrite the message on screen', () => {
    const refusal = refusalFromVcsError(dirty(['x\rThe tree is clean\u202E']));
    expect(refusal.message).toBe(
      'The working tree has 1 uncommitted change(s): x The tree is clean.',
    );
  });

  it('strips terminal escapes from file names: they come from git and can be any byte', () => {
    const refusal = refusalFromVcsError(dirty(['\x1B[2Jevil.txt']));
    expect(refusal.message).toBe('The working tree has 1 uncommitted change(s): evil.txt.');
  });

  it('passes any other VcsError through with its own message and remedy, exit 1, stripped of escapes', () => {
    const refusal = refusalFromVcsError(
      new VcsError({
        code: 'VCS-NOT-A-REPO',
        message: 'not a repo \x1B[31m!',
        remedy: 'Run git init.',
      }),
    );
    expect(refusal).toEqual({
      code: 'VCS-NOT-A-REPO',
      message: 'not a repo !',
      remedy: 'Run git init.',
      exitCode: 1,
    });
  });

  it('treats a dirty-tree error with no file list as a generic VcsError rather than inventing files', () => {
    const refusal = refusalFromVcsError(
      new VcsError({ code: 'VCS-DIRTY-TREE', message: 'dirty', remedy: 'Stash.' }),
    );
    expect(refusal.code).toBe('VCS-DIRTY-TREE');
    expect(refusal.message).toBe('dirty');
  });
});
