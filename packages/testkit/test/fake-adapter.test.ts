/**
 * `runAdapterConformanceSuite(() => new FakePlatformAdapter())`: all 16 pass, none of
 * `SAFETY_CRITICAL_CONFORMANCE_IDS` among any failure — `PLAN-M4.md` P5's own milestone acceptance
 * criterion, verbatim: "the fake adapter passes all 16 conformance tests," asserted directly by actually
 * running the real suite against the real class, not by inspection.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.6
 * @see PLAN-M4.md P5
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
  runAdapterConformanceSuite,
  type ConformanceOptions,
} from '@forge/adapter-kit/conformance';
import type { GrantedMcpServer, ResolvedSkill } from '@forge/adapter-kit/types';

import { FakePlatformAdapter } from '../src/fake-adapter.ts';

const HELLO_PROMPT = 'FIXTURE:HELLO';
const WRITE_FILE_PROMPT = 'FIXTURE:WRITE_FILE';
const MANY_TURNS_PROMPT = 'FIXTURE:MANY_TURNS';
const EXEC_PROMPT = 'FIXTURE:EXEC';
const CONTROL_TOKEN_PROMPT = 'FIXTURE:CONTROL_TOKEN';
const STRUCTURED_PROMPT = 'FIXTURE:STRUCTURED';
const RESUME_INITIAL_PROMPT = 'FIXTURE:RESUME_INITIAL';
const RESUME_PROBE_PROMPT = 'FIXTURE:RESUME_PROBE';
const MCP_PROMPT = 'FIXTURE:MCP';
const SKILL_PROMPT = 'FIXTURE:SKILL';
const SECRET_PROBE_PROMPT = 'FIXTURE:SECRET_PROBE';

const RESUME_REMEMBERED_FRAGMENT = 'purple-elephant-42';
const SKILL_FRAGMENT = 'skill-marker-fragment-77';
const MCP_ALLOWED_TOOL = 'allowed-tool';
const MCP_DENIED_TOOL = 'denied-tool';
const MCP_SERVER: GrantedMcpServer = {
  id: 'conformance-mcp-server',
  transport: 'stdio',
  command: 'echo',
  grantedTools: [MCP_ALLOWED_TOOL],
};
const SKILL: ResolvedSkill = {
  id: 'conformance-skill',
  summary: 'A conformance test skill',
  body: `Skill body mentioning ${SKILL_FRAGMENT}`,
  appliesTo: [],
};

function buildAdapter(): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter();

  adapter.script((r) => r.prompt === HELLO_PROMPT, { text: ['Hello!'] });
  adapter.script((r) => r.prompt === WRITE_FILE_PROMPT, {
    writeFiles: [
      {
        relativePath: CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
        content: CONFORMANCE_WRITE_FILE_CONTENT,
      },
    ],
  });
  adapter.script((r) => r.prompt === MANY_TURNS_PROMPT, {
    text: ['turn one', 'turn two', 'turn three', 'turn four', 'turn five'],
  });
  adapter.script((r) => r.prompt === EXEC_PROMPT, {
    execAttempts: ['echo hi', 'rm -rf conformance-canary.txt'],
  });
  adapter.script((r) => r.prompt === CONTROL_TOKEN_PROMPT, {
    text: ['FORGE_ASK: which database? | Postgres, SQLite'],
  });
  adapter.script((r) => r.prompt === STRUCTURED_PROMPT, {
    text: ['done'],
    structured: { ok: true },
  });
  adapter.script((r) => r.prompt === RESUME_INITIAL_PROMPT, {
    text: [`remembering: ${RESUME_REMEMBERED_FRAGMENT}`],
  });
  adapter.script((r) => r.prompt === RESUME_PROBE_PROMPT, { text: ['probing'] });
  adapter.script((r) => r.prompt === MCP_PROMPT, {
    mcpToolAttempts: [MCP_ALLOWED_TOOL, MCP_DENIED_TOOL],
  });
  adapter.script((r) => r.prompt === SKILL_PROMPT, {
    skillVisibleText: SKILL_FRAGMENT,
    text: ['using skill'],
  });
  adapter.script((r) => r.prompt === SECRET_PROBE_PROMPT, { text: ['nothing to report'] });

  return adapter;
}

function isValidStructured(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true;
}

function buildOptions(): ConformanceOptions {
  return {
    createScratchDir: () => mkdtemp(path.join(tmpdir(), 'forge-testkit-')),
    validModel: 'forge-fake-model',
    invalidModel: 'forge-fake-model-that-does-not-exist',
    helloPrompt: HELLO_PROMPT,
    writeFilePrompt: WRITE_FILE_PROMPT,
    manyTurnsPrompt: MANY_TURNS_PROMPT,
    execPrompt: EXEC_PROMPT,
    secretProbe: { value: 'forge-testkit-secret-do-not-print-this', prompt: SECRET_PROBE_PROMPT },
    controlTokenPrompt: CONTROL_TOKEN_PROMPT,
    structured: {
      schema: { type: 'object' },
      prompt: STRUCTURED_PROMPT,
      isValid: isValidStructured,
    },
    resume: {
      initialPrompt: RESUME_INITIAL_PROMPT,
      probePrompt: RESUME_PROBE_PROMPT,
      expectedFragment: RESUME_REMEMBERED_FRAGMENT,
    },
    mcp: {
      server: MCP_SERVER,
      allowedToolName: MCP_ALLOWED_TOOL,
      deniedToolName: MCP_DENIED_TOOL,
      prompt: MCP_PROMPT,
    },
    skill: { skill: SKILL, prompt: SKILL_PROMPT, expectedFragment: SKILL_FRAGMENT },
  };
}

runAdapterConformanceSuite(buildAdapter, buildOptions());
