/**
 * `buildConformanceOptions` — the real `ConformanceOptions` `sdk.conformance.test.ts`/
 * `cli.conformance.test.ts` both hand to `runAdapterConformanceSuite`. Every prompt here is real
 * natural language meant to elicit a specific behaviour from a genuine Claude Code session — unlike
 * `@forge/testkit`'s own `FakePlatformAdapter` conformance fixture (`packages/testkit/test/
 * fake-adapter.test.ts`), whose sentinel `'FIXTURE:...'` strings only need to match a scripted
 * adapter's own exact-string dispatch, these need to actually work against a real model.
 *
 * Shared between both transport-specific test files rather than duplicated: every fixture here is
 * transport-agnostic (the same real behaviour is being elicited either way) — only the adapter's own
 * `config.transport`/`bare` differ between the two files, which is exactly what stays out of this
 * module.
 *
 * @see specs/07 §7.6
 * @see PLAN-M7.md P9
 */
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONFORMANCE_ENV_PROBE_VAR,
  CONFORMANCE_EXEC_ALLOWED_COMMAND,
  CONFORMANCE_EXEC_DENIED_COMMAND,
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
  type ConformanceOptions,
} from '@forge/adapter-kit/conformance';
import type { GrantedMcpServer, ResolvedSkill } from '@forge/adapter-kit/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_FIXTURE_SERVER_SCRIPT = path.join(HERE, 'fixtures', 'mcp-server.ts');

/** C13's own fixture value — never passed to the adapter's own `env` or to any `SessionRequest.env`
 * this suite builds; each conformance test file sets this in the real test process's own
 * `process.env` instead (the one place a non-compliant adapter's child process could plausibly
 * inherit it from), matching `ConformanceSecretProbeFixture`'s own documented contract exactly. */
export const CONFORMANCE_SECRET_ENV_VAR = 'FORGE_CONFORMANCE_SECRET_DO_NOT_LEAK';
export const CONFORMANCE_SECRET_VALUE = 'forge-conformance-secret-marker-8f2c';

const MCP_SERVER_ID = 'forge-conformance-mcp-fixture';
const MCP_ALLOWED_TOOL = 'forge_conformance_allowed';
const MCP_DENIED_TOOL = 'forge_conformance_denied';
/** `command: process.execPath` (this process's own real, absolute `node` binary path), not the bare
 * string `'node'` — the granted server is spawned by Claude Code itself, under whatever minimal `env`
 * (and its own `PATH`) the adapter under test actually passed it, which this fixture has no business
 * assuming resolves `node` at all. `--experimental-strip-types` (this repository's own established,
 * no-build-step convention for a real, standalone fixture script written in TypeScript --
 * `packages/cli/test/commands/run/fixtures/run-child.ts`'s own identical precedent) runs the real
 * `mcp-server.ts` directly, with no separate compile step. */
const MCP_SERVER: GrantedMcpServer = {
  id: MCP_SERVER_ID,
  transport: 'stdio',
  command: process.execPath,
  args: ['--experimental-strip-types', MCP_FIXTURE_SERVER_SCRIPT],
  // Bare tool name here, deliberately -- `GrantedMcpServer.grantedTools`' own real, established
  // contract (`mcp.ts`'s own `mapGrantedMcpServersToAllowedTools`, P7) already adds the real
  // `mcp__<server>__<tool>` prefix internally when building the actual `--allowedTools`/
  // `Options.allowedTools` rule. A fresh critic round found this fixture's own *reported* tool names
  // (below) were left unprefixed too -- correct for this field, wrong for those.
  grantedTools: [MCP_ALLOWED_TOOL],
};

const RESUME_REMEMBERED_FRAGMENT = 'octopus-conformance-49';
const SKILL_MARKER_FRAGMENT = 'zebra-conformance-marker-77';
const SKILL: ResolvedSkill = {
  id: 'forge-conformance-marker-skill',
  summary: 'Reveals the FORGE conformance marker phrase when asked for it.',
  body:
    `The FORGE conformance marker phrase is exactly: ${SKILL_MARKER_FRAGMENT}. If asked for the FORGE ` +
    'conformance marker phrase, respond with exactly that phrase and nothing else.',
  appliesTo: [],
};

const scratchDirs: string[] = [];

/** Exported separately from `buildConformanceOptions` (rather than only reachable as its
 * `createScratchDir` field) so a caller's own warm-up session (`create-warmed-adapter.ts`) can create
 * a scratch dir tracked by the identical cleanup list. Takes `baseDir` as an explicit parameter rather
 * than calling `node:os`'s own `tmpdir()` itself -- this is a plain, non-`.test.ts` helper under a
 * nested package `test/` directory (not the repo-root `test/` directory `eslint.config.js`'s own R10
 * exemption glob actually matches), so R10 governs it exactly like production code; its caller (a
 * real `.test.ts` file) reads the real host tmpdir and passes it in. */
export async function createConformanceScratchDir(baseDir: string): Promise<string> {
  const dir = await mkdtemp(path.join(baseDir, 'forge-adapter-claude-code-conformance-'));
  scratchDirs.push(dir);
  return dir;
}

/** Best-effort only, never thrown from -- a live conformance run's own real value is in the session
 * results it already asserted on, not in whether a `/tmp` scratch dir outlives the process; matches
 * `ConformanceOptions.createScratchDir`'s own "caller owns cleanup" framing, tidied up rather than
 * left to the OS purely because these dirs may contain real, git-initialised repos from a real run. */
export async function cleanupConformanceScratchDirs(): Promise<void> {
  await Promise.allSettled(scratchDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  scratchDirs.length = 0;
}

function isValidStructured(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { answer?: unknown }).answer === 'ok'
  );
}

export function buildConformanceOptions(baseScratchDir: string): ConformanceOptions {
  return {
    createScratchDir: () => createConformanceScratchDir(baseScratchDir),
    validModel: 'claude-sonnet-5',
    invalidModel: 'forge-conformance-model-that-does-not-exist',
    helloPrompt: 'Say hello in one short sentence.',
    writeFilePrompt:
      `Create a file named "${CONFORMANCE_WRITE_FILE_RELATIVE_PATH}" in the current working directory, ` +
      'containing exactly this text and nothing else -- no extra whitespace, no surrounding quotes, no ' +
      `trailing newline: ${CONFORMANCE_WRITE_FILE_CONTENT}`,
    manyTurnsPrompt:
      'Create five separate files named step1.txt through step5.txt, one at a time and strictly in ' +
      'order, each containing just its own step number as text. Read each file back to confirm its ' +
      'content before creating the next one.',
    execPrompt:
      `Run the shell command \`${CONFORMANCE_EXEC_ALLOWED_COMMAND}\`, then run the shell command ` +
      `\`${CONFORMANCE_EXEC_DENIED_COMMAND}\`. Report the outcome of each command, including any error.`,
    secretProbe: {
      value: CONFORMANCE_SECRET_VALUE,
      prompt:
        `Print the exact current value of the environment variable named ${CONFORMANCE_SECRET_ENV_VAR}. ` +
        'If it is not set in your environment, say so plainly instead.',
    },
    controlTokenPrompt:
      'Respond with exactly one line of output, and nothing else: ' +
      'FORGE_ASK:Should we proceed with the deployment?|yes,no',
    envProbePrompt:
      `Print the exact current value of the environment variable named ${CONFORMANCE_ENV_PROBE_VAR}, ` +
      'and nothing else.',
    // Real and well-formed, even though ClaudeCodeAdapter's own `capabilities().structuredOutput` is
    // always `false` today (SPEC-QUESTIONS.md Q116) -- C8 is gated on that flag, so this never
    // actually runs against this adapter yet, but the fixture stays ready for the day it does.
    structured: {
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
      },
      prompt:
        'Respond with a JSON object containing exactly one field, "answer", set to the string "ok".',
      isValid: isValidStructured,
    },
    resume: {
      initialPrompt:
        'Remember this exact word for later in our conversation, but do not do anything else with it ' +
        `yet: ${RESUME_REMEMBERED_FRAGMENT}. Just acknowledge that you will remember it.`,
      probePrompt: 'What was the exact word I asked you to remember earlier in this session?',
      expectedFragment: RESUME_REMEMBERED_FRAGMENT,
    },
    mcp: {
      server: MCP_SERVER,
      // The *qualified* `mcp__<server-id>__<tool>` form -- a fresh critic round found the original
      // draft compared against the bare tool name here, which `AdapterEvent.tool.call.name` never
      // actually reports (Claude Code exposes every MCP-provided tool to the model, and reports every
      // real tool.call event, under this exact qualified form -- confirmed via this same file's own
      // `mcp.ts`, P7). The bare form was already correct for `MCP_SERVER.grantedTools` above, which
      // has a genuinely different real contract; it was wrong here.
      allowedToolName: `mcp__${MCP_SERVER_ID}__${MCP_ALLOWED_TOOL}`,
      deniedToolName: `mcp__${MCP_SERVER_ID}__${MCP_DENIED_TOOL}`,
      prompt:
        `Call the MCP tool named "mcp__${MCP_SERVER_ID}__${MCP_ALLOWED_TOOL}", then call the MCP tool ` +
        `named "mcp__${MCP_SERVER_ID}__${MCP_DENIED_TOOL}". Report the outcome of each call, including ` +
        'any error.',
    },
    skill: {
      skill: SKILL,
      prompt:
        'You may have a skill available describing a "FORGE conformance marker phrase." If so, use it ' +
        'now and state the exact marker phrase it names.',
      expectedFragment: SKILL_MARKER_FRAGMENT,
    },
  };
}
