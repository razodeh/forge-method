/**
 * `checkJsonContract` and the `assert-json-contract.mjs` command wrapper.
 *
 * `specs/22` M6's own Check: `assert-json-contract.mjs` genuinely fails on a deliberately malformed
 * `--json` stream in its own test, not only passes on well-formed input.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { checkJsonContract } from './lib/json-contract.mjs';

const contractScript = fileURLToPath(new URL('assert-json-contract.mjs', import.meta.url));

function runScript(input: string): { readonly status: number; readonly stderr: string } {
  try {
    execFileSync('node', [contractScript], { input, stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: 0, stderr: '' };
  } catch (error) {
    const execError = error as { readonly status: number; readonly stderr: Buffer };
    return { status: execError.status, stderr: execError.stderr.toString('utf8') };
  }
}

describe('checkJsonContract', () => {
  it('reports no violations for a real, well-formed {"v":1,...} document', () => {
    expect(checkJsonContract('{"v":1,"ok":true}')).toEqual([]);
  });

  it('reports a violation for text that is not valid JSON at all', () => {
    const violations = checkJsonContract('not json{');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('not valid JSON');
  });

  it('reports a violation for a top-level array or scalar, not an object', () => {
    expect(checkJsonContract('[1,2,3]')[0]).toContain('must be a real object');
    expect(checkJsonContract('42')[0]).toContain('must be a real object');
  });

  it('reports a violation when "v" is missing entirely', () => {
    expect(checkJsonContract('{"ok":true}')[0]).toContain('missing required "v" field');
  });

  it('reports a violation when "v" is present but not the literal number 1', () => {
    expect(checkJsonContract('{"v":2}')[0]).toContain('must be the literal number 1');
    expect(checkJsonContract('{"v":"1"}')[0]).toContain('must be the literal number 1');
  });

  it('reports a violation for a field carrying the literal string "undefined"', () => {
    expect(checkJsonContract('{"v":1,"runId":"undefined"}')[0]).toContain(
      'likely a serialization bug',
    );
  });

  it('catches a real serialization bug nested inside a real, RunStatusReport-shaped envelope', () => {
    // A critic round caught the original version only ever walking the top-level object's own
    // fields -- exactly where none of this codebase's real `--json` envelopes keep their interesting
    // content. `RunStatusReport` (this exit test's actual real target) nests every real field one
    // level under `status`; this reproduces that exact real shape with a real bug in it.
    const runStatusShaped = JSON.stringify({
      v: 1,
      status: { runId: 'run-1', runStatus: 'completed', stepCounts: { succeeded: 'undefined' } },
    });
    const violations = checkJsonContract(runStatusShaped);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('$.status.stepCounts.succeeded');
    expect(violations[0]).toContain('likely a serialization bug');
  });

  it('catches a real serialization bug nested inside a real array element (DoctorReport-shaped)', () => {
    const doctorShaped = JSON.stringify({
      v: 1,
      ok: false,
      checks: [
        { id: 'a', ok: true, severity: 'hard', message: 'fine' },
        { id: 'b', ok: false, severity: 'hard', message: 'undefined' },
      ],
    });
    const violations = checkJsonContract(doctorShaped);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('$.checks[1].message');
  });

  it('accepts a real, multi-field envelope shaped like this codebase’s own real DoctorReport/RunStatusReport output', () => {
    const doctorShaped = JSON.stringify({
      v: 1,
      ok: true,
      checks: [{ id: 'node-version', ok: true, severity: 'hard', message: 'fine' }],
    });
    expect(checkJsonContract(doctorShaped)).toEqual([]);
  });
});

describe('assert-json-contract.mjs (real subprocess)', () => {
  it('exits 0 for a real, well-formed stream on real stdin', () => {
    const result = runScript('{"v":1,"ok":true}');
    expect(result.status).toBe(0);
  });

  it('exits non-zero and names the real violation for a deliberately malformed stream', () => {
    const result = runScript('{"ok":true}');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing required "v" field');
  });

  it('exits non-zero for a stream that is not JSON at all', () => {
    const result = runScript('this is not json');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not valid JSON');
  });
});
