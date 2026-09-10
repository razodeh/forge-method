/**
 * Branches the main conformance suite test doesn't reach: `normalizeReportedPath`'s absolute-path form
 * (the compliant stub only ever reports relative paths), `checkC3ToolRestriction`'s third refusal-signal
 * operand (`!result.ok`) — the compliant stub's `tool.result(ok:false)` always short-circuits `||`
 * before that operand is ever evaluated as the deciding factor — and `checkC2CwdIsolation`'s symlink
 * defence, which a gauntlet critic found the original version lacked entirely.
 *
 * @see specs/07 §7.6
 * @see PLAN-M4.md P4
 */
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkC2CwdIsolation,
  checkC3ToolRestriction,
  checkC14DeterminismOfReporting,
  normalizeReportedPath,
} from '../../src/conformance/filesystem.ts';
import { createConformanceContext } from '../../src/conformance/context.ts';
import {
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
} from '../../src/conformance/fixtures.ts';
import type { ConformanceOptions } from '../../src/conformance/fixtures.ts';
import type { AdapterCapabilities, PlatformAdapter } from '../../src/types/index.ts';

describe('normalizeReportedPath', () => {
  it('converts an absolute path to a cwd-relative, forward-slash form', () => {
    const cwd = path.join(path.sep, 'a', 'b');
    const absolute = path.join(cwd, 'nested', 'file.txt');
    expect(normalizeReportedPath(absolute, cwd)).toBe('nested/file.txt');
  });

  it('leaves an already-relative path unchanged apart from separator normalization', () => {
    expect(normalizeReportedPath('already/relative.txt', path.join(path.sep, 'a', 'b'))).toBe(
      'already/relative.txt',
    );
  });
});

function stubOptions(overrides: Partial<ConformanceOptions> = {}): ConformanceOptions {
  return {
    createScratchDir: () => Promise.resolve('/tmp/unused'),
    validModel: 'model',
    invalidModel: 'invalid-model',
    helloPrompt: 'hello',
    writeFilePrompt: 'write',
    manyTurnsPrompt: 'many-turns',
    execPrompt: 'exec',
    secretProbe: { value: 'secret', prompt: 'probe' },
    controlTokenPrompt: 'control',
    ...overrides,
  };
}

const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  partialText: false,
  sessionResume: false,
  interject: false,
  structuredOutput: false,
  toolAllowlist: true,
  permissionModes: ['auto'],
  subagents: false,
  mcp: false,
  costReporting: 'none',
  tokenReporting: true,
  maxConcurrentSessions: 0,
  cwdIsolation: true,
  systemPromptControl: 'append',
  fileEditing: true,
  bash: true,
  network: 'none',
  bareMode: true,
  skills: 'none',
  toolProxy: false,
};

describe('checkC3ToolRestriction — refusal signalled only via result.ok', () => {
  it('accepts result.ok === false, with no error event and no failed tool.result, as a valid refusal signal', async () => {
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () =>
        Promise.resolve({
          sessionId: 's1',
          events: {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({ done: true as const, value: undefined }),
            }),
          },
          stop: () => Promise.resolve(),
          result: () =>
            Promise.resolve({
              sessionId: 's1',
              ok: false, // the ONLY refusal signal — no error event, no failed tool.result
              finalText: 'cannot write',
              usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
              durationMs: 0,
              changedFiles: [],
              controlTokens: [],
            }),
        }),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const { context, setAdapter, setCapabilities } = createConformanceContext(stubOptions());
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC3ToolRestriction(context)).resolves.toBeUndefined();
  });
});

describe('checkC2CwdIsolation — symlink escape', () => {
  it('rejects a marker "file" that is actually a symlink pointing entirely outside cwd', async () => {
    // Real directories needed here (unlike the fake '/tmp/unused' elsewhere in this file): the check
    // under test genuinely calls fs.promises.realpath on both the marker path and cwd.
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'forge-c2-outside-'));
    const outsideFile = path.join(outsideDir, 'actually-here.txt');
    await writeFile(outsideFile, CONFORMANCE_WRITE_FILE_CONTENT, 'utf8');

    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: (request) =>
        symlink(outsideFile, path.join(request.cwd, CONFORMANCE_WRITE_FILE_RELATIVE_PATH)).then(
          () =>
            Promise.resolve({
              sessionId: 's1',
              events: {
                [Symbol.asyncIterator]: () => ({
                  next: () => Promise.resolve({ done: true as const, value: undefined }),
                }),
              },
              stop: () => Promise.resolve(),
              result: () =>
                Promise.resolve({
                  sessionId: 's1',
                  ok: true,
                  finalText: 'wrote it',
                  usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
                  durationMs: 0,
                  changedFiles: [CONFORMANCE_WRITE_FILE_RELATIVE_PATH],
                  controlTokens: [],
                }),
            }),
        ),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const options = stubOptions({
      createScratchDir: () => mkdtemp(path.join(tmpdir(), 'forge-c2-cwd-')),
    });
    const { context, setAdapter, setCapabilities } = createConformanceContext(options);
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC2CwdIsolation(context)).rejects.toThrow();
  });
});

describe('checkC14DeterminismOfReporting — a file inside a brand-new subdirectory', () => {
  it('accepts a fully compliant adapter that writes into, and accurately reports, a new subdirectory', async () => {
    // A gauntlet verify pass found git's own default untracked-files mode would have collapsed the new
    // directory into one "?? dir/" line, wrongly rejecting this exact compliant case (the adapter's own
    // accurate ['newmodule/index.ts'] would have mismatched git's collapsed ['newmodule/']) before
    // gitStatusPaths gained --untracked-files=all.
    const adapter: PlatformAdapter = {
      id: 'minimal',
      displayName: 'Minimal',
      capabilities: () => Promise.resolve(CAPABILITIES),
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: (request) =>
        mkdir(path.join(request.cwd, 'newmodule'))
          .then(() =>
            writeFile(path.join(request.cwd, 'newmodule', 'index.ts'), 'export {};', 'utf8'),
          )
          .then(() => ({
            sessionId: 's1',
            events: {
              [Symbol.asyncIterator]: () => ({
                next: () => Promise.resolve({ done: true as const, value: undefined }),
              }),
            },
            stop: () => Promise.resolve(),
            result: () =>
              Promise.resolve({
                sessionId: 's1',
                ok: true,
                finalText: 'wrote it',
                usage: { inputTokens: 0, outputTokens: 0, turns: 1 },
                durationMs: 0,
                changedFiles: ['newmodule/index.ts'],
                controlTokens: [],
              }),
          })),
      resumeSession: () => Promise.reject(new Error('not implemented for this test')),
    };
    const options = stubOptions({
      createScratchDir: () => mkdtemp(path.join(tmpdir(), 'forge-c14-cwd-')),
    });
    const { context, setAdapter, setCapabilities } = createConformanceContext(options);
    setAdapter(adapter);
    setCapabilities(await adapter.capabilities());
    await expect(checkC14DeterminismOfReporting(context)).resolves.toBeUndefined();
  });
});
