/**
 * `scripted-binary.ts` proven as what it actually is: a real, separate OS process, spawned exactly
 * the way a real `07` §7.5 `GenericAdapter` will spawn a real external tool (`node
 * --experimental-strip-types`, this repository's own established no-build-step fixture pattern), not
 * imported and called in-process. Every scripted-response field `scripted-binary-protocol.ts` defines
 * is exercised here against the genuine subprocess before any later piece (`P7`,
 * `@forge/adapter-generic`'s own real `GenericAdapter`) is ever allowed to depend on it, per
 * `PLAN-M11.md` P8's own Checks line.
 *
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P8
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { ScriptedBinaryTable } from './scripted-binary-protocol.ts';

// Not a shared helper: node:os's tmpdir is R10-restricted in production code
// (packages/engine/test/dispatch/helpers.ts's own doc comment has the fuller reasoning); this file is
// a *.test.ts, which the repo's own eslint config exempts.
async function createScratchDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `forge-adapter-generic-${prefix}-`));
}

const FIXTURE_PATH = fileURLToPath(new URL('./scripted-binary.ts', import.meta.url));

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface RunOptions {
  readonly promptFile?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly extraArgs?: readonly string[];
}

const scratchDirs: string[] = [];
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeTable(table: ScriptedBinaryTable): Promise<string> {
  const dir = await createScratchDir('table');
  scratchDirs.push(dir);
  const tablePath = path.join(dir, 'table.json');
  await writeFile(tablePath, JSON.stringify(table), 'utf8');
  return tablePath;
}

/** Spawns the real fixture process to completion and collects its full stdout/stderr/exit — used by
 * every test except the hang test, which needs to observe the process while it is still running. */
async function run(tablePath: string, options: RunOptions = {}, stdin?: string): Promise<RunResult> {
  const args = ['--experimental-strip-types', FIXTURE_PATH, '--forge-fixture-table', tablePath];
  if (options.promptFile !== undefined) args.push('--prompt-file', options.promptFile);
  if (options.cwd !== undefined) args.push('--cwd', options.cwd);
  if (options.model !== undefined) args.push('--model', options.model);
  if (options.extraArgs !== undefined) args.push(...options.extraArgs);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (exitCode, signal) => { resolve({ stdout, stderr, exitCode, signal }); });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function ndjsonLines(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);
}

describe('scripted-binary.ts: hello / text scenario (07 §7.6 C1, C7)', () => {
  it('emits one message event per scripted text entry, a usage event, then done, and exits 0', async () => {
    const tablePath = await writeTable({
      entries: [
        {
          match: { promptContains: 'hello' },
          response: { text: ['hi there'], usage: { inputTokens: 12, outputTokens: 7 } },
        },
      ],
    });
    const promptDir = await createScratchDir('prompt');
    scratchDirs.push(promptDir);
    const promptFile = path.join(promptDir, 'prompt.txt');
    await writeFile(promptFile, 'please say hello', 'utf8');

    const result = await run(tablePath, { promptFile, model: 'forge-fixture-model' });

    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'message', role: 'assistant', content: 'hi there' },
      { type: 'usage', inputTokens: 12, outputTokens: 7 },
      { type: 'done' },
    ]);
  });

  it('reads the prompt from stdin when no --prompt-file is given, matching invoke.stdin: prompt', async () => {
    const tablePath = await writeTable({
      entries: [{ match: { promptContains: 'via stdin' }, response: { text: ['read from stdin'] } }],
    });
    const result = await run(tablePath, {}, 'a prompt delivered via stdin');
    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'message', role: 'assistant', content: 'read from stdin' },
      { type: 'done' },
    ]);
  });

  it('falls back to the default response when no scripted entry matches the invocation', async () => {
    const tablePath = await writeTable({
      entries: [{ match: { promptContains: 'never matches' }, response: { text: ['unused'] } }],
    });
    const result = await run(tablePath, {}, 'something else entirely');
    expect(result.exitCode).toBe(0);
    const lines = ndjsonLines(result.stdout);
    expect(lines[0]).toMatchObject({ type: 'message', role: 'assistant' });
    expect(lines.at(-1)).toEqual({ type: 'done' });
  });
});

describe('scripted-binary.ts: write files (07 §7.6 C2, C14)', () => {
  it('actually writes scripted files under the invocation cwd and announces each as a tool_call', async () => {
    const cwd = await createScratchDir('cwd');
    scratchDirs.push(cwd);
    const tablePath = await writeTable({
      entries: [
        {
          match: {},
          response: { writeFiles: [{ relativePath: 'out.txt', content: 'forge-marker' }] },
        },
      ],
    });

    const result = await run(tablePath, { cwd });

    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toContainEqual({
      type: 'tool_call',
      tool: 'write_file',
      args: { path: 'out.txt' },
    });
    await expect(readFile(path.join(cwd, 'out.txt'), 'utf8')).resolves.toBe('forge-marker');
  });

  it('refuses a scripted write that escapes the invocation cwd via ../ traversal, and writes nothing outside it', async () => {
    const cwd = await createScratchDir('cwd');
    scratchDirs.push(cwd);
    const outsideMarker = path.join(path.dirname(cwd), 'escape-marker.txt');
    await rm(outsideMarker, { force: true });
    const tablePath = await writeTable({
      entries: [
        {
          match: {},
          response: {
            writeFiles: [{ relativePath: '../escape-marker.txt', content: 'should never land here' }],
          },
        },
      ],
    });

    const result = await run(tablePath, { cwd });

    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([
      {
        type: 'tool_call',
        tool: 'write_file',
        args: {
          path: '../escape-marker.txt',
          refused: true,
          reason: 'resolves outside the invocation cwd',
        },
      },
      { type: 'done' },
    ]);
    await expect(readFile(outsideMarker, 'utf8')).rejects.toThrow();
  });

  it('refuses a scripted write using an absolute path, treating it identically to a traversal escape', async () => {
    const cwd = await createScratchDir('cwd');
    scratchDirs.push(cwd);
    const absoluteTarget = path.join(cwd, '..', 'absolute-marker.txt');
    await rm(absoluteTarget, { force: true });
    const tablePath = await writeTable({
      entries: [
        { match: {}, response: { writeFiles: [{ relativePath: absoluteTarget, content: 'x' }] } },
      ],
    });

    const result = await run(tablePath, { cwd });

    expect(ndjsonLines(result.stdout)).toEqual([
      {
        type: 'tool_call',
        tool: 'write_file',
        args: { path: absoluteTarget, refused: true, reason: 'resolves outside the invocation cwd' },
      },
      { type: 'done' },
    ]);
    await expect(readFile(absoluteTarget, 'utf8')).rejects.toThrow();
  });

  it('refuses every scripted write when no --cwd was given at all, rather than defaulting to this process\'s own real cwd', async () => {
    // The real gap a fresh critic round found in an earlier draft: `resolveInsideCwd` used to default
    // a missing `cwd` to `.`, which is *this test process's own real working directory* -- silently
    // writing into the repository itself. `unlikelyMarker` names a file this real repo checkout must
    // never contain; its absence after the run is the actual proof, not merely that the fixture
    // reported a refusal.
    const unlikelyMarkerName = 'forge-adapter-generic-missing-cwd-marker.txt';
    const unlikelyMarkerPath = path.join(process.cwd(), unlikelyMarkerName);
    await rm(unlikelyMarkerPath, { force: true });
    const tablePath = await writeTable({
      entries: [
        { match: {}, response: { writeFiles: [{ relativePath: unlikelyMarkerName, content: 'x' }] } },
      ],
    });

    const result = await run(tablePath, {});

    try {
      expect(ndjsonLines(result.stdout)).toEqual([
        {
          type: 'tool_call',
          tool: 'write_file',
          args: {
            path: unlikelyMarkerName,
            refused: true,
            reason: 'resolves outside the invocation cwd',
          },
        },
        { type: 'done' },
      ]);
      await expect(readFile(unlikelyMarkerPath, 'utf8')).rejects.toThrow();
    } finally {
      await rm(unlikelyMarkerPath, { force: true });
    }
  });

  it('writes outFile to disk without emitting any event for it (file:{{outFile}} channel)', async () => {
    const cwd = await createScratchDir('cwd');
    scratchDirs.push(cwd);
    const tablePath = await writeTable({
      entries: [
        {
          match: {},
          response: { outFile: { relativePath: 'result.json', content: '{"ok":true}' } },
        },
      ],
    });

    const result = await run(tablePath, { cwd });

    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([{ type: 'done' }]);
    await expect(readFile(path.join(cwd, 'result.json'), 'utf8')).resolves.toBe('{"ok":true}');
  });

  it('silently refuses an outFile that escapes cwd -- nothing is written, since this channel has no event to report through', async () => {
    const cwd = await createScratchDir('cwd');
    scratchDirs.push(cwd);
    const outsideMarker = path.join(path.dirname(cwd), 'outfile-escape-marker.json');
    await rm(outsideMarker, { force: true });
    const tablePath = await writeTable({
      entries: [
        {
          match: {},
          response: { outFile: { relativePath: '../outfile-escape-marker.json', content: '{}' } },
        },
      ],
    });

    const result = await run(tablePath, { cwd });

    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([{ type: 'done' }]);
    await expect(readFile(outsideMarker, 'utf8')).rejects.toThrow();
  });
});

describe('scripted-binary.ts: tool calls (07 §7.6 C4)', () => {
  it('reports both an allowed-shaped and a denied-shaped exec tool call verbatim, without judging them', async () => {
    const tablePath = await writeTable({
      entries: [
        {
          match: {},
          response: {
            toolCalls: [
              { tool: 'exec', args: { command: 'echo hi' } },
              { tool: 'exec', args: { command: 'rm -rf conformance-canary.txt' } },
            ],
          },
        },
      ],
    });
    const result = await run(tablePath, {});
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'tool_call', tool: 'exec', args: { command: 'echo hi' } },
      { type: 'tool_call', tool: 'exec', args: { command: 'rm -rf conformance-canary.txt' } },
      { type: 'done' },
    ]);
  });
});

describe('scripted-binary.ts: structured output (07 §7.6 C8)', () => {
  it('emits a result event carrying the scripted structured value', async () => {
    const tablePath = await writeTable({
      entries: [{ match: {}, response: { structured: { answer: 42 } } }],
    });
    const result = await run(tablePath, {});
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'result', structured: { answer: 42 } },
      { type: 'done' },
    ]);
  });
});

describe('scripted-binary.ts: error surface and non-zero exit (07 §7.6 C11)', () => {
  it('emits a typed error event, skips done, and exits with the scripted code', async () => {
    const tablePath = await writeTable({
      entries: [
        {
          match: { modelEquals: 'not-a-real-model' },
          response: { errorInfo: { code: 'UNKNOWN_MODEL', message: 'no such model' }, exitCode: 1 },
        },
      ],
    });
    const result = await run(tablePath, { model: 'not-a-real-model' });
    expect(result.exitCode).toBe(1);
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'error', code: 'UNKNOWN_MODEL', message: 'no such model' },
    ]);
  });

  it('skips done on a bare non-zero exit with no typed error line, distinguishing the two failure shapes', async () => {
    const tablePath = await writeTable({
      entries: [{ match: {}, response: { text: ['partial output'], exitCode: 3 } }],
    });
    const result = await run(tablePath, {});
    expect(result.exitCode).toBe(3);
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'message', role: 'assistant', content: 'partial output' },
    ]);
  });

  it('supports omitDone: a clean-exit-code process that never sends a done line', async () => {
    const tablePath = await writeTable({
      entries: [{ match: {}, response: { text: ['abrupt'], omitDone: true } }],
    });
    const result = await run(tablePath, {});
    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'message', role: 'assistant', content: 'abrupt' },
    ]);
  });
});

describe('scripted-binary.ts: malformed output injection (07 §7.6)', () => {
  it('emits one line that is not valid JSON, ahead of any well-formed events', async () => {
    const tablePath = await writeTable({
      entries: [{ match: {}, response: { malformedLine: true, text: ['still here'] } }],
    });
    const result = await run(tablePath, {});
    const rawLines = result.stdout.split('\n').filter((line) => line !== '');
    expect(() => {
      JSON.parse(rawLines[0] ?? '');
    }).toThrow();
    expect(rawLines.slice(1).map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: 'message', role: 'assistant', content: 'still here' },
      { type: 'done' },
    ]);
  });
});

describe('scripted-binary.ts: --version (07 §7.5 versionCommand/versionRegex)', () => {
  it('prints v{table.version} and exits 0, ignoring every other flag', async () => {
    const tablePath = await writeTable({ entries: [], version: '2.3.1' });
    const result = await run(tablePath, { extraArgs: ['--version'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('v2.3.1\n');
  });

  it('defaults to v1.4.0 when the table has no version field', async () => {
    const tablePath = await writeTable({ entries: [] });
    const result = await run(tablePath, { extraArgs: ['--version'] });
    expect(result.stdout).toBe('v1.4.0\n');
  });
});

describe('scripted-binary.ts: delayMsBeforeExit (scripted-slow-binary fixture need)', () => {
  it('emits its output immediately but only exits after the scripted delay has elapsed', async () => {
    const tablePath = await writeTable({
      entries: [{ match: {}, response: { text: ['slow'], delayMsBeforeExit: 200 } }],
    });
    const started = Date.now();
    const result = await run(tablePath, {});
    const elapsedMs = Date.now() - started;

    expect(result.exitCode).toBe(0);
    expect(ndjsonLines(result.stdout)).toEqual([
      { type: 'message', role: 'assistant', content: 'slow' },
      { type: 'done' },
    ]);
    // Loose bound (not an exact-timing assertion): proves the delay is real wall-clock time, not that
    // this scheduler is precise to the millisecond, which the underlying OS/event loop does not
    // guarantee either way.
    expect(elapsedMs).toBeGreaterThanOrEqual(180);
  });
});

describe('scripted-binary.ts: missing/malformed --forge-fixture-table (crash-shape regression guard)', () => {
  it('exits 1 with a non-empty stderr when the named table file does not exist', async () => {
    const dir = await createScratchDir('missing');
    scratchDirs.push(dir);
    const missingPath = path.join(dir, 'does-not-exist.json');
    const result = await run(missingPath, {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toBe('');
    expect(result.stdout).toBe('');
  });

  it('exits 1 with a non-empty stderr when the table file is not valid JSON', async () => {
    const dir = await createScratchDir('malformed-table');
    scratchDirs.push(dir);
    const tablePath = path.join(dir, 'table.json');
    await writeFile(tablePath, 'this is not json', 'utf8');
    const result = await run(tablePath, {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toBe('');
  });
});

describe('scripted-binary.ts: hang / abort (07 §7.6 C5)', () => {
  it('ignores SIGTERM and only truly exits on SIGKILL, proving no orphan survives a real kill', async () => {
    const tablePath = await writeTable({
      entries: [{ match: {}, response: { text: ['before the hang'], hang: true } }],
    });
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', FIXTURE_PATH, '--forge-fixture-table', tablePath],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const pid = child.pid;
    if (pid === undefined) throw new Error('child process failed to spawn (no pid)');
    child.stdin.end();

    // Wait for the fixture's own leading output before doing anything to it, so this test proves the
    // hang happens *after* real output, not merely that a not-yet-started process is slow.
    const sawLeadingOutput = await new Promise<boolean>((resolve) => {
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes('before the hang')) resolve(true);
      });
      setTimeout(() => { resolve(false); }, 5_000);
    });
    expect(sawLeadingOutput).toBe(true);

    const exitedAfterSigterm = await new Promise<boolean>((resolve) => {
      child.once('exit', () => { resolve(true); });
      process.kill(pid, 'SIGTERM');
      setTimeout(() => { resolve(false); }, 500);
    });
    expect(exitedAfterSigterm).toBe(false);

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('exit', (code, signal) => { resolve({ code, signal }); });
        process.kill(pid, 'SIGKILL');
      },
    );
    expect(exit.signal).toBe('SIGKILL');

    // The real proof of "no orphan child processes" (07 §7.6 C5): the OS no longer has this pid at
    // all. `process.kill(pid, 0)` throws ESRCH once the process is genuinely gone.
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  }, 10_000);
});
