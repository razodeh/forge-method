/**
 * `classifyFailure`/`normaliseErrorSignature` — `06` §6.8's own nine-member failure table, and the
 * signature the never-retry rule compares two attempts by.
 *
 * @see specs/06 §6.8
 * @see PLAN-M5.md P16
 */
import { ForgeError } from '@forge/core/errors';
import { describe, expect, it } from 'vitest';

import { classifyFailure, normaliseErrorSignature } from '../../src/failures/classify.ts';
import type { StepFailureInfo, StepOutcome } from '../../src/dispatch/index.ts';

function outcome(overrides: { readonly failure?: StepFailureInfo } = {}): StepOutcome {
  const failure = overrides.failure;
  return {
    stepId: 'wf:step',
    status: failure === undefined ? 'succeeded' : 'failed',
    startedAt: 0,
    finishedAt: 1,
    detail: { kind: 'checkpoint' },
    ...(failure === undefined ? {} : { failure }),
  };
}

describe('classifyFailure', () => {
  it('throws RUN-042 for a succeeded outcome', () => {
    let caught: unknown;
    try {
      classifyFailure(outcome());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-042');
  });

  it("classifies a gate rejection as 'validation'", () => {
    const result = classifyFailure(
      outcome({ failure: { source: 'gate', message: 'Gate G-Test was not approved.' } }),
    );
    expect(result).toBe('validation');
  });

  describe('command-sourced failures', () => {
    it("exit code 124 (the POSIX timeout convention) classifies as 'timeout'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'command', code: '124', message: 'killed' } }),
      );
      expect(result).toBe('timeout');
    });

    it("any other exit code classifies as 'tool-error'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'command', code: '1', message: 'lint failed' } }),
      );
      expect(result).toBe('tool-error');
    });
  });

  describe('adapter-sourced failures', () => {
    it("TOOL_ERROR classifies as 'tool-error'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'adapter', code: 'TOOL_ERROR', message: 'a tool failed' } }),
      );
      expect(result).toBe('tool-error');
    });

    it("an unrecognised or missing adapter code defaults to 'transient'", () => {
      const withUnknownCode = classifyFailure(
        outcome({ failure: { source: 'adapter', code: 'SCRIPTED_ERROR', message: 'x' } }),
      );
      const withNoCode = classifyFailure(
        outcome({ failure: { source: 'adapter', message: 'session crashed' } }),
      );
      expect(withUnknownCode).toBe('transient');
      expect(withNoCode).toBe('transient');
    });
  });

  describe('vcs-sourced failures', () => {
    it("VCS-MISSING-CONFLICT-RESOLVER classifies as 'policy'", () => {
      const result = classifyFailure(
        outcome({
          failure: { source: 'vcs', code: 'VCS-MISSING-CONFLICT-RESOLVER', message: 'x' },
        }),
      );
      expect(result).toBe('policy');
    });

    it("any VCS-INVALID-* code classifies as 'validation'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'vcs', code: 'VCS-INVALID-COMMIT-FIELD', message: 'x' } }),
      );
      expect(result).toBe('validation');
    });

    it("LANE-JOIN-CONFLICT (PLAN-M14.md P34: an in-lane join conflicted) classifies as 'conflict'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'vcs', code: 'LANE-JOIN-CONFLICT', message: 'x' } }),
      );
      expect(result).toBe('conflict');
    });

    it("a generic wrapper code (or none at all) defaults to 'transient'", () => {
      const generic = classifyFailure(
        outcome({ failure: { source: 'vcs', code: 'VCS-GIT-OPERATION-FAILED', message: 'x' } }),
      );
      const unknown = classifyFailure(
        outcome({ failure: { source: 'vcs', code: 'UNKNOWN', message: 'x' } }),
      );
      expect(generic).toBe('transient');
      expect(unknown).toBe('transient');
    });

    it("PLAN-M14.md P38: createAgentConflictResolver's own five refusal/guardrail codes (thrown as VcsErrors, conflict-resolver.ts) are verified, not silently unconsidered -- they default to 'transient', the identical fallback every other unmapped VCS-shaped code above already gets", () => {
      for (const code of [
        'MERGE-RESOLVER-NO-STEP',
        'MERGE-RESOLVER-READ-ONLY',
        'MERGE-RESOLVER-BUDGET',
        'MERGE-RESOLVER-TREE-MOVED',
        'MERGE-RESOLVER-OUT-OF-CLAIM',
      ]) {
        const result = classifyFailure(outcome({ failure: { source: 'vcs', code, message: 'x' } }));
        expect(result).toBe('transient');
      }
    });
  });

  describe('output-sourced failures', () => {
    it("RUN-108 (a swarm-review step's merged verdict is blocked, PLAN-M14.md P14) classifies as 'policy': a retry over the same diff fails identically", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'output', code: 'RUN-108', message: 'x' } }),
      );
      expect(result).toBe('policy');
    });

    it("any other output code (a missing or invalid declared output, RUN-083/RUN-084) still classifies as 'validation'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'output', code: 'RUN-083', message: 'x' } }),
      );
      expect(result).toBe('validation');
    });
  });

  describe('merge-sourced failures', () => {
    it("MERGE-CONFLICT-UNRESOLVED classifies as 'conflict'", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'merge', code: 'MERGE-CONFLICT-UNRESOLVED', message: 'x' } }),
      );
      expect(result).toBe('conflict');
    });

    it.each(['MERGE-PRE-CHECK-FAILED', 'MERGE-POST-CHECK-FAILED'])(
      "%s classifies as 'test-failure'",
      (code) => {
        const result = classifyFailure(
          outcome({ failure: { source: 'merge', code, message: 'x' } }),
        );
        expect(result).toBe('test-failure');
      },
    );

    it.each(['MERGE-CHECKS-UNCONFIGURED', 'MERGE-CHECK-COMMAND-INVALID'])(
      "%s (a merge check the project's configuration cannot supply) classifies as 'policy': a retry fails identically",
      (code) => {
        const result = classifyFailure(
          outcome({ failure: { source: 'merge', code, message: 'x' } }),
        );
        expect(result).toBe('policy');
      },
    );

    it("MERGE-REVIEW-INCOMPLETE (PLAN-M14.md P18: a swarm-review lane's own committed verdict is not landable, or it is the implement lane such a review reviews) classifies as 'policy': the same committed report fails identically on retry", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'merge', code: 'MERGE-REVIEW-INCOMPLETE', message: 'x' } }),
      );
      expect(result).toBe('policy');
    });

    it("VCS-LANE-REVERTED (a lane whose merge was reverted, offered again) classifies as 'policy': a retry fails identically", () => {
      const result = classifyFailure(
        outcome({ failure: { source: 'vcs', code: 'VCS-LANE-REVERTED', message: 'x' } }),
      );
      expect(result).toBe('policy');
    });

    it("an unrecognised merge code defaults to 'transient'", () => {
      const result = classifyFailure(outcome({ failure: { source: 'merge', message: 'x' } }));
      expect(result).toBe('transient');
    });
  });

  it("classifies a strict claim violation as 'policy': the same session writing the same stray path fails identically on retry (PLAN-M14.md P3)", () => {
    const result = classifyFailure(
      outcome({ failure: { source: 'claim', code: 'RUN-104', message: 'x' } }),
    );
    expect(result).toBe('policy');
  });

  it("defaults the two sources no real handler ever constructs (telemetry, unsupported) to 'transient'", () => {
    // Neither is reachable through @forge/engine/dispatch's own real callers (a TelemetryError always
    // escapes as a thrown RUN-038, never folded into StepOutcome data; nothing in this milestone
    // constructs an 'unsupported' failure at all) -- exercised directly here since the switch must stay
    // exhaustive over StepFailureInfo.source's own declared type regardless.
    const telemetry = classifyFailure(outcome({ failure: { source: 'telemetry', message: 'x' } }));
    const unsupported = classifyFailure(
      outcome({ failure: { source: 'unsupported', message: 'x' } }),
    );
    expect(telemetry).toBe('transient');
    expect(unsupported).toBe('transient');
  });
});

describe('normaliseErrorSignature', () => {
  it('throws RUN-042 for a succeeded outcome', () => {
    let caught: unknown;
    try {
      normaliseErrorSignature(outcome());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('RUN-042');
  });

  it('is deterministic: the identical failure always produces the identical signature', () => {
    const failure: StepFailureInfo = {
      source: 'vcs',
      code: 'VCS-GIT-OPERATION-FAILED',
      message: 'boom',
    };
    const first = normaliseErrorSignature(outcome({ failure }));
    const second = normaliseErrorSignature(outcome({ failure: { ...failure } }));
    expect(first).toBe(second);
  });

  it('looks like a short hex digest, not raw message text', () => {
    const signature = normaliseErrorSignature(
      outcome({ failure: { source: 'command', code: '1', message: 'anything' } }),
    );
    expect(signature).toMatch(/^[0-9a-f]{16}$/);
  });

  it('normalises away a variable tmp-dir directory prefix (its own hex-looking random suffix included), keeping the real trailing path segments intact', () => {
    const first = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'vcs',
          code: 'VCS-GIT-OPERATION-FAILED',
          message:
            'git operation failed while staging changes in the lane worktree at "/tmp/forge-a1b2c3/wf-generate": exit 128',
        },
      }),
    );
    const second = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'vcs',
          code: 'VCS-GIT-OPERATION-FAILED',
          message:
            'git operation failed while staging changes in the lane worktree at "/private/tmp/forge-d4e5f6/wf-generate": exit 128',
        },
      }),
    );
    expect(first).toBe(second);
  });

  it('distinguishes two different files sharing a basename and line:col, when their immediate parent directory differs', () => {
    // The specific residual gap a gauntlet-loop verify round found in an earlier version of this fix
    // (preserving only 1 trailing path segment, not PRESERVED_PATH_SEGMENTS's own 2): two different
    // index.ts files with a coincidentally-matching line:col (line 1 is a common syntax-error location)
    // used to collide. Preserving the immediate parent directory too resolves this specific shape.
    const first = normaliseErrorSignature(
      outcome({
        failure: { source: 'command', code: '1', message: 'error at /repo/moduleA/index.ts:1:1' },
      }),
    );
    const second = normaliseErrorSignature(
      outcome({
        failure: { source: 'command', code: '1', message: 'error at /repo/moduleB/index.ts:1:1' },
      }),
    );
    expect(first).not.toBe(second);
  });

  it('does NOT distinguish two files sharing both a basename and an immediate parent directory name -- an accepted, documented residual limit, not a claim this fix is complete', () => {
    // packages/vcs/src/errors.ts and packages/telemetry/src/errors.ts: same basename (errors.ts), same
    // immediate parent name (src), different grandparent (vcs vs telemetry) -- PRESERVED_PATH_SEGMENTS's
    // own doc comment already names this as a real, accepted limitation of any fixed trailing-segment
    // count. Asserted explicitly, not left merely implied, so a future change to this constant has an
    // honest baseline to compare against rather than silently drifting either way unnoticed.
    const first = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'command',
          code: '1',
          message: 'error at /repo/packages/vcs/src/errors.ts:1:1',
        },
      }),
    );
    const second = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'command',
          code: '1',
          message: 'error at /repo/packages/telemetry/src/errors.ts:1:1',
        },
      }),
    );
    expect(first).toBe(second);
  });

  it("keeps a compiler error's own filename and line/column distinct for two genuinely different bugs, even though both reference an absolute path", () => {
    // A stripped-down repro of a real false-collision bug: an earlier version of the path pattern
    // discarded the *entire* path token, including the filename/line/col that is exactly what
    // distinguishes one real compiler/tool error from another -- almost every such message references
    // an absolute path, so that version made the never-retry rule risk escalating after two genuinely
    // different bugs, not two identical ones.
    const first = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'command',
          code: '1',
          message: 'TypeError: cannot read prop of undefined at /repo/src/handlers/auth.ts:42:10',
        },
      }),
    );
    const second = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'command',
          code: '1',
          message:
            'TypeError: cannot read prop of undefined at /repo/src/handlers/billing.ts:900:3',
        },
      }),
    );
    expect(first).not.toBe(second);
  });

  it('still matches the identical compiler error across two runs with different absolute checkout locations', () => {
    const first = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'command',
          code: '1',
          message: 'error at /Users/alice/repo/src/handlers/auth.ts:42:10',
        },
      }),
    );
    const second = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'command',
          code: '1',
          message: 'error at /home/ci-runner/work/repo/src/handlers/auth.ts:42:10',
        },
      }),
    );
    expect(first).toBe(second);
  });

  it('normalises away a commit sha and a timestamp identically', () => {
    const first = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'merge',
          code: 'MERGE-CONFLICT-UNRESOLVED',
          message: 'conflict at commit a1b2c3d4e5f6 on 2026-01-01T00:00:00.000Z',
        },
      }),
    );
    const second = normaliseErrorSignature(
      outcome({
        failure: {
          source: 'merge',
          code: 'MERGE-CONFLICT-UNRESOLVED',
          message: 'conflict at commit 9f8e7d6c5b4a on 2026-06-15T12:30:45.123Z',
        },
      }),
    );
    expect(first).toBe(second);
  });

  it('still distinguishes two genuinely different failures after normalisation', () => {
    const first = normaliseErrorSignature(
      outcome({ failure: { source: 'command', code: '1', message: 'lint failed' } }),
    );
    const second = normaliseErrorSignature(
      outcome({ failure: { source: 'command', code: '2', message: 'build failed' } }),
    );
    expect(first).not.toBe(second);
  });

  it('handles a failure with no code at all (e.g. a gate rejection, or an adapter crash with none)', () => {
    // Must not throw, and must still differ from an otherwise-identical failure that does have a code --
    // proving the `code ?? ''` fallback is genuinely exercised, not just present in the source.
    const withoutCode = normaliseErrorSignature(
      outcome({ failure: { source: 'adapter', message: 'session crashed' } }),
    );
    const withCode = normaliseErrorSignature(
      outcome({ failure: { source: 'adapter', code: 'SOME_CODE', message: 'session crashed' } }),
    );
    expect(withoutCode).toMatch(/^[0-9a-f]{16}$/);
    expect(withoutCode).not.toBe(withCode);
  });
});
