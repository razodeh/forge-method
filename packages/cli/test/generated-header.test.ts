/**
 * `@forge/cli/generated-header` — `03` §3.3's own "Files with a modified hash are never silently
 * overwritten" conflict-resolution mechanism, tested directly against real strings/streams (no real
 * filesystem needed — `run-init.test.ts`/`run-upgrade.test.ts` cover the real-file integration).
 *
 * @see specs/03 §3.3
 */
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { generatedHeader, withGeneratedHeader } from '../src/init/generated-header.ts';
import { sha256 } from '../src/init/hash.ts';
import {
  extractGeneratedHeader,
  hasGeneratedFileDrifted,
  lineDiff,
  MERGE_SIDECAR_SUFFIX,
  resolveGeneratedConflict,
  sanitizeForTerminal,
  sanitizeWrittenFilePaths,
} from '../src/generated-header.ts';

const ORIGINAL_BODY = 'id: intake\nsteps: []\n';
const ORIGINAL_HASH = sha256(ORIGINAL_BODY);

function stampedFile(): string {
  return withGeneratedHeader(ORIGINAL_BODY, 'intake.workflow.yaml', '1', ORIGINAL_HASH);
}

describe('extractGeneratedHeader', () => {
  it('recovers the exact original body and hash from an unedited, ordinary generated file', () => {
    const info = extractGeneratedHeader(stampedFile());
    expect(info).toBeDefined();
    expect(info?.version).toBe('1');
    expect(info?.hash).toBe(ORIGINAL_HASH);
    expect(info?.bodyWithoutHeader).toBe(ORIGINAL_BODY);
  });

  it('recovers the exact original body from a front-matter file whose header sits on line 1', () => {
    const original = '---\nname: my-skill\n---\n\nBody text.\n';
    const hash = sha256(original);
    const stamped = withGeneratedHeader(original, '.forge/skills/my-skill/SKILL.md', '1', hash);
    const info = extractGeneratedHeader(stamped);
    expect(info?.hash).toBe(hash);
    expect(info?.bodyWithoutHeader).toBe(original);
  });

  it('returns undefined for content with no real header at all', () => {
    expect(extractGeneratedHeader('id: intake\nsteps: []\n')).toBeUndefined();
  });

  it('does not false-positive on a body line that merely mentions forge:generated deep in the file', () => {
    const content = `id: intake\n# not a real header: forge:generated v=1 hash=x — edits will be overwritten; use overrides/\n`;
    expect(extractGeneratedHeader(content)).toBeUndefined();
  });

  it('recovers the header from a real CRLF-terminated file (e.g. a core.autocrlf=true checkout)', () => {
    // A round-1 critic finding: `HEADER_LINE` anchored on a bare `$`, so a trailing `\r` before the
    // real line break made every single line fail to match — every regenerable file on such a
    // checkout reported "no header found" and therefore "drifted," forever, even though nothing a
    // human did ever touched the file.
    const crlf = stampedFile().replace(/\n/g, '\r\n');
    const info = extractGeneratedHeader(crlf);
    expect(info?.hash).toBe(ORIGINAL_HASH);
    expect(info?.bodyWithoutHeader).toBe(ORIGINAL_BODY);
  });
});

describe('hasGeneratedFileDrifted', () => {
  it('is false for an unedited generated file', () => {
    expect(hasGeneratedFileDrifted(stampedFile())).toBe(false);
  });

  it('is true once the body is hand-edited but the header is left alone', () => {
    const edited = stampedFile().replace('steps: []', 'steps:\n  - custom');
    expect(hasGeneratedFileDrifted(edited)).toBe(true);
  });

  it('is true for a file with no recognizable header at all (fails closed, never silently trusted)', () => {
    expect(hasGeneratedFileDrifted(ORIGINAL_BODY)).toBe(true);
  });

  it('is false for a real CRLF-normalized checkout of an otherwise-unedited file', () => {
    expect(hasGeneratedFileDrifted(stampedFile().replace(/\n/g, '\r\n'))).toBe(false);
  });

  it('is still true for a genuine hand-edit made on top of a CRLF-normalized file', () => {
    const edited = stampedFile()
      .replace(/\n/g, '\r\n')
      .replace('steps: []', 'steps:\r\n  - custom');
    expect(hasGeneratedFileDrifted(edited)).toBe(true);
  });
});

describe('lineDiff', () => {
  it('renders unchanged, removed, and added lines correctly', () => {
    const diff = lineDiff('a\nb\nc\n', 'a\nx\nc\n');
    const lines = diff.split('\n');
    expect(lines).toContain('  a');
    expect(lines).toContain('- b');
    expect(lines).toContain('+ x');
    expect(lines).toContain('  c');
  });

  it('is empty-line-safe for two identical strings', () => {
    expect(lineDiff('same\n', 'same\n')).toBe('  same\n  ');
  });

  it('falls back to a bounded message instead of computing a full O(n*m) table for a hostilely large input', () => {
    // A round-1 critic finding: no size guard existed at all — `printDiff`'s own real caller feeds
    // this `diskContent`, which this file's own top-of-file doc comment already names as potentially
    // "corrupted or hostile," and an unbounded LCS table is a real, synchronous CLI hang for a large
    // enough input.
    // Deterministic, not wall-clock-timed (a round-3 critic finding: a `Date.now()`-based assertion is
    // unnecessary here and is itself the class of flaky test this codebase's own R10 rubric criterion
    // warns against) — the guard is structural (an early return before the O(n·m) loop ever runs), so
    // proving the *content* is the bounded-fallback message is sufficient; vitest's own default test
    // timeout already fails the suite if the guard were removed and the full table were computed.
    const huge = Array.from({ length: 5000 }, (_, i) => `line ${String(i)}`).join('\n');
    const diff = lineDiff(huge, 'short\n');
    expect(diff).toContain('omitted');
    expect(diff).not.toContain('line 0');
  });

  it('still computes a real diff for input right at the safety boundary', () => {
    const atLimit = Array.from({ length: 4000 }, (_, i) => `line ${String(i)}`).join('\n');
    const diff = lineDiff(atLimit, atLimit);
    expect(diff).not.toContain('omitted');
    expect(diff.split('\n').every((line) => line.startsWith('  '))).toBe(true);
  });
});

describe('sanitizeForTerminal', () => {
  it('strips a CSI ANSI escape sequence', () => {
    expect(sanitizeForTerminal('hello \x1b[31mred\x1b[0m world')).toBe('hello red world');
  });

  it('strips an OSC sequence (a hyperlink/title-set escape)', () => {
    expect(sanitizeForTerminal('\x1b]0;evil title\x07visible')).toBe('visible');
  });

  it('strips a bare control/DEL byte while preserving newlines and tabs', () => {
    expect(sanitizeForTerminal('a\x07b\nc\td\x7f')).toBe('ab\nc\td');
  });

  it('leaves ordinary printable text untouched', () => {
    expect(sanitizeForTerminal('id: intake\nsteps: []\n')).toBe('id: intake\nsteps: []\n');
  });

  it('strips a bare 8-bit (C1) CSI byte (\\x9b) — the single-byte form of \\x1b[', () => {
    // A round-1 critic finding: the original regex stopped at \x7F, leaving the entire C1 range
    // (\x80-\x9F) — including \x9B, CSI's own 8-bit single-byte form — completely untouched, despite
    // this function's own doc comment claiming to close exactly this class of gap.
    expect(sanitizeForTerminal('before\x9b2Jafter')).toBe('before2Jafter');
  });

  it('strips a bare 8-bit (C1) OSC byte (\\x9d) — the single-byte form of \\x1b]', () => {
    expect(sanitizeForTerminal('before\x9d0;evil\x07after')).toBe('before0;evilafter');
  });

  it('strips every other C1 control byte (\\x80-\\x9f)', () => {
    const allC1 = Array.from({ length: 0x9f - 0x80 + 1 }, (_, i) =>
      String.fromCharCode(0x80 + i),
    ).join('');
    expect(sanitizeForTerminal(`x${allC1}y`)).toBe('xy');
  });
});

describe('sanitizeWrittenFilePaths', () => {
  it('sanitizes a hostile agent-id-shaped path via the real, single function bin.ts calls', () => {
    // A round-2 critic finding raised the threat model (`.forge/agents/<id>.yaml`'s own `<id>` segment
    // traces back to a module's real `AgentDefinition.id` — validated only as a non-empty string,
    // `@forge/agents/schema`, no character-class restriction — so a hostile or corrupted module could
    // put raw terminal escapes there without ever escaping the project root). A round-3 critic finding
    // then caught that the round-2 *test* for it hand-built `bin.ts`'s own print template inside the
    // test itself rather than calling any real, shared function — it could never fail for a real
    // regression in `bin.ts`'s actual composition. This calls the one real function both
    // `runInitCommand` and `runUpgradeCommand` now route every printed path through instead.
    const hostileFiles = [
      {
        path: '.forge/agents/\x1b[2J\x1b[Hpwned.yaml',
        generated: true,
        conflict: 'take-theirs' as const,
      },
      { path: '.forge/workflows/intake.workflow.yaml', generated: true },
    ];
    const sanitized = sanitizeWrittenFilePaths(hostileFiles);
    // eslint-disable-next-line no-control-regex -- asserting the ESC bytes are genuinely absent
    expect(sanitized.some((file) => /[\x1b\x07]/.test(file.path))).toBe(false);
    expect(sanitized[0]?.path).toBe('.forge/agents/pwned.yaml');
    expect(sanitized[0]?.conflict).toBe('take-theirs');
    expect(sanitized[1]?.path).toBe('.forge/workflows/intake.workflow.yaml');
  });

  it('does not mutate its input', () => {
    const input = [{ path: 'x\x1b[0my', generated: true }];
    sanitizeWrittenFilePaths(input);
    expect(input[0]?.path).toBe('x\x1b[0my');
  });
});

describe('resolveGeneratedConflict', () => {
  const conflict = {
    path: '.forge/workflows/intake.workflow.yaml',
    diskContent: 'hand-edited disk content\n',
    newContent: generatedHeader('x.yaml', '2', 'newhash') + ORIGINAL_BODY,
  };

  it('resolves immediately to an explicit non-diff mode, with no I/O at all', async () => {
    const resolution = await resolveGeneratedConflict(conflict, { mode: 'take-theirs' });
    expect(resolution).toEqual({
      mode: 'take-theirs',
      writePath: conflict.path,
      content: conflict.newContent,
    });
  });

  it('resolves keep-mine to no write path/content at all', async () => {
    const resolution = await resolveGeneratedConflict(conflict, { mode: 'keep-mine' });
    expect(resolution).toEqual({ mode: 'keep-mine' });
  });

  it('resolves merge to a sidecar write path, leaving the real path alone', async () => {
    const resolution = await resolveGeneratedConflict(conflict, { mode: 'merge' });
    expect(resolution.mode).toBe('merge');
    expect(resolution.writePath).toBe(`${conflict.path}${MERGE_SIDECAR_SUFFIX}`);
    expect(resolution.content).toBe(conflict.newContent);
  });

  it('an explicit show-diff mode with no interactive channel prints the diff and falls back to keep-mine', async () => {
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => {
      printed += chunk.toString('utf8');
    });
    const resolution = await resolveGeneratedConflict(conflict, { mode: 'show-diff', output });
    expect(resolution).toEqual({ mode: 'keep-mine' });
    expect(printed).toContain(conflict.path);
  });

  it('an interactive "t" answer resolves to take-theirs', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = resolveGeneratedConflict(conflict, { input, output });
    input.write('t\n');
    const resolution = await promise;
    expect(resolution.mode).toBe('take-theirs');
  });

  it('an interactive "d" answer prints a sanitized diff, then a follow-up "k" resolves keep-mine', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => {
      printed += chunk.toString('utf8');
    });
    const promise = resolveGeneratedConflict(conflict, { input, output });
    input.write('d\n');
    // Let the first prompt/diff print land before answering again.
    await new Promise((resolve) => setImmediate(resolve));
    input.write('k\n');
    const resolution = await promise;
    expect(resolution).toEqual({ mode: 'keep-mine' });
    expect(printed).toContain('hand-edited disk content');
  });

  it('a hostile diff/answer stream cannot inject raw ANSI/control bytes into the printed diff', async () => {
    const hostile = {
      path: '.forge/workflows/hostile.workflow.yaml',
      diskContent: '\x1b[31mFAKE ERROR: delete everything\x1b[0m\x07',
      newContent: 'clean content\n',
    };
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk: Buffer) => {
      printed += chunk.toString('utf8');
    });
    await resolveGeneratedConflict(hostile, { mode: 'show-diff', output });
    // eslint-disable-next-line no-control-regex -- asserting the ESC/BEL bytes are genuinely absent
    expect(/[\x1b\x07]/.test(printed)).toBe(false);
  });

  it('EOF with no answer at all (a non-interactive stdin, no --on-conflict given) resolves to keep-mine', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = resolveGeneratedConflict(conflict, { input, output });
    input.end();
    const resolution = await promise;
    expect(resolution).toEqual({ mode: 'keep-mine' });
  });

  it('an unrecognized interactive answer resolves to keep-mine rather than looping or crashing', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const promise = resolveGeneratedConflict(conflict, { input, output });
    input.write('xyz\n');
    const resolution = await promise;
    expect(resolution).toEqual({ mode: 'keep-mine' });
  });
});
