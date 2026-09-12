/**
 * `synthesizeToolResult`/`resolveFinalText` proven directly, without spawning a real process — round-1
 * critic findings: (1) `tools.write === false` had no adapter-side backstop at all beyond trusting the
 * bound binary to honour `invoke.when`'s own `--read-only` flag; (2) `result.finalTextFrom:
 * file:{{outFile}}` was wired through an inconsistent, `invoke.args`-incompatible ad hoc mechanism.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P7
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AdapterEvent, SessionRequest } from '@forge/adapter-kit';

import {
  appendBounded,
  MAX_ACCUMULATOR_BYTES,
  resolveFinalText,
  synthesizeToolResult,
} from '../src/session-stream.ts';
import { adapterYamlConfigSchema, type AdapterYamlConfig } from '../src/config/schema.ts';
import type { InvokeTemplateVars } from '../src/templates.ts';

// node:os's tmpdir is R10-restricted in production code only; this file is a *.test.ts, exempted by
// this repo's own eslint config.
const scratchDirs: string[] = [];
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function createScratchDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-generic-session-stream-test-'));
  scratchDirs.push(dir);
  return dir;
}

function toolCall(
  input: unknown,
  name = 'a-tool',
  id = 'call-1',
): Extract<AdapterEvent, { readonly type: 'tool.call' }> {
  return { type: 'tool.call', id, name, input };
}

const FULL_GRANT: SessionRequest['tools'] = {
  read: true,
  write: true,
  exec: ['echo *'],
  network: 'none',
};

describe('synthesizeToolResult: refused convention (P8 scripted-binary.ts write-escape shape)', () => {
  it('denies when input.refused is true, regardless of any grant', () => {
    const result = synthesizeToolResult(
      toolCall({ path: 'x.txt', refused: true, reason: 'resolves outside the invocation cwd' }),
      FULL_GRANT,
    );
    expect(result).toEqual({
      type: 'tool.result',
      id: 'call-1',
      ok: false,
      summary: 'a-tool denied: resolves outside the invocation cwd',
    });
  });
});

describe('synthesizeToolResult: tools.write backstop (round-1 critic finding, tightened round 2)', () => {
  it('denies a write-shaped call (name write_file, a path/relativePath field) when grant.write is false', () => {
    const denyingGrant: SessionRequest['tools'] = { ...FULL_GRANT, write: false };
    expect(synthesizeToolResult(toolCall({ path: 'out.txt' }, 'write_file'), denyingGrant)).toEqual(
      {
        type: 'tool.result',
        id: 'call-1',
        ok: false,
        summary: 'write_file denied: write grant is false',
      },
    );
    expect(
      synthesizeToolResult(toolCall({ relativePath: 'out.txt' }, 'edit_file'), denyingGrant),
    ).toMatchObject({ ok: false });
    // camelCase tool names are recognised too.
    expect(
      synthesizeToolResult(toolCall({ path: 'out.txt' }, 'writeFile'), denyingGrant),
    ).toMatchObject({ ok: false });
    expect(
      synthesizeToolResult(toolCall({ path: 'out.txt' }, 'delete_file'), denyingGrant),
    ).toMatchObject({ ok: false });
  });

  it('permits a write-shaped call when grant.write is true', () => {
    expect(synthesizeToolResult(toolCall({ path: 'out.txt' }, 'write_file'), FULL_GRANT)).toEqual({
      type: 'tool.result',
      id: 'call-1',
      ok: true,
      summary: 'write_file succeeded',
    });
  });

  it('round-2 critic finding: never denies a read-shaped call, even with a path field, when grant.write is false', () => {
    // 07 §7.2's own ToolGrant has independent read/write booleans precisely because the two are
    // separately grantable -- a session granted read:true, write:false (an ordinary "review this file"
    // combination) must not have every path-referencing *read* call misreported as a denied write.
    const readOnlyGrant: SessionRequest['tools'] = { ...FULL_GRANT, read: true, write: false };
    expect(
      synthesizeToolResult(toolCall({ path: 'src/index.ts' }, 'read_file'), readOnlyGrant),
    ).toEqual({
      type: 'tool.result',
      id: 'call-1',
      ok: true,
      summary: 'read_file succeeded',
    });
    expect(
      synthesizeToolResult(toolCall({ path: 'src/index.ts' }, 'cat'), readOnlyGrant),
    ).toMatchObject({ ok: true });
    expect(
      synthesizeToolResult(toolCall({ pattern: 'TODO', path: 'src' }, 'grep'), readOnlyGrant),
    ).toMatchObject({ ok: true });
  });

  it('does not false-positive on a tool name that merely contains "write"/"edit" as a substring, not a whole word', () => {
    // A hypothetical tool honestly named this way is not a write -- whole-word matching only.
    const denyingGrant: SessionRequest['tools'] = { ...FULL_GRANT, write: false };
    expect(
      synthesizeToolResult(toolCall({ path: 'x.txt' }, 'rewrite_summary'), denyingGrant),
    ).toMatchObject({ ok: true });
    expect(
      synthesizeToolResult(toolCall({ path: 'x.txt' }, 'overwritten_by'), denyingGrant),
    ).toMatchObject({ ok: true });
  });
});

describe("synthesizeToolResult: exec grant (07 §7.2's own shared isExecAllowed)", () => {
  it('permits an allowed command, denies a disallowed one', () => {
    expect(synthesizeToolResult(toolCall({ command: 'echo hi' }), FULL_GRANT)).toMatchObject({
      ok: true,
    });
    expect(synthesizeToolResult(toolCall({ command: 'rm -rf /' }), FULL_GRANT)).toMatchObject({
      ok: false,
    });
  });
});

describe('synthesizeToolResult: default', () => {
  it('reports ok: true for a tool call whose input matches none of the recognised conventions', () => {
    expect(synthesizeToolResult(toolCall({ anything: 'else' }), FULL_GRANT)).toEqual({
      type: 'tool.result',
      id: 'call-1',
      ok: true,
      summary: 'a-tool succeeded',
    });
  });

  it('also reports ok: true for a non-object input', () => {
    expect(synthesizeToolResult(toolCall('a string'), FULL_GRANT)).toMatchObject({ ok: true });
    expect(synthesizeToolResult(toolCall(undefined), FULL_GRANT)).toMatchObject({ ok: true });
  });
});

function buildConfig(finalTextFrom: string): AdapterYamlConfig {
  return adapterYamlConfigSchema.parse({
    id: 'fixture-tool',
    displayName: 'Fixture Tool',
    binary: 'fixture-tool',
    minimumVersion: '1.0.0',
    versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
    capabilities: {
      streaming: true,
      sessionResume: false,
      structuredOutput: false,
      toolAllowlist: true,
      cwdIsolation: true,
      costReporting: 'none',
    },
    invoke: { args: [], stdin: 'none' },
    events: { format: 'ndjson', map: [] },
    result: { successExitCodes: [0], finalTextFrom },
    files: { changeDetection: 'git-status' },
  });
}

const BASE_VARS: InvokeTemplateVars = {
  promptFile: undefined,
  outFile: undefined,
  cwd: '/lane',
  model: 'm1',
  permissionMode: 'auto',
  tools: { read: true, write: true, network: 'none' },
  limits: { maxTurns: undefined, wallClockMs: undefined, maxCostUsd: undefined },
};

describe('resolveFinalText', () => {
  it('lastAssistantText: returns the accumulated last-assistant text', async () => {
    const text = await resolveFinalText(
      buildConfig('lastAssistantText'),
      BASE_VARS,
      'hi there',
      'raw stdout',
    );
    expect(text).toBe('hi there');
  });

  it('stdout: returns the raw accumulated stdout', async () => {
    const text = await resolveFinalText(buildConfig('stdout'), BASE_VARS, 'hi there', 'raw stdout');
    expect(text).toBe('raw stdout');
  });

  it('file:{{outFile}}: reads the real file at the resolved outFile path (round-1 critic fix)', async () => {
    const dir = await createScratchDir();
    const outFile = path.join(dir, 'out.txt');
    await writeFile(outFile, 'structured result content', 'utf8');
    const vars: InvokeTemplateVars = { ...BASE_VARS, outFile };
    const text = await resolveFinalText(
      buildConfig('file:{{outFile}}'),
      vars,
      'ignored',
      'ignored',
    );
    expect(text).toBe('structured result content');
  });

  it('file:{{outFile}}: returns empty string, never throws, when the file was never written', async () => {
    const dir = await createScratchDir();
    const outFile = path.join(dir, 'never-written.txt');
    const vars: InvokeTemplateVars = { ...BASE_VARS, outFile };
    const text = await resolveFinalText(
      buildConfig('file:{{outFile}}'),
      vars,
      'ignored',
      'ignored',
    );
    expect(text).toBe('');
  });

  it('file:{{outFile}}: returns empty string when outFile itself is undefined', async () => {
    const text = await resolveFinalText(
      buildConfig('file:{{outFile}}'),
      BASE_VARS,
      'ignored',
      'ignored',
    );
    expect(text).toBe('');
  });
});

describe('appendBounded: unbounded-accumulation guard (round-2 critic finding, tightened round 3)', () => {
  it('appends normally while under the cap', () => {
    expect(appendBounded('hello ', 'world')).toBe('hello world');
    expect(appendBounded('', 'first')).toBe('first');
  });

  it('stops growing once the cap is reached, silently dropping further content', () => {
    const atCap = 'x'.repeat(MAX_ACCUMULATOR_BYTES);
    expect(appendBounded(atCap, 'more').length).toBe(MAX_ACCUMULATOR_BYTES);
    expect(appendBounded(atCap, 'more')).toBe(atCap);
  });

  it('never grows past the cap even when the addition itself would cross it', () => {
    const justUnderCap = 'x'.repeat(MAX_ACCUMULATOR_BYTES - 3);
    const result = appendBounded(justUnderCap, 'more');
    expect(result.length).toBe(MAX_ACCUMULATOR_BYTES);
    // The part of `addition` that fits (3 of its 4 characters -- only 3 bytes of room remained) is
    // kept, not dropped wholesale.
    expect(result.endsWith('mor')).toBe(true);
  });

  it('round-3 critic finding: clamps a single, arbitrarily large addition against a near-empty accumulator', () => {
    // The round-2 version only ever checked `current`'s own length *before* appending, never bounding
    // `addition` itself -- a real spawned process's own single no-newline stdout burst (execa's own
    // `lines: true` mode delivers exactly this as one line, however large, confirmed empirically by a
    // round-3 critic against a real child process) would have bypassed the cap completely:
    // `appendBounded('', hugeLine)` used to unconditionally return the entire `hugeLine` unclamped.
    const hugeAddition = 'y'.repeat(MAX_ACCUMULATOR_BYTES + 5_000_000);
    const result = appendBounded('', hugeAddition);
    expect(result.length).toBe(MAX_ACCUMULATOR_BYTES);
  });
});
