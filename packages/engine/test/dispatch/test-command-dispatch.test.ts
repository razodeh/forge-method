/**
 * A step that runs tests is granted the project's own test commands, exactly, and nothing wider (`PLAN-M13.md` P23,
 * `SPEC-QUESTIONS.md` Q230; `13` §13.1 F-TEST-1 rule 4, `20` §20.1, `20` §20.5 point 3, `05` §5.3 block [6]).
 *
 * Through the real dispatch path (`executeStep`, the strict fake adapter that checks the nine-block prompt) and through
 * `assembleAgentSession`, with only the model faked: what the adapter RECEIVES as `SessionRequest.tools.exec`, what block [6]
 * tells the model, and which proposed commands `vetProposedCommand` (the gate `forge debug` puts a model's command
 * through) then accepts. Every scenario has an untouched control so a failing derivation cannot pass as "nothing changed".
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isExecAllowed } from '@forge/adapter-kit/grants';
import type { SessionRequest, ToolGrant } from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { assembleAgentSession, promptRecordDirName } from '../../src/dispatch/assemble.ts';
import { vetProposedCommand } from '../../src/dispatch/confined-command.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import { deriveTestExec } from '../../src/dispatch/test-command-grant.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

const CONFIGURED = {
  unit: 'pnpm test',
  integration: 'pnpm run test:integration',
  lint: 'pnpm lint',
  typecheck: 'pnpm typecheck',
  e2e: 'pnpm e2e',
  smoke: 'pnpm smoke',
} as const;

/** An implementation-role-shaped agent: writes, and may run `git *` and `ls*` and nothing else. */
const ENGINEER = fixtureAgent('backend', {
  tools: {
    read: true,
    write: true,
    exec: ['git *', 'ls*'],
    network: false,
    git_commit: 'lane',
    deploy: false,
  },
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p23-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

function assembly(
  projectRoot: string,
  overrides: Parameters<typeof createFixtureAssembly>[1] = {},
  agent = ENGINEER,
) {
  return createFixtureAssembly(projectRoot, {
    loadAgent: () => Promise.resolve(agent),
    testCommands: CONFIGURED,
    ...overrides,
  });
}

async function assembled(
  brief: string,
  options: {
    readonly taint?: 'external';
    readonly readOnly?: boolean;
    readonly overrides?: Parameters<typeof createFixtureAssembly>[1];
    readonly agent?: typeof ENGINEER;
  } = {},
) {
  const projectRoot = await repo();
  const ctx = createTestContext({
    projectRoot,
    assembly: assembly(projectRoot, options.overrides, options.agent),
  });
  return assembleAgentSession({
    node: node({
      id: 'wf:step',
      kind: 'agent',
      agent: toAgentId('backend'),
      brief,
      produces: ['src/out.ts'],
      ...(options.taint === undefined ? {} : { taint: options.taint }),
    }),
    ctx,
    ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
  });
}

function exec(grant: ToolGrant): readonly string[] | false {
  return grant.exec;
}

function block6(text: string): string {
  const start = text.indexOf('Tool grants:');
  const end = text.indexOf('Budget:', start);
  return text.slice(start, end);
}

describe('the exec grant of a step that runs tests', () => {
  it('implement-story: the agent’s own patterns plus exactly the typecheck, lint, unit and integration commands, in that order', async () => {
    const session = await assembled('briefs/implement-story.md');
    expect(exec(session.tools)).toEqual([
      'git *',
      'ls*',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm run test:integration',
    ]);
  });

  it('write-failing-tests: only the unit and integration commands', async () => {
    const session = await assembled('briefs/write-failing-tests.md');
    expect(exec(session.tools)).toEqual(['git *', 'ls*', 'pnpm test', 'pnpm run test:integration']);
  });

  it('never a layer the step does not run: e2e and smoke are not granted to anyone', async () => {
    for (const brief of [
      'implement-story',
      'write-failing-tests',
      'fix-defect',
      'refactor-story',
    ]) {
      const session = await assembled(`briefs/${brief}.md`);
      expect(exec(session.tools), brief).not.toContain('pnpm e2e');
      expect(exec(session.tools), brief).not.toContain('pnpm smoke');
    }
  });

  it('control: a step whose brief runs no tests gets exactly the agent’s own grant', async () => {
    for (const brief of [
      'briefs/plan-story.md',
      'briefs/write-prd.md',
      'do the thing, inline prose',
    ]) {
      const session = await assembled(brief);
      expect(exec(session.tools), brief).toEqual(['git *', 'ls*']);
    }
  });

  it('every pattern in the grant is either the agent’s own or one configured command, verbatim; none is a wildcard the agent did not declare', async () => {
    const session = await assembled('briefs/implement-story.md');
    const own = new Set(ENGINEER.tools.exec);
    const configured = new Set<string>(Object.values(CONFIGURED));
    for (const pattern of exec(session.tools) as readonly string[]) {
      expect(own.has(pattern) || configured.has(pattern), pattern).toBe(true);
      if (!own.has(pattern)) expect(pattern).not.toContain('*');
    }
  });

  it('an agent that declares no exec is not handed one because its step names a test-running brief', async () => {
    const quiet = fixtureAgent('backend', {
      tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
    });
    const session = await assembled('briefs/implement-story.md', { agent: quiet });
    expect(exec(session.tools)).toBe(false);
    expect(block6(session.compiled.text)).not.toContain('test commands you may run');
  });

  it('a tainted step (`20` §20.5 point 3) has no exec at all, derived or its own', async () => {
    const session = await assembled('briefs/implement-story.md', { taint: 'external' });
    expect(exec(session.tools)).toBe(false);
    expect(session.compiled.text).not.toContain('pnpm test');
  });

  it('a read-only session (an interaction participant, an analysis) has no exec either', async () => {
    const session = await assembled('briefs/implement-story.md', { readOnly: true });
    expect(exec(session.tools)).toBe(false);
    expect(session.compiled.text).not.toContain('pnpm test');
  });

  it('no testCommands configured (or none of the asked layers): the grant is the agent’s own', async () => {
    for (const testCommands of [undefined, {}, { e2e: 'pnpm e2e' }]) {
      const session = await assembled('briefs/implement-story.md', { overrides: { testCommands } });
      expect(exec(session.tools)).toEqual(['git *', 'ls*']);
    }
  });

  it('is not held to the agent’s ceiling: a ceiling that names only `git *` still assembles (the derivation is not a widening of the definition)', async () => {
    const bounded = fixtureAgent('backend', {
      tools: ENGINEER.tools,
      ceiling: {
        tools: { write: true, exec: ['git *', 'ls*'], network: 'none', deploy: false },
      },
    });
    const session = await assembled('briefs/implement-story.md', { agent: bounded });
    expect(exec(session.tools)).toContain('pnpm test');
    // The definition's own ceiling is unchanged and still enforced on the definition: an agent WIDER than its ceiling is refused.
    const widened = fixtureAgent('backend', {
      tools: { ...ENGINEER.tools, exec: ['git *', 'ls*', 'curl *'] },
      ceiling: bounded.ceiling,
    });
    await expect(assembled('briefs/implement-story.md', { agent: widened })).rejects.toMatchObject({
      code: 'RUN-077',
    });
  });
});

describe('a configured value that could widen the grant is not granted, and block [6] says why the agent cannot run that layer', () => {
  const hostile = {
    unit: 'pnpm test; touch /tmp/pwned',
    integration: 'pnpm run test:integration *',
    lint: 'pnpm lint',
    typecheck: 'CI=1 pnpm typecheck',
  };

  it('grants only the layer that is one plain command', async () => {
    const session = await assembled('briefs/implement-story.md', {
      overrides: { testCommands: hostile },
    });
    expect(exec(session.tools)).toEqual(['git *', 'ls*', 'pnpm lint']);
  });

  it('block [6] lists what may run, one command per line, and names the layers that cannot', async () => {
    const session = await assembled('briefs/implement-story.md', {
      overrides: { testCommands: hostile },
    });
    const constraints = block6(session.compiled.text);
    expect(constraints).toContain('test commands you may run');
    expect(constraints).toMatch(/^ {2}- lint: `pnpm lint`$/m);
    expect(constraints).not.toContain('touch /tmp/pwned');
    expect(constraints).toMatch(
      /test layers this step needs with no runnable command .*: typecheck, unit, integration/,
    );
    expect(constraints).toContain('say they were not run');
  });

  it('block [6] states every derived command exactly, so the model is told what it may run', async () => {
    const session = await assembled('briefs/implement-story.md');
    const constraints = block6(session.compiled.text);
    for (const command of [
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm run test:integration',
    ]) {
      expect(constraints, command).toContain(`\`${command}\``);
    }
    expect(constraints).not.toContain('pnpm e2e');
    expect(constraints).not.toMatch(/test layers this step needs with no runnable command/);
  });

  it('unset layers the step needs are named as unable to run, not silently omitted', async () => {
    const session = await assembled('briefs/write-failing-tests.md', {
      overrides: { testCommands: { unit: 'pnpm test' } },
    });
    const constraints = block6(session.compiled.text);
    expect(constraints).toMatch(/no runnable command .*: integration/);
    expect(constraints).toMatch(/^ {2}- unit: `pnpm test`$/m);
  });
});

describe('the audit record says which test commands the session could run', () => {
  async function record(brief: string, testCommands: Record<string, string>) {
    const projectRoot = await repo();
    const ctx = createTestContext({
      projectRoot,
      assembly: assembly(projectRoot, { testCommands }),
    });
    const session = await assembleAgentSession({
      node: node({
        id: 'wf:step',
        kind: 'agent',
        agent: toAgentId('backend'),
        brief,
        produces: ['src/out.ts'],
      }),
      ctx,
    });
    await session.persist();
    return JSON.parse(
      await readFile(
        path.join(
          projectRoot,
          '.forge/state/runs',
          ctx.runId,
          'steps',
          promptRecordDirName(session.stepKey),
          'context.json',
        ),
        'utf8',
      ),
    ) as { testCommands?: unknown };
  }

  it('context.json lists the granted commands by layer and the layers with none', async () => {
    const written = await record('briefs/write-failing-tests.md', {
      unit: 'pnpm test',
      integration: 'pnpm run t; touch x',
    });
    expect(written.testCommands).toEqual({
      granted: [{ layer: 'unit', command: 'pnpm test' }],
      unavailable: ['integration'],
    });
  });

  it('a step that runs no tests has no such field', async () => {
    const written = await record('briefs/plan-story.md', { unit: 'pnpm test' });
    expect('testCommands' in written).toBe(false);
  });
});

describe('what the adapter actually receives', () => {
  it('SessionRequest.tools.exec holds exactly the agent’s patterns and the configured commands, and the strict adapter accepts the prompt', async () => {
    const projectRoot = await repo();
    const requests: SessionRequest[] = [];
    const adapter = new FakePlatformAdapter({}, { strict: true });
    adapter.script(
      (request) => {
        requests.push(request);
        return true;
      },
      { text: ['done'], structured: {} },
    );
    const ctx = createTestContext({ projectRoot, adapter, assembly: assembly(projectRoot) });
    await executeStep(
      node({
        id: 'wf:step',
        kind: 'agent',
        agent: toAgentId('backend'),
        brief: 'briefs/implement-story.md',
        produces: ['src/out.ts'],
      }),
      ctx,
    );
    const request = requests[0];
    if (request === undefined) throw new Error('no session started');
    expect(request.tools.exec).toEqual([
      'git *',
      'ls*',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm run test:integration',
    ]);
    // Enforcement at the adapter kit's own matcher: the configured commands run; one character more, or a chain, does not.
    const grant = request.tools;
    expect(isExecAllowed(grant, 'pnpm test')).toBe(true);
    expect(isExecAllowed(grant, 'pnpm test --watch')).toBe(false);
    expect(isExecAllowed(grant, 'pnpm test; touch /tmp/pwned')).toBe(false);
    expect(isExecAllowed(grant, 'pnpm e2e')).toBe(false);
    expect(isExecAllowed(grant, 'pnpm install')).toBe(false);
    expect(isExecAllowed(grant, 'npm test')).toBe(false);
  });
});

describe('vetProposedCommand accepts exactly the derived commands (the gate `forge debug` puts a model’s command through)', () => {
  async function grantFor(testCommands: Record<string, string>): Promise<{
    readonly grant: ToolGrant;
    readonly root: string;
  }> {
    const root = await repo();
    const session = await assembled('briefs/run-rca-framework.md', {
      overrides: { testCommands },
    });
    return { grant: session.tools, root };
  }

  it('the configured command runs; a command one character different is refused as not in the grant', async () => {
    const { grant, root } = await grantFor({ unit: 'pnpm test' });
    const trusted = { trustedCommands: ['pnpm test'] };
    expect(await vetProposedCommand('pnpm test', grant, root, trusted)).toBeUndefined();
    for (const near of [
      'pnpm tesT',
      'pnpm tests',
      'pnpm test ',
      'pnpm  test',
      'pnpm test -u',
      'pnpm test --update',
      'pnpm tes',
      'pnpm',
      'npm test',
      'pnpm run test',
      './pnpm test',
    ]) {
      const refusal = await vetProposedCommand(near, grant, root, trusted);
      expect(refusal, JSON.stringify(near)).toBeDefined();
    }
    expect((await vetProposedCommand('pnpm tests', grant, root, trusted))?.reason).toBe(
      'not-in-grant',
    );
    expect((await vetProposedCommand('pnpm test -u', grant, root, trusted))?.reason).toBe(
      'not-in-grant',
    );
  });

  it('a configured command is not a way to chain: the shell-operator veto still applies to a proposed command that merely starts with it', async () => {
    const { grant, root } = await grantFor({ unit: 'pnpm test' });
    const trusted = { trustedCommands: ['pnpm test'] };
    for (const chained of [
      'pnpm test && touch /tmp/pwned',
      'pnpm test; touch /tmp/pwned',
      'pnpm test | tee out',
      'pnpm test > out',
      'pnpm test $(touch /tmp/pwned)',
    ]) {
      const refusal = await vetProposedCommand(chained, grant, root, trusted);
      expect(refusal?.reason, chained).toMatch(/shell-operator|denylisted/);
    }
  });

  it('a package-manager test command (`pnpm typecheck`) is accepted only when it is the project’s own configured command', async () => {
    const { grant, root } = await grantFor({ unit: 'pnpm typecheck' });
    // The brief run-rca-framework derives unit and integration; `pnpm typecheck` configured AS the unit command is
    // the user's chosen command, so its verb is not the model's to choose.
    expect(
      await vetProposedCommand('pnpm typecheck', grant, root, {
        trustedCommands: ['pnpm typecheck'],
      }),
    ).toBeUndefined();
    // Without the trusted mark the vet still applies the package-manager verb rule (control: the option is what lets it through).
    expect((await vetProposedCommand('pnpm typecheck', grant, root))?.reason).toBe('network');
    // And a verb the model chose is refused however the pattern list looks.
    const widened: ToolGrant = { ...grant, exec: ['pnpm install'] };
    expect(
      (
        await vetProposedCommand('pnpm install', widened, root, {
          trustedCommands: ['pnpm typecheck'],
        })
      )?.reason,
    ).toBe('network');
  });
});

describe('every command the derivation grants is a command the vet accepts (the two cannot disagree)', () => {
  const legitimate = [
    'pnpm test',
    'pnpm run test:unit',
    'pnpm typecheck',
    'npm test',
    'yarn test',
    'cargo test',
    'go test ./...',
    'pytest -q tests/unit',
    'pytest /tmp/some-tests',
    'vitest run --config ../vitest.config.ts',
    'dotenv -e .env.test -- vitest',
    'node --test',
    "node -e 'process.exitCode=0'",
    'node -e "process.exitCode=1"',
    './scripts/run-tests.sh --fast',
    'make test',
  ];

  it.each(legitimate)(
    '%s: derived, and accepted as proposed when it is the configured command',
    async (command) => {
      const derived = deriveTestExec({ unit: command }, ['unit']);
      expect(derived.unavailable, command).toEqual([]);
      expect(derived.patterns).toEqual([command]);
      const root = await repo();
      const grant: ToolGrant = {
        read: true,
        write: false,
        exec: [...derived.patterns],
        network: 'none',
      };
      expect(
        await vetProposedCommand(command, grant, root, { trustedCommands: derived.patterns }),
        command,
      ).toBeUndefined();
    },
  );

  it.each([
    'curl https://example.com/x',
    'wget https://example.com/x',
    'ssh host',
    'git push origin main',
    'git clone https://example.com/x y',
    'git fetch',
    'git -c core.pager=x status',
    'git log --output=out.txt',
    'pytest --base-url http://localhost:8000',
    'pnpm test https://registry.npmjs.org',
    'jest --ci user@host:x',
    'pnpm install',
    'pnpm --filter x install',
    'pnpm dlx vitest',
    'npm publish',
    'yarn add left-pad',
    'npx vitest',
    'pip install evil',
    'cargo install evil',
    'cargo publish',
    'env npm install',
    'time pnpm install',
    'command npm install',
    'timeout 10 pytest',
    'xargs rm',
    'bash -c "npm install"',
    'sh -lc "curl example.com"',
    'find . -exec rm {} +',
    'find . -delete',
    'X+=1 pnpm install',
    'NPM install',
    'Npm install',
    'pnpm.exe add x',
    'npm.cmd install',
    'yarn',
    'npm',
    'yarn plugin import workspace-tools',
    'npm inst',
    'npm it',
    'pnpm ins',
    'npm audit fix',
    'npm exec vitest',
    'pnpm --filter web install',
    'poetry install',
    'bundle install',
    'composer install',
    'go get example.com/x',
    'go install example.com/x@latest',
    'bun add x',
    'deno install',
    'dotnet nuget push x',
    'mvn deploy',
    'gradle publish',
    'kubectl apply -f x',
    'terraform apply',
    'gh pr create',
    'rm build',
    'chmod 777 x',
    'tee out',
    'pytest ?.py',
    'cat [a].txt',
    "pytest -k 'a\\b'",
  ])(
    '%s: the derivation refuses whatever the vet would refuse for a model, so nothing is granted that cannot run',
    (command) => {
      const derived = deriveTestExec({ unit: command }, ['unit']);
      expect(derived.patterns, command).toEqual([]);
      expect(derived.unavailable[0]?.layer).toBe('unit');
    },
  );

  it('for a broad corpus, checkTestCommand ok implies the vet (network none, the command trusted) accepts it', async () => {
    const root = await repo();
    const corpus = [
      ...legitimate,
      'pnpm lint',
      'pnpm exec-tests',
      'pnpm run build:test',
      'npm run test -- --ci',
      'yarn jest',
      'bundle exec rspec',
      'mvn -q test',
      './gradlew test',
      'dotnet test',
      'deno test',
      'bun test',
      'phpunit',
      'sh scripts/test.sh',
      'bash scripts/test.sh --fast',
      'tox -e py311',
      'python -m pytest tests',
      'python3 -m unittest discover',
      'pnpm --filter web test',
      'pnpm --filter config test',
      'pnpm --filter create test',
      'pnpm --filter update test',
      'pnpm test -- -t update',
      'pnpm test -- --testNamePattern link',
      'npm test -- --grep add',
      'pnpm exec vitest run',
      'yarn exec jest',
      'pnpm run deploy-check',
      'pnpm typecheck',
      'go test -run TestInstall ./...',
      'cargo test -- install',
      'cargo build',
      'bundle exec rspec',
      'mvn -q test',
      './gradlew test',
      'dotnet test',
      'node --test',
    ];
    for (const command of corpus) {
      const derived = deriveTestExec({ unit: command }, ['unit']);
      if (derived.patterns.length === 0) continue;
      const grant: ToolGrant = {
        read: true,
        write: false,
        exec: [...derived.patterns],
        network: 'none',
      };
      expect(
        await vetProposedCommand(command, grant, root, { trustedCommands: derived.patterns }),
        command,
      ).toBeUndefined();
    }
  });

  it('a command the model proposes that merely resembles a configured one gets none of the trusted exemptions', async () => {
    const root = await repo();
    const grant: ToolGrant = {
      read: true,
      write: false,
      exec: ['pytest /tmp/some-tests', 'pnpm typecheck'],
      network: 'none',
    };
    const trusted = { trustedCommands: ['pytest /tmp/some-tests', 'pnpm typecheck'] };
    expect(
      (await vetProposedCommand('pytest /tmp/some-tests', grant, root, trusted))?.reason,
    ).toBeUndefined();
    expect(
      (await vetProposedCommand('pytest /tmp/other-tests', grant, root, trusted))?.reason,
    ).toBe('not-in-grant');
    // Even a pattern in the grant that is NOT the configured command keeps the path rule (control: it is the exact mark, not the grant, that exempts).
    const widened: ToolGrant = { ...grant, exec: ['pytest /tmp/other-tests'] };
    expect(
      (await vetProposedCommand('pytest /tmp/other-tests', widened, root, trusted))?.reason,
    ).toBe('path-escape');
  });
});
