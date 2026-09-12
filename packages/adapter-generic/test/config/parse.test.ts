/**
 * `parseAdapterConfig` proven against `07` §7.5's own worked-example `adapter.yaml`, matched exactly,
 * and against a deliberately-broken variant (`binary` renamed to `bin`) — `PLAN-M11.md` P7's own Checks
 * line: "a deliberately-broken adapter.yaml (a required field renamed) fails to even construct an
 * adapter... a real refusal, not a silent partial adapter."
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { parseAdapterConfig } from '../../src/config/parse.ts';
import { GenericAdapterConfigError } from '../../src/config/errors.ts';

// node:os's tmpdir is R10-restricted in production code only; this file is a *.test.ts, exempted by
// this repo's own eslint config (the same precedent `scripted-binary.test.ts`'s own doc comment cites).
async function createScratchDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-adapter-generic-parse-test-'));
}

const scratchDirs: string[] = [];
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const EXAMPLE_PATH = fileURLToPath(new URL('../fixtures/adapter.example.yaml', import.meta.url));
const BROKEN_PATH = fileURLToPath(new URL('../fixtures/adapter.broken.yaml', import.meta.url));

describe('parseAdapterConfig: 07 §7.5 worked example, matched exactly', () => {
  it('parses every field of the worked example verbatim', async () => {
    const config = await parseAdapterConfig(EXAMPLE_PATH);
    expect(config).toEqual({
      id: 'my-platform',
      displayName: 'My Platform',
      binary: 'myagent',
      minimumVersion: '1.4.0',
      versionCommand: ['--version'],
      versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
      capabilities: {
        streaming: true,
        sessionResume: false,
        structuredOutput: false,
        toolAllowlist: true,
        cwdIsolation: true,
        costReporting: 'none',
      },
      invoke: {
        args: ['--prompt-file', '{{promptFile}}', '--cwd', '{{cwd}}', '--model', '{{model}}'],
        when: [
          { if: 'tools.write == false', args: ['--read-only'] },
          { if: 'limits.maxTurns', args: ['--max-steps', '{{limits.maxTurns}}'] },
        ],
        stdin: 'none',
        env: { MYAGENT_NO_COLOR: '1' },
      },
      events: {
        format: 'ndjson',
        map: [
          {
            match: { type: 'message', role: 'assistant' },
            emit: { type: 'text', text: '{{.content}}' },
          },
          {
            match: { type: 'tool_call' },
            emit: { type: 'tool.call', name: '{{.tool}}', input: '{{.args}}' },
          },
          { match: { type: 'done' }, emit: { type: 'session.ended', reason: 'complete' } },
        ],
      },
      result: { successExitCodes: [0], finalTextFrom: 'lastAssistantText' },
      files: { changeDetection: 'git-status' },
    });
  });
});

describe('parseAdapterConfig: real refusals, not a silent partial adapter', () => {
  it('rejects a document with a required field renamed (binary -> bin)', async () => {
    await expect(parseAdapterConfig(BROKEN_PATH)).rejects.toThrow(GenericAdapterConfigError);
    try {
      await parseAdapterConfig(BROKEN_PATH);
      throw new Error('expected parseAdapterConfig to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(GenericAdapterConfigError);
      const configError = error as GenericAdapterConfigError;
      expect(configError.code).toBe('ADP-GENERIC-CONFIG-SCHEMA');
      expect(configError.message).toContain('binary');
      expect(configError.remedy.length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing file', async () => {
    const dir = await createScratchDir();
    scratchDirs.push(dir);
    await expect(parseAdapterConfig(path.join(dir, 'does-not-exist.yaml'))).rejects.toMatchObject({
      code: 'ADP-GENERIC-CONFIG-UNREADABLE',
    });
  });

  it('rejects invalid YAML syntax', async () => {
    const dir = await createScratchDir();
    scratchDirs.push(dir);
    const invalidPath = path.join(dir, 'invalid.yaml');
    await writeFile(invalidPath, 'id: [unterminated', 'utf8');
    await expect(parseAdapterConfig(invalidPath)).rejects.toMatchObject({
      code: 'ADP-GENERIC-CONFIG-INVALID-YAML',
    });
  });

  it('rejects a document that is valid YAML but not an object at all', async () => {
    const dir = await createScratchDir();
    scratchDirs.push(dir);
    const scalarPath = path.join(dir, 'scalar.yaml');
    await writeFile(scalarPath, 'just a string\n', 'utf8');
    await expect(parseAdapterConfig(scalarPath)).rejects.toMatchObject({
      code: 'ADP-GENERIC-CONFIG-SCHEMA',
    });
  });
});
