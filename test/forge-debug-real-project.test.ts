/**
 * `forge debug` in a project `forge init` really produced, through the real dispatcher and a strict fake
 * adapter (`PLAN-M13.md` P27, `SPEC-QUESTIONS.md` Q215).
 *
 * `packages/cli/test/commands/loop/debug.test.ts` covers the loop against hand-written fixture agents. What
 * only a real init project shows is that the shipped diagnostician (`.forge/agents/diagnostician.yaml`, its
 * real role prompt, its real tool grant, tier `max`) is what a `forge debug` session is assembled from:
 * before this piece the sessions carried an empty system prompt, the adapter's first-listed model and a
 * global stand-in grant, and a strict adapter refused every one of them. Lives at the repository root for
 * the reason `agent-prompts-all-workflows.test.ts` documents (it needs `@forge/cli`, `@forge/engine`,
 * `@forge/testkit` and a real init together).
 *
 * @see specs/13 §13.2 F-DEBUG-1
 * @see specs/05 §5.3, §5.8
 * @see specs/22 M13
 */
import { execa } from 'execa';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as YAML from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SessionRequest } from '@forge/adapter-kit';
import { ProjectPaths } from '@forge/core';
import { configSchema, type ForgeConfig } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';

import { debugSymptom } from '../packages/cli/src/commands/loop/debug.ts';
import { runInit } from '../packages/cli/src/init/run-init.ts';
import { OPERATING_CONTRACT } from '../packages/agents/src/prompt/index.ts';

const MODULES_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'modules');
const TIER_MODELS = {
  frugal: 'forge-fake-frugal',
  balanced: 'forge-fake-balanced',
  max: 'forge-fake-max',
} as const;

let projectDir = '';
let config: ForgeConfig;
let adapter: FakePlatformAdapter;
const requests: SessionRequest[] = [];

beforeAll(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), 'forge-p27-debug-'));
  adapter = new FakePlatformAdapter(
    {},
    { strict: { operatingContract: OPERATING_CONTRACT }, models: Object.values(TIER_MODELS) },
  );
  adapter.script((request) => {
    requests.push(request);
    return false;
  }, {});
  const result = await runInit(
    projectDir,
    { name: 'P27 Debug', yes: true, level: 'L0' },
    { candidateAdapters: [adapter], env: {}, modulesDir: MODULES_DIR },
  );
  expect(result.kind).toBe('initialized');
  await execa('git', ['checkout', '-q', '-B', 'main'], { cwd: projectDir });
  await execa('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'add', '-A'], {
    cwd: projectDir,
  });
  await execa(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'],
    { cwd: projectDir },
  );
  const written = configSchema.parse(
    YAML.parse(await readFile(path.join(projectDir, '.forge/config.yaml'), 'utf8')),
  );
  const tiers = { ...written.models.tiers };
  for (const tier of ['frugal', 'balanced', 'max'] as const) {
    tiers[tier] = { ...tiers[tier], [adapter.id]: TIER_MODELS[tier] };
  }
  config = { ...written, models: { ...written.models, tiers } };
}, 300_000);

afterAll(async () => {
  if (projectDir !== '') await rm(projectDir, { recursive: true, force: true });
});

const text = (request: SessionRequest): string => `${request.systemPrompt.text}\n${request.prompt}`;

describe('forge debug against a real `forge init` project', () => {
  it('has no modules/ directory (the shape every session in a real project runs against)', async () => {
    expect(await stat(path.join(projectDir, 'modules')).catch(() => undefined)).toBeUndefined();
    expect(await stat(path.join(projectDir, '.forge/agents/diagnostician.yaml'))).toBeDefined();
  });

  it('assembles every RCA and FIX session from the shipped diagnostician, and the strict adapter refuses none', async () => {
    // REPRODUCE proposes a failing command; three hypotheses; one survives; five whys satisfied; then FIX
    // writes nothing on every attempt, so the run escalates having exercised every phase up to FIX.
    adapter.script((r) => text(r).includes('REPRODUCE attempt'), {
      structured: { command: 'false' },
    });
    adapter.script((r) => text(r).includes('ISOLATE for'), { structured: { scope: 'src/' } });
    adapter.script((r) => text(r).includes('HYPOTHESISE for'), {
      structured: { claims: ['claim-one', 'claim-two', 'claim-three'] },
    });
    adapter.script((r) => text(r).includes('FALSIFY for') && r.prompt.includes('claim-one'), {
      structured: { refuted: true, refutedBy: 'read it' },
    });
    adapter.script((r) => text(r).includes('FALSIFY for') && r.prompt.includes('claim-two'), {
      structured: { refuted: true, refutedBy: 'read it' },
    });
    adapter.script((r) => text(r).includes('FALSIFY for') && r.prompt.includes('claim-three'), {
      structured: { refuted: false },
    });
    adapter.script((r) => text(r).includes('DIAGNOSE for'), {
      structured: { why: 'a missing check', satisfiesStopRule: true },
    });
    adapter.script((r) => text(r).includes('FIX for'), { text: ['nothing to change'] });

    const result = await debugSymptom(
      {
        paths: new ProjectPaths(projectDir),
        projectRoot: projectDir,
        config,
        adapter,
        checksRoot: '.forge/checks',
        agentsRoot: '.forge/agents',
      },
      'the invoice total is wrong',
    );

    expect(result.outcome).toBe('escalated');
    expect(adapter.strictViolations).toEqual([]);

    // The generated-file header comment is not part of the role text prompt assembly loads.
    const roleText = (
      await readFile(path.join(projectDir, '.forge/prompts/diagnostician.system.md'), 'utf8')
    ).replace(/^<!--.*?-->\s*/s, '');
    // A sentence from the role prompt's body (its first line is a heading the block renderer may reshape).
    const roleLine =
      roleText.split('\n').find((line) => line.trim().length > 40 && !line.startsWith('#')) ?? '';
    expect(roleLine).not.toBe('');
    const agentYaml = YAML.parse(
      await readFile(path.join(projectDir, '.forge/agents/diagnostician.yaml'), 'utf8'),
    ) as { tools: { write: boolean; exec: string[] } };
    const debugRequests = requests.filter((r) => r.stepId.startsWith('debug:'));
    expect(debugRequests.length).toBeGreaterThan(8);

    for (const request of debugRequests) {
      // The diagnostician's real role block (compiled into block [2]) and the tier `max` model.
      expect(request.systemPrompt.text).toContain(roleLine);
      expect(request.systemPrompt.text).toContain(OPERATING_CONTRACT.slice(0, 80));
      expect(request.model).toBe(TIER_MODELS.max);
    }
    const fixes = debugRequests.filter((r) => text(r).includes('FIX for'));
    const readOnly = debugRequests.filter((r) => !text(r).includes('FIX for'));
    expect(fixes.length).toBeGreaterThan(0);
    for (const request of readOnly) {
      expect(request.tools).toMatchObject({ write: false, exec: false, network: 'none' });
    }
    // FIX gets the shipped diagnostician's own resolved grant: exactly its declared write and exec patterns.
    for (const request of fixes) {
      expect(request.tools.write).toBe(agentYaml.tools.write);
      expect(request.tools.exec).toEqual(agentYaml.tools.exec);
    }
  }, 120_000);
});
