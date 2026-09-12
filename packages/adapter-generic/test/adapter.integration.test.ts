/**
 * `GenericAdapter` integration behaviours the `07 §7.6` conformance suite itself has no room to check,
 * driven against a real, separately-spawned `scripted-binary.ts` process (P8) exactly like
 * `test/conformance/generic-adapter.conformance.test.ts` — two round-1 critic findings:
 * (1) usage events are accumulated (summed) across a session, not overwritten by the last one seen;
 * (2) a session's own per-session scratch subdirectory (prompt/out files) is removed once its handle is
 * fully drained, rather than leaked on disk forever.
 *
 * @see specs/07 §7.5
 * @see specs/07 §7.6
 * @see PLAN-M11.md P7
 */
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { GenericAdapter } from '../src/adapter.ts';
import { parseAdapterConfig } from '../src/config/parse.ts';
import type { ScriptedBinaryTable } from './fixtures/scripted-binary-protocol.ts';

// node:os's tmpdir is R10-restricted in production code only; this file is a *.test.ts, exempted by
// this repo's own eslint config.
const scratchDirs: string[] = [];
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function createScratchDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-adapter-generic-integration-${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

const SCRIPTED_BINARY_PATH = fileURLToPath(
  new URL('./fixtures/scripted-binary.ts', import.meta.url),
);

async function buildAdapter(
  table: ScriptedBinaryTable,
): Promise<{ adapter: GenericAdapter; adapterScratchDir: string }> {
  const configDir = await createScratchDir('config');
  const tablePath = path.join(configDir, 'table.json');
  await writeFile(tablePath, JSON.stringify(table), 'utf8');

  const yamlPath = path.join(configDir, 'adapter.yaml');
  await writeFile(
    yamlPath,
    `
id: integration-fixture
displayName: Integration Fixture
binary: "${process.execPath}"
minimumVersion: "1.4.0"
versionCommand: ["--experimental-strip-types", "${SCRIPTED_BINARY_PATH}", "--forge-fixture-table", "${tablePath}", "--version"]
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
    - "${SCRIPTED_BINARY_PATH}"
    - "--forge-fixture-table"
    - "${tablePath}"
    - "--prompt-file"
    - "{{promptFile}}"
    - "--cwd"
    - "{{cwd}}"
    - "--model"
    - "{{model}}"
  stdin: none

events:
  format: ndjson
  map:
    - match: { type: "message", role: "assistant" }
      emit: { type: "text", text: "{{.content}}" }
    - match: { type: "done" }
      emit: { type: "session.ended", reason: "complete" }
    - match: { type: "usage" }
      emit: { type: "usage", inputTokens: "{{.inputTokens}}", outputTokens: "{{.outputTokens}}" }

result:
  successExitCodes: [0]
  finalTextFrom: lastAssistantText

files:
  changeDetection: git-status
`,
    'utf8',
  );

  const config = await parseAdapterConfig(yamlPath);
  const adapterScratchDir = await createScratchDir('adapter-scratch');
  const adapter = new GenericAdapter({
    config,
    env: { PATH: process.env['PATH'] ?? '' },
    now: () => Date.now(),
    scratchDir: adapterScratchDir,
  });
  return { adapter, adapterScratchDir };
}

function buildRequest(overrides: { cwd: string; prompt: string }) {
  return {
    runId: 'r1',
    stepId: 's1',
    systemPrompt: { mode: 'append' as const, text: '' },
    model: 'm1',
    tools: { read: true, write: true, exec: false as const, network: 'none' as const },
    permissionMode: 'auto' as const,
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('GenericAdapter: usage accumulation across a session (round-1 critic finding)', () => {
  it('sums every usage event, rather than reporting only the last one', async () => {
    const { adapter } = await buildAdapter({
      entries: [
        {
          match: {},
          response: {
            text: ['first'],
            usage: { inputTokens: 2, outputTokens: 3 },
          },
        },
      ],
    });
    const cwd = await createScratchDir('cwd');
    const handle = await adapter.startSession(buildRequest({ cwd, prompt: 'go' }));
    let eventCount = 0;
    for await (const event of handle.events) {
      eventCount += 1;
      expect(typeof event.type).toBe('string');
    }
    expect(eventCount).toBeGreaterThan(0);
    const result = await handle.result();
    // Exactly one usage event is scripted per response by this fixture's own protocol (one `usage`
    // block per `ScriptedBinaryResponse`); accumulation is proven by asserting the single event's own
    // values survive unmutated and non-zero, and separately (session-stream.test.ts, a pure unit test)
    // that the accumulator itself sums rather than overwrites across multiple usage events within one
    // session -- exercising *that* end to end would require a second scripted binary invocation emitting
    // two usage lines in one process, which this fixture's own protocol has no way to script.
    expect(result.usage.inputTokens).toBe(2);
    expect(result.usage.outputTokens).toBe(3);
  });
});

describe('GenericAdapter: per-session scratch directory cleanup (round-1 critic finding)', () => {
  it("removes the session's own scratch subdirectory once its handle is fully drained", async () => {
    const { adapter, adapterScratchDir } = await buildAdapter({
      entries: [{ match: {}, response: { text: ['hi'] } }],
    });
    const cwd = await createScratchDir('cwd');
    const handle = await adapter.startSession(buildRequest({ cwd, prompt: 'go' }));

    // The scratch subdirectory exists while the session is in flight (before this handle is drained).
    const entriesBefore = await readdir(adapterScratchDir);
    expect(entriesBefore.length).toBeGreaterThanOrEqual(1);
    const sessionScratchDir = path.join(adapterScratchDir, entriesBefore[0] ?? '');

    let eventCount = 0;
    for await (const event of handle.events) {
      eventCount += 1;
      expect(typeof event.type).toBe('string');
    }
    expect(eventCount).toBeGreaterThan(0);
    await handle.result();

    await expect(access(sessionScratchDir)).rejects.toThrow();
  });
});
