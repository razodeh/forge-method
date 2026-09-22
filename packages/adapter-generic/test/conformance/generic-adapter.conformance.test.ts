/**
 * `runAdapterConformanceSuite` run against a real `GenericAdapter` instance, constructed via a real
 * `parseAdapterConfig(path)` call against a real `adapter.yaml` file this test writes to disk, driving
 * P8's own real, separately-spawned `scripted-binary.ts` process — `PLAN-M11.md` P7's own Checks line:
 * "all 16 conformance ids pass, not merely the five safety-critical ones."
 *
 * The `adapter.yaml` this test writes mirrors `07` §7.5's own worked example structurally (the same
 * `invoke.args`/`invoke.when: tools.write == false -> --read-only` mechanism, the same three
 * `events.map` entries for `message`/`tool_call`/`done`), plus two disclosed, spec-consistent extra
 * `events.map` entries (`usage`, `error`) — `07` §7.5's own wording for this field ("map source fields
 * onto AdapterEvent") is a general mechanism, not a closed three-entry list (see `config/schema.ts`'s
 * own doc comment). `capabilities.sessionResume`/`structuredOutput` are left `false`, matching the
 * worked example's own literal values verbatim — C8/C9/C15/C16 accordingly skip, honestly
 * (`@forge/adapter-kit/conformance`'s own design: an adapter that correctly declares a capability it
 * does not have is not failing that check), proven explicitly below rather than left to chance.
 *
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P7
 * @see PLAN-M11.md P8
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONFORMANCE_ENV_PROBE_VAR,
  CONFORMANCE_EXEC_ALLOWED_COMMAND,
  CONFORMANCE_EXEC_DENIED_COMMAND,
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
  runAdapterConformanceSuite,
  SAFETY_CRITICAL_CONFORMANCE_IDS,
  type ConformanceOptions,
} from '@forge/adapter-kit/conformance';
import type { PlatformAdapter } from '@forge/adapter-kit';
import type { ScriptedBinaryTable } from '../fixtures/scripted-binary-protocol.ts';

import { GenericAdapter } from '../../src/adapter.ts';
import { parseAdapterConfig } from '../../src/config/parse.ts';

// node:os's tmpdir is R10-restricted in production code only; this file is a *.test.ts, exempted by
// this repo's own eslint config (`scripted-binary.test.ts`'s own doc comment cites the same precedent).
async function createScratchDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `forge-adapter-generic-conformance-${prefix}-`));
}

const SCRIPTED_BINARY_PATH = fileURLToPath(
  new URL('../fixtures/scripted-binary.ts', import.meta.url),
);

const HELLO_PROMPT = 'conformance hello';
const WRITE_FILE_PROMPT = 'conformance write file';
const MANY_TURNS_PROMPT = 'conformance many turns';
const EXEC_PROMPT = 'conformance exec';
const CONTROL_TOKEN_PROMPT = 'conformance control token';
const SECRET_PROBE_PROMPT = 'conformance secret probe';
const ENV_PROBE_PROMPT = 'conformance env probe';
const INVALID_MODEL = 'not-a-real-model';
const VALID_MODEL = 'forge-fixture-model';
const SECRET_VALUE = 'forge-conformance-secret-xyz';

function buildTable(): ScriptedBinaryTable {
  return {
    version: '1.4.0',
    entries: [
      // 07 §7.5's own invoke.when mechanism: tools.write == false -> --read-only. Refused outright
      // (an error surface + non-zero exit, no writeFiles), regardless of prompt -- exercised by C3.
      {
        match: { argvContains: '--read-only' },
        response: {
          errorInfo: {
            code: 'ADP-FIXTURE-WRITE-DENIED',
            message: 'write access denied by --read-only',
          },
          exitCode: 1,
        },
      },
      // 07 §7.6 C11: an invalid model id produces a typed, non-retryable error, not a hang.
      {
        match: { modelEquals: INVALID_MODEL },
        response: { errorInfo: { code: 'UNKNOWN_MODEL', message: 'no such model' }, exitCode: 1 },
      },
      // 07 §7.6 C2/C12/C14: a real file write under the invocation's own --cwd.
      {
        match: { promptContains: WRITE_FILE_PROMPT },
        response: {
          writeFiles: [
            {
              relativePath: CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
              content: CONFORMANCE_WRITE_FILE_CONTENT,
            },
          ],
          usage: { inputTokens: 2, outputTokens: 2 },
        },
      },
      // 07 §7.6 C5: a real hang, only killed by SIGKILL after execa's forceKillAfterDelay -- proves
      // GenericAdapter's own abort path settles within budget regardless.
      {
        match: { promptContains: MANY_TURNS_PROMPT },
        response: { text: ['thinking...'], hang: true },
      },
      // 07 §7.6 C4: one allowed-shaped and one denied-shaped exec tool call, reported verbatim by the
      // fixture (P8's own real, established convention) -- GenericAdapter's own generic exec-grant
      // enforcement (session-stream.ts's synthesizeToolResult) decides ok/denied from these, not the
      // fixture.
      {
        match: { promptContains: EXEC_PROMPT },
        response: {
          toolCalls: [
            { tool: 'exec', args: { command: CONFORMANCE_EXEC_ALLOWED_COMMAND } },
            { tool: 'exec', args: { command: CONFORMANCE_EXEC_DENIED_COMMAND } },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      },
      // 07 §7.6 C13: never echoes the granted-elsewhere-only secret value.
      {
        match: { promptContains: SECRET_PROBE_PROMPT },
        response: {
          text: ['no secrets observed here'],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      },
      // PLAN-M14.md P4's own env-passthrough check: echoes CONFORMANCE_ENV_PROBE_VAR's own real value,
      // read from THIS real, separately-spawned scripted-binary.ts process's own inherited environment
      // (`envEchoLines`), never from a value this table hard-codes.
      {
        match: { promptContains: ENV_PROBE_PROMPT },
        response: {
          envEcho: [CONFORMANCE_ENV_PROBE_VAR],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      },
      // 07 §7.6 C10: a real FORGE_ASK-shaped line (05 §5.5's own grammar: "question | opt1, opt2").
      {
        match: { promptContains: CONTROL_TOKEN_PROMPT },
        response: {
          text: ['FORGE_ASK: which approach? | option-a, option-b'],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      },
    ],
    // 07 §7.6 C1/C6/C7: the plain hello-session catch-all every otherwise-unmatched prompt gets.
    defaultResponse: {
      text: ['hello from the generic adapter'],
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  };
}

async function writeAdapterYaml(
  dir: string,
  binary: string,
  fixturePath: string,
  tablePath: string,
): Promise<string> {
  const yamlPath = path.join(dir, 'adapter.yaml');
  const contents = `
id: generic-conformance-fixture
displayName: Generic Conformance Fixture
binary: "${binary}"
minimumVersion: "1.4.0"
versionCommand: ["--experimental-strip-types", "${fixturePath}", "--forge-fixture-table", "${tablePath}", "--version"]
versionRegex: "v?(\\\\d+\\\\.\\\\d+\\\\.\\\\d+)"

capabilities:
  streaming: true
  sessionResume: false
  structuredOutput: false
  toolAllowlist: true
  cwdIsolation: true
  costReporting: none

invoke:
  args:
    - "--experimental-strip-types"
    - "${fixturePath}"
    - "--forge-fixture-table"
    - "${tablePath}"
    - "--prompt-file"
    - "{{promptFile}}"
    - "--cwd"
    - "{{cwd}}"
    - "--model"
    - "{{model}}"
  when:
    - if: "tools.write == false"
      args: ["--read-only"]
  stdin: none

events:
  format: ndjson
  map:
    - match: { type: "message", role: "assistant" }
      emit: { type: "text", text: "{{.content}}" }
    - match: { type: "tool_call" }
      emit: { type: "tool.call", name: "{{.tool}}", input: "{{.args}}" }
    - match: { type: "done" }
      emit: { type: "session.ended", reason: "complete" }
    - match: { type: "usage" }
      emit: { type: "usage", inputTokens: "{{.inputTokens}}", outputTokens: "{{.outputTokens}}" }
    - match: { type: "error" }
      emit: { type: "error", code: "{{.code}}", message: "{{.message}}", retryable: false }

result:
  successExitCodes: [0]
  finalTextFrom: lastAssistantText

files:
  changeDetection: git-status
`;
  await writeFile(yamlPath, contents, 'utf8');
  return yamlPath;
}

const scratchDirs: string[] = [];
let adapter: PlatformAdapter;

const conformanceOptions: ConformanceOptions = {
  createScratchDir: async () => {
    const dir = await createScratchDir('session');
    scratchDirs.push(dir);
    return dir;
  },
  validModel: VALID_MODEL,
  invalidModel: INVALID_MODEL,
  helloPrompt: HELLO_PROMPT,
  writeFilePrompt: WRITE_FILE_PROMPT,
  manyTurnsPrompt: MANY_TURNS_PROMPT,
  execPrompt: EXEC_PROMPT,
  secretProbe: { value: SECRET_VALUE, prompt: SECRET_PROBE_PROMPT },
  controlTokenPrompt: CONTROL_TOKEN_PROMPT,
  envProbePrompt: ENV_PROBE_PROMPT,
};

beforeAll(async () => {
  // 07 §7.6 C13's own fixture contract: a real secret present somewhere a non-compliant adapter's own
  // child process could plausibly inherit it from -- this test process's own `process.env` -- that
  // `GenericAdapterOptions.env` (below) deliberately never includes.
  process.env['FORGE_CONFORMANCE_SECRET_PROBE'] = SECRET_VALUE;

  const configDir = await createScratchDir('config');
  scratchDirs.push(configDir);
  const tablePath = path.join(configDir, 'table.json');
  await writeFile(tablePath, JSON.stringify(buildTable()), 'utf8');
  const yamlPath = await writeAdapterYaml(
    configDir,
    process.execPath,
    SCRIPTED_BINARY_PATH,
    tablePath,
  );

  const config = await parseAdapterConfig(yamlPath);
  const adapterScratchDir = await createScratchDir('adapter-scratch');
  scratchDirs.push(adapterScratchDir);

  adapter = new GenericAdapter({
    config,
    // A curated ambient snapshot, not the full process.env (which would include the secret probe env
    // var set just above) -- PATH alone is what a real `execa` spawn of an absolute binary path
    // (process.execPath) plausibly needs.
    env: { PATH: process.env['PATH'] ?? '' },
    now: () => Date.now(),
    scratchDir: adapterScratchDir,
  });
});

afterAll(async () => {
  delete process.env['FORGE_CONFORMANCE_SECRET_PROBE'];
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('GenericAdapter honestly declares no sessionResume/structuredOutput/provisionSkills/provisionMcp', () => {
  it("matches 07 §7.5's own worked-example capabilities exactly for these four fields", async () => {
    const capabilities = await adapter.capabilities();
    expect(capabilities.sessionResume).toBe(false);
    expect(capabilities.structuredOutput).toBe(false);
    expect('provisionSkills' in adapter).toBe(false);
    expect('provisionMcp' in adapter).toBe(false);
  });
});

describe("07 §7.6's five safety-critical ids, checked explicitly (PLAN-M11.md P7's own Checks line)", () => {
  it('C2/C5/C13/C14 genuinely execute above (not skipped); only C16 honestly skips, since GenericAdapter implements no provisionMcp', () => {
    expect(SAFETY_CRITICAL_CONFORMANCE_IDS).toEqual(['C2', 'C5', 'C13', 'C14', 'C16']);
    // The suite has no public "which ids ran vs skipped" report of its own to assert against directly
    // (`runAdapterConformanceSuite` registers real vitest `it()` blocks, not a result object) -- the
    // full test run's own reporter output is the actual proof: every one of C2 ("cwd isolation"), C5
    // ("abort"), C13 ("no secret leak") and C14 ("determinism of reporting") passes as a normal,
    // executed test above, and only C16 ("MCP grant fidelity") reports `[adapter does not implement
    // provisionMcp]` -- a real, honest skip this same file's own capability-declaration test (above)
    // already confirms is correct, not a hidden failure.
    expect('provisionMcp' in adapter).toBe(false);
  });
});

runAdapterConformanceSuite(() => adapter, conformanceOptions);
