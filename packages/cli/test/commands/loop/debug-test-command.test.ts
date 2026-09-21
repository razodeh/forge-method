/**
 * `forge debug` REPRODUCE runs the project's own configured test command (`PLAN-M13.md` P23, `SPEC-QUESTIONS.md` Q230,
 * `Q222` D2; `13` §13.2 F-DEBUG-1 step 2 "an existing failing test"; `20` §20.1).
 *
 * Through the real `debugSymptom` (the real RCA loop, a real lane, the real confined runner) with only the model faked. The
 * fixture diagnostician declares `exec: ['true']`, so `node test-unit.mjs` is in its grant ONLY because the project set
 * `execution.testCommands.unit`. The control runs the identical proposal with the config key unset.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import type { SessionRequest } from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { debugSymptom, type DebugDeps } from '../../../src/commands/loop/debug.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  cleanupAll,
  createTestProject,
  writeFixtureAgent,
} from './helpers.ts';

afterEach(cleanupAll);

type Project = Awaited<ReturnType<typeof createTestProject>>;

const TEST_COMMAND = 'node test-unit.mjs';

async function projectWithTestScript(exec: readonly string[] = ['true']): Promise<Project> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, 'diagnostician', 'Diagnostician', {
    write: true,
    exec,
  });
  // The fake test command: fails, and leaves a record of every run in a file the lane owns.
  await writeFile(
    path.join(project.dir, 'test-unit.mjs'),
    "import { appendFileSync } from 'node:fs';\nappendFileSync('runs.log', 'run\\n');\nprocess.exit(1);\n",
  );
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'seed a failing unit suite'], {
    cwd: project.dir,
  });
  return project;
}

function deps(project: Project, adapter: FakePlatformAdapter, unit: string | undefined): DebugDeps {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    config: {
      ...project.config,
      execution: {
        ...project.config.execution,
        testCommands: unit === undefined ? {} : { unit },
      },
    },
    adapter,
    checksRoot: CHECKS_ROOT,
    agentsRoot: AGENTS_ROOT,
    env: process.env,
  };
}

function proposeAlways(adapter: FakePlatformAdapter, command: string): SessionRequest[] {
  const seen: SessionRequest[] = [];
  adapter.script(
    (request: SessionRequest) => {
      seen.push(request);
      return request.systemPrompt.text.includes('REPRODUCE attempt');
    },
    { structured: { command } },
  );
  return seen;
}

async function events(project: Project): Promise<string> {
  const runs = await readdir(path.join(project.dir, '.forge', 'state', 'runs'));
  const texts = await Promise.all(
    runs.map((run) =>
      readFile(path.join(project.dir, '.forge', 'state', 'runs', run, 'events.ndjson'), 'utf8'),
    ),
  );
  return texts.join('\n');
}

describe('forge debug: REPRODUCE runs the project’s configured test command', () => {
  it('the configured unit command is accepted, run in the lane, its non-zero exit is the reproduction, and the loop goes on to ISOLATE with it', async () => {
    const project = await projectWithTestScript();
    const adapter = new FakePlatformAdapter();
    const seen = proposeAlways(adapter, TEST_COMMAND);
    // One distinct hypothesis: the loop ends here with a typed refusal, after it has used the reproduction.
    adapter.script((request) => request.systemPrompt.text.includes('ISOLATE for'), {
      structured: { scope: 'test-unit.mjs' },
    });
    adapter.script((request) => request.systemPrompt.text.includes('HYPOTHESISE for'), {
      structured: { claims: ['only one'] },
    });

    await expect(
      debugSymptom(deps(project, adapter, TEST_COMMAND), 'the unit suite fails'),
    ).rejects.toMatchObject({
      code: 'RUN-060',
    });

    // The loop reached ISOLATE, whose input is the reproduction command: it was a usable, non-zero reproduction.
    const isolate = seen.find((request) => request.systemPrompt.text.includes('ISOLATE for'));
    expect(isolate?.prompt).toContain(TEST_COMMAND);
    // REPRODUCE was told which commands run as written, so a read-only session can propose the right one.
    const reproduce = seen.find((request) =>
      request.systemPrompt.text.includes('REPRODUCE attempt 1'),
    );
    expect(reproduce?.systemPrompt.text).toContain(`\`${TEST_COMMAND}\``);
    // No proposal was refused.
    expect(await events(project)).not.toContain('proposed-command-refused');
  }, 120_000);

  it('control: the identical proposal with execution.testCommands.unit unset is refused as not in the grant, five times, and the loop never reaches ISOLATE', async () => {
    const project = await projectWithTestScript();
    const adapter = new FakePlatformAdapter();
    const seen = proposeAlways(adapter, TEST_COMMAND);

    const result = await debugSymptom(deps(project, adapter, undefined), 'the unit suite fails');

    expect(result.outcome).toBe('needs-more-evidence');
    if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(result.refusedCommands?.map((entry) => [entry.code, entry.reason])).toEqual(
      Array.from({ length: 5 }, () => ['RUN-095', 'not-in-grant']),
    );
    expect(seen.some((request) => request.systemPrompt.text.includes('ISOLATE for'))).toBe(false);
    // Not told about commands it does not have.
    const reproduce = seen.find((request) =>
      request.systemPrompt.text.includes('REPRODUCE attempt 1'),
    );
    expect(reproduce?.systemPrompt.text).not.toContain('test commands run exactly');
  }, 120_000);

  it('one argument more than the configured command is refused as not in the grant, and recorded as a refused command', async () => {
    const project = await projectWithTestScript();
    const adapter = new FakePlatformAdapter();
    proposeAlways(adapter, `${TEST_COMMAND} --watch`);

    const result = await debugSymptom(deps(project, adapter, TEST_COMMAND), 'the unit suite fails');

    expect(result.outcome).toBe('needs-more-evidence');
    if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(result.refusedCommands?.every((entry) => entry.reason === 'not-in-grant')).toBe(true);
    expect(await events(project)).toContain('proposed-command-refused');
  }, 120_000);

  it('a diagnostician that may run no command is neither told about the test commands nor granted them: the derivation never turns "no exec" into "some exec"', async () => {
    const project = await projectWithTestScript([]);
    const adapter = new FakePlatformAdapter();
    const seen = proposeAlways(adapter, TEST_COMMAND);

    const result = await debugSymptom(deps(project, adapter, TEST_COMMAND), 'the unit suite fails');

    expect(result.outcome).toBe('needs-more-evidence');
    if (result.outcome !== 'needs-more-evidence') throw new Error('unreachable');
    expect(result.refusedCommands?.map((entry) => entry.reason)).toEqual(
      Array.from({ length: 5 }, () => 'not-in-grant'),
    );
    const reproduce = seen.find((request) =>
      request.systemPrompt.text.includes('REPRODUCE attempt 1'),
    );
    expect(reproduce?.systemPrompt.text).not.toContain('test commands run exactly');
  }, 120_000);
});
