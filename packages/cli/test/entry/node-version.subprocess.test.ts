/**
 * `03` §3.1 step 1's exit(5): "a real subprocess-level test, not a mocked version check"
 * (`PLAN-M6.md` C1's own Checks section). A vitest `vi.fn()` stub of `isSupportedNodeVersion` would
 * prove nothing about the actual message or the actual exit code a real invocation produces — an
 * exit code is a process-level fact, observable only by actually spawning a process and reading
 * what it did. `../fixtures/node-version-guard.ts` is that real caller; this test spawns it as a
 * genuine child `node` process (the same `--experimental-strip-types` pattern
 * `@forge/telemetry/test/events.test.ts` already uses) and asserts on its real exit code and stderr.
 *
 * @see specs/03 §3.1
 * @see PLAN-M6.md C1
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIN_NODE_VERSION } from '../../src/entry/node-version.ts';

const fixturePath = fileURLToPath(new URL('./fixtures/node-version-guard.ts', import.meta.url));

function runGuard(
  fakeVersion: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--experimental-strip-types', fixturePath, fakeVersion]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('the Node-version guard, spawned as a real subprocess', () => {
  it('exits 5 and prints the required/actual versions for an unsupported Node', async () => {
    const result = await runGuard('v18.17.0');
    expect(result.code).toBe(5);
    expect(result.stderr).toContain(MIN_NODE_VERSION);
    expect(result.stderr).toContain('v18.17.0');
  });

  it('exits 0 for a supported Node', async () => {
    const result = await runGuard(`v${MIN_NODE_VERSION}`);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('OK');
  });
});
