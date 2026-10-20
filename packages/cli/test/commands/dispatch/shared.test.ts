/**
 * `commands/dispatch/shared.ts` — the cross-cutting infra every area file calls into, exercised
 * directly here (`specs/22` M17 P2's own "the coverage report for the new dispatch modules meets
 * the floor"). Most of its real branches are already reached incidentally by the ~18 per-area test
 * files (every command goes through `parseCommandFlags`, most through `realEnvSnapshot`, etc.) —
 * this file targets the specific branches that incidental reuse does not reach: the pure helpers'
 * own less-common inputs (a bare trailing `--rule`, a `gateCommandMarker` with a `stepId`/`agentId`,
 * `sanitizeDeep` over a non-plain-object value, `isBlank`'s curated blank-glyph list, a dry-run
 * compile failure `printWorkflowDispatchResult` has to render).
 *
 * @see specs/22 M17 P2
 */
import { describe, expect, it } from 'vitest';

import {
  assertNoArgs,
  defaultNonInteractiveConflictMode,
  findRuleFlag,
  gateCommandMarker,
  gateSubFlags,
  isBlank,
  parseCommandFlags,
  parseOptionalRunIdPositional,
  printWorkflowDispatchResult,
  renderRunStatus,
  runOutcomeExitCode,
  sanitizeDeep,
  stripControlChars,
} from '../../../src/commands/dispatch/shared.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

describe('defaultNonInteractiveConflictMode (specs/22 M17 P2)', () => {
  it('returns the explicit mode verbatim when one was given, regardless of --yes/--json', () => {
    expect(defaultNonInteractiveConflictMode('show-diff', false, false)).toBe('show-diff');
    expect(defaultNonInteractiveConflictMode('show-diff', true, true)).toBe('show-diff');
  });

  it('defaults to "keep-mine" when non-interactive (--yes or --json) with no explicit mode', () => {
    expect(defaultNonInteractiveConflictMode(undefined, true, false)).toBe('keep-mine');
    expect(defaultNonInteractiveConflictMode(undefined, false, true)).toBe('keep-mine');
  });

  it('returns undefined (a real, interactive prompt) when neither --yes nor --json nor an explicit mode', () => {
    expect(defaultNonInteractiveConflictMode(undefined, false, false)).toBeUndefined();
  });
});

describe('parseCommandFlags (specs/22 M17 P2)', () => {
  it('collects positionals and leaves an empty spec untouched by them', () => {
    const { positionals, flags, values } = parseCommandFlags(['a', 'b'], {});
    expect(positionals).toEqual(['a', 'b']);
    expect(flags.size).toBe(0);
    expect(values.size).toBe(0);
  });

  it('throws USR-002 for a flag not named in spec', () => {
    expect(() => parseCommandFlags(['--bogus'], {})).toThrow(
      expect.objectContaining({ code: 'USR-002' }),
    );
  });

  it('records a boolean flag (spec[flag] === false) without consuming the next token as its value', () => {
    const { flags, positionals } = parseCommandFlags(['--follow', 'next'], { '--follow': false });
    expect(flags.has('--follow')).toBe(true);
    expect(positionals).toEqual(['next']);
  });

  it("consumes the very next token as a value-flag's value, even one that looks like a flag itself", () => {
    const { values } = parseCommandFlags(['--reason', '--skip until next sprint'], {
      '--reason': true,
    });
    expect(values.get('--reason')).toBe('--skip until next sprint');
  });

  it('throws USR-002 when a value-flag is the very last token (no value follows)', () => {
    expect(() => parseCommandFlags(['--reason'], { '--reason': true })).toThrow(
      expect.objectContaining({ code: 'USR-002' }),
    );
  });
});

describe('assertNoArgs (specs/22 M17 P2)', () => {
  it('returns normally for a real, empty positional list', () => {
    expect(() => {
      assertNoArgs([]);
    }).not.toThrow();
  });

  it('throws USR-002 for a real, unexpected positional', () => {
    expect(() => {
      assertNoArgs(['extra']);
    }).toThrow(expect.objectContaining({ code: 'USR-002' }));
  });
});

describe('parseOptionalRunIdPositional (specs/22 M17 P2)', () => {
  it('returns undefined for no positional at all', () => {
    expect(parseOptionalRunIdPositional([])).toBeUndefined();
  });

  it('returns the one real positional given', () => {
    expect(parseOptionalRunIdPositional(['RUN-001'])).toBe('RUN-001');
  });

  it('throws USR-002 for a real, unexpected second positional', () => {
    expect(() => parseOptionalRunIdPositional(['RUN-001', 'extra'])).toThrow(
      expect.objectContaining({ code: 'USR-002' }),
    );
  });
});

describe('findRuleFlag (specs/22 M17 P2)', () => {
  it('returns undefined when --rule is not present at all', () => {
    expect(findRuleFlag(['--other', 'x'])).toBeUndefined();
  });

  it('returns the real value immediately following --rule', () => {
    expect(findRuleFlag(['--rule', 'oversized-stories'])).toBe('oversized-stories');
  });

  it('returns "" (never undefined) for a bare, trailing --rule with no value after it', () => {
    expect(findRuleFlag(['--rule'])).toBe('');
  });
});

describe('renderRunStatus / runOutcomeExitCode (specs/22 M17 P2)', () => {
  it('renders a real runStatus verbatim, and "unknown" for undefined (no RunStarted event at all)', () => {
    expect(renderRunStatus('completed')).toBe('completed');
    expect(renderRunStatus(undefined)).toBe('unknown');
  });

  it('exits non-zero for "failed"/"aborted", zero for every other real status (including undefined)', () => {
    expect(runOutcomeExitCode('failed')).toBe(1);
    expect(runOutcomeExitCode('aborted')).toBe(1);
    expect(runOutcomeExitCode('completed')).toBe(0);
    expect(runOutcomeExitCode(undefined)).toBe(0);
  });
});

describe('gateCommandMarker (specs/22 M17 P2)', () => {
  it('returns undefined when FORGE_RUN_ID is not set at all (a real human shell)', () => {
    expect(gateCommandMarker({})).toBeUndefined();
  });

  it('carries only runId when neither FORGE_STEP_ID nor FORGE_AGENT_ID is set', () => {
    expect(gateCommandMarker({ FORGE_RUN_ID: 'run-1' })).toEqual({ runId: 'run-1' });
  });

  it('carries stepId when set, without agentId', () => {
    expect(gateCommandMarker({ FORGE_RUN_ID: 'run-1', FORGE_STEP_ID: 'step-1' })).toEqual({
      runId: 'run-1',
      stepId: 'step-1',
    });
  });

  it('carries agentId when set, without stepId', () => {
    expect(gateCommandMarker({ FORGE_RUN_ID: 'run-1', FORGE_AGENT_ID: 'agent-1' })).toEqual({
      runId: 'run-1',
      agentId: 'agent-1',
    });
  });

  it('carries every field when all three real env vars are set', () => {
    expect(
      gateCommandMarker({
        FORGE_RUN_ID: 'run-1',
        FORGE_STEP_ID: 'step-1',
        FORGE_AGENT_ID: 'agent-1',
      }),
    ).toEqual({ runId: 'run-1', stepId: 'step-1', agentId: 'agent-1' });
  });
});

describe('gateSubFlags (specs/22 M17 P2)', () => {
  it('returns the real, exhaustive flag set for every real subcommand', () => {
    expect(gateSubFlags('list')).toEqual({});
    expect(gateSubFlags('check')).toEqual({ '--run': true });
    expect(gateSubFlags('approve')).toEqual({ '--run': true, '--reason': true });
    expect(gateSubFlags('reject')).toEqual({ '--run': true, '--reason': true });
    expect(gateSubFlags('waive')).toEqual({
      '--run': true,
      '--reason': true,
      '--owner': true,
      '--expires': true,
    });
  });

  it('returns undefined for a real, unrecognised subcommand', () => {
    expect(gateSubFlags('bogus')).toBeUndefined();
  });
});

describe('stripControlChars (specs/22 M17 P2)', () => {
  it('strips a real C0 control character and DEL, leaving ordinary text untouched', () => {
    expect(stripControlChars('a\x00b\x1fc\x7fd')).toBe('abcd');
  });

  it('strips the whole real C1 range', () => {
    expect(stripControlChars('a\x9bb')).toBe('ab');
  });

  it('leaves real, ordinary printable text completely untouched', () => {
    expect(stripControlChars('hello, world!')).toBe('hello, world!');
  });
});

describe('sanitizeDeep (specs/22 M17 P2)', () => {
  it('strips control characters out of a bare string', () => {
    expect(sanitizeDeep('a\x00b')).toBe('ab');
  });

  it('walks a real array, sanitizing every element', () => {
    expect(sanitizeDeep(['a\x00b', 'c\x1fd'])).toEqual(['ab', 'cd']);
  });

  it('walks a real plain object, sanitizing every string value, recursively', () => {
    expect(sanitizeDeep({ a: 'x\x00y', b: 2, c: { d: 'z\x7f' } })).toEqual({
      a: 'xy',
      b: 2,
      c: { d: 'z' },
    });
  });

  it('leaves a non-plain-object value (a real Date instance) completely untouched', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(sanitizeDeep(date)).toBe(date);
  });

  it('leaves a real number/boolean/null/undefined value completely untouched', () => {
    expect(sanitizeDeep(42)).toBe(42);
    expect(sanitizeDeep(true)).toBe(true);
    expect(sanitizeDeep(null)).toBeNull();
    expect(sanitizeDeep<string | undefined>(undefined)).toBeUndefined();
  });
});

describe('isBlank (specs/22 M17 P2)', () => {
  it('treats a real, empty string as blank', () => {
    expect(isBlank('')).toBe(true);
  });

  it('treats ordinary whitespace as blank', () => {
    expect(isBlank('   \t\n ')).toBe(true);
  });

  it('treats a real zero-width space (an invisible Unicode format character) as blank', () => {
    expect(isBlank('​')).toBe(true);
  });

  it('treats a real, curated blank-rendering glyph (U+2800 BRAILLE PATTERN BLANK) as blank', () => {
    expect(isBlank('⠀')).toBe(true);
  });

  it('treats real, ordinary, non-blank text as non-blank', () => {
    expect(isBlank('a real reason')).toBe(false);
  });
});

describe('printWorkflowDispatchResult (specs/22 M17 P2)', () => {
  it('prints a real, failed dry-run compile (success: false) and exits with EXIT_CODES.usage', async () => {
    const result = await captureLogs(() =>
      Promise.resolve(
        printWorkflowDispatchResult(
          'plan bogus-phase',
          {
            kind: 'dry-run',
            plan: {
              success: false,
              issues: [{ code: 'RUN-001', message: 'a real, disclosed compile issue' }],
            },
          },
          true,
        ),
      ),
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly plan: { readonly success: boolean };
    };
    expect(parsed.plan.success).toBe(false);
  });

  it('prints a real, successful dry-run compile in plain text (not --json)', async () => {
    const result = await captureLogs(() =>
      Promise.resolve(
        printWorkflowDispatchResult(
          'plan product',
          {
            kind: 'dry-run',
            plan: {
              success: true,
              nodes: [],
              criticalPath: { path: [], estimatedCost: 0 },
              claims: { overlaps: [] },
            },
          },
          false,
        ),
      ),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain('compiled 0 steps');
  });
});
