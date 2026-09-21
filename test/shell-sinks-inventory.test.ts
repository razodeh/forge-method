/**
 * Every place text that a model, a fetched page, a KB or spec document, or a run input wrote can become a shell
 * command (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222; `20` §20.1, §20.4, §20.5).
 *
 * The inventory is the pinned list below: for each source file that starts a shell (`execa(..., { shell: true })`,
 * `runShellCommand(...)`, `child_process`) it says where the command text comes from, what checks stand between that
 * text and the shell, and what P28 did about it. It is a test, not prose, so it cannot go stale in either direction:
 *   - a production file that starts a shell and is not listed fails ("add it, with its source and its checks");
 *   - a listed file that no longer starts one is not an error (a sink that was removed is good news), but a listed
 *     file that exists and has none is reported so the list can be trimmed.
 * Counting sinks per file is deliberately not part of it (concurrent pieces add a call to a file already listed); a
 * new sink in a new file, which is what changes the threat model, is.
 *
 * Verified by reading each call site (P28), not derived from the P27 list, which named two of these.
 *
 * @see specs/20 §20.1
 * @see specs/20 §20.5
 * @see SPEC-QUESTIONS.md Q222
 */
import { execa } from 'execa';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Sink {
  /** Where the command text comes from. */
  readonly source: string;
  /** What stands between that text and the shell. */
  readonly checks: string;
  /** `confined`: the model-proposed path, held to a grant. `quoted`: interpolated values are data. `trusted`: text a
   * project author wrote in a file the user controls. `open`: untrusted text reaches a shell with no check; disclosed. */
  readonly status: 'confined' | 'quoted' | 'trusted' | 'open';
}

const INVENTORY: Readonly<Record<string, Sink>> = {
  'packages/adapter-kit/src/conformance/git.ts': {
    source:
      'the adapter conformance harness’s own fixed `git init` / `git ...` calls (`execFile`, argv, no shell)',
    checks: 'no shell, no model or document text: fixed arguments in a temporary directory',
    status: 'trusted',
  },
  'packages/engine/src/dispatch/shell.ts': {
    source: 'the one shell runner every caller below shares (`execa(..., { shell: true })`)',
    checks:
      'none of its own: it runs what it is given, in the environment it is given, with optional limits (P25)',
    status: 'trusted',
  },
  'packages/engine/src/dispatch/confined-command.ts': {
    source:
      'a shell command a MODEL proposed (`forge debug` REPRODUCE/PROVE), via `createRcaShell`',
    checks:
      'P28: hard denylist, shell-operator veto, quote-aware expansion refusal, the agent’s exec patterns, network policy, ' +
      'lane path containment (symlinks, secret files, .git), dangerous-argument list; then a scrubbed environment ' +
      '(allowlist), closed stdin, lane cwd, timeout, output cap, process-group kill',
    status: 'confined',
  },
  'packages/engine/src/dispatch/steps.ts': {
    source:
      '`kind: command` step `run:` (workflow YAML authored by the project or a module) with run inputs, story/epic ' +
      'fields, fanout items and stage variables substituted in',
    checks:
      'P28: every substituted value is shell-quoted for its quote context at the interpolation point (`shellQuoteValue`, ' +
      'compile.ts); P21: `--input` values that a shell command reads must be plain tokens (RUN-088). The `run:` text itself ' +
      'is the workflow author’s and is not confined to a grant; the environment is the parent’s plus `commandEnv`',
    status: 'quoted',
  },
  'packages/engine/src/dispatch/facades.ts': {
    source:
      'gate `check.run` (gate YAML in `.forge/checks`, module or overlay authored) and a merge policy’s pre/post checks ' +
      '(workflow YAML)',
    checks:
      'no interpolation of run inputs or model text; parent environment plus `commandEnv`; author-trusted',
    status: 'trusted',
  },
  'packages/cli/src/commands/run/gate-commands.ts': {
    source:
      '`forge gate check|approve`: the same gate `check.run` strings, run in the project root',
    checks: 'as facades.ts; a human typed the command',
    status: 'trusted',
  },
  'packages/cli/src/commands/loop/test/run.ts': {
    source:
      '`execution.testCommands.*` from `.forge/config.yaml` (the user’s own command), plus a fixed `--format json`',
    checks: 'user-authored config; no model text',
    status: 'trusted',
  },
  'packages/cli/src/commands/loop/test/reporter.ts': {
    source:
      'the configured test command plus a file path and a test name taken from a previous test report (`fileArg`, `filterFlag`)',
    checks:
      'both values pass the local `shellQuote` (single-quote wrapping) before they reach the shell',
    status: 'quoted',
  },
  'packages/cli/src/commands/loop/test/layer.ts': {
    source:
      '`execution.testCommands.<rule>` for `forge test run --rule ...` (P25), a gate check’s command',
    checks: 'user-authored config; timeout and output cap (`ShellLimits`); no model text',
    status: 'trusted',
  },
  'packages/vcs/src/claims.ts': {
    source:
      '`applySharedPathStrategy` `regenerate` `command` (workflow / config `sharedMutablePaths`)',
    checks: 'author-trusted text run in the lane; no interpolation; parent environment',
    status: 'trusted',
  },
  'packages/engine/src/adopt/verification.ts': {
    source:
      '`forge adopt` phase 5: a build and a test command DERIVED FROM THE BROWNFIELD REPOSITORY (package scripts, Makefile, ' +
      'Dockerfile CMD), i.e. text a third party wrote',
    checks:
      'runs in a throwaway clone with a timeout; the parent environment is passed whole (no scrub), no grant, no denylist. ' +
      'DISCLOSED, not fixed by P28 (Q222): the owner decides whether verification may run an untrusted repository’s commands at all',
    status: 'open',
  },
  'packages/cli/src/commands/kb.ts': {
    source:
      '`forge kb verify`: the command stored in a KB entry’s verification field. KB entries are written by agents and by ' +
      '`forge adopt`, so the text can be model-authored',
    checks:
      'a timeout and a truncated output; runs in the LIVE project tree with the whole parent environment; no grant, no ' +
      'denylist, no scrub. DISCLOSED, not fixed by P28 (Q222): a stored command should pass the same vet as a proposed one',
    status: 'open',
  },
};

/** A line that starts a shell or a process: `shell: true` (or any `shell:` option that names a shell), a
 * `runShellCommand(` call (not its definition), `execaCommand(`, `execSync(`/`spawn(`/`spawnSync(`, or ANY mention of
 * `node:child_process` (an import counts: whoever imports it can call `exec(text)` anywhere in the file). Comment
 * lines are skipped. */
const SINK_LINE =
  /shell:\s*(true|['"`\w])|runShellCommand\(|\bexecaCommand\(|\bexecSync\(|\bspawnSync?\(|node:child_process/;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const IMPORT_LINE = /^\s*import\s/;
const startsShell = (line: string): boolean =>
  SINK_LINE.test(line) &&
  !COMMENT_LINE.test(line) &&
  !line.includes('function runShellCommand') &&
  // an import of the shared runner is not a call (its calls are the sinks); an import of child_process is
  (!IMPORT_LINE.test(line) || line.includes('node:child_process'));

async function sourceFiles(): Promise<readonly string[]> {
  const { stdout } = await execa(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'packages'],
    { cwd: repoRoot },
  );
  return stdout
    .split('\0')
    .filter((file) => /\.(ts|mts)$/.test(file) && /^packages\/[^/]+\/src\//.test(file));
}

describe('shell sinks (PLAN-M13.md P28)', () => {
  it('every production file that starts a shell is in the inventory, with its source, its checks and its status', async () => {
    const found: string[] = [];
    for (const file of await sourceFiles()) {
      let text: string;
      try {
        text = await readFile(path.join(repoRoot, file), 'utf8');
      } catch {
        continue; // deleted in the working tree
      }
      const hit = text.split('\n').some(startsShell);
      if (hit) found.push(file);
    }
    // A scan that finds nothing must not read as "no unlisted sink".
    expect(found.length).toBeGreaterThan(8);
    const unlisted = found.filter((file) => INVENTORY[file] === undefined);
    expect(
      unlisted,
      `a new place starts a shell: add it to INVENTORY in test/shell-sinks-inventory.test.ts with where its command text ` +
        `comes from and what checks it (a model-authored text must go through createRcaShell / vetProposedCommand)`,
    ).toEqual([]);
    // Nothing in the model-proposed path is called directly any more: `forge debug` reaches a shell only through the
    // confined runner (its own file is `confined`, and `debug.ts` is not a sink at all).
    expect(found).not.toContain('packages/cli/src/commands/loop/debug.ts');
  });

  it('the detector itself: an import of child_process, execaCommand, a shell option and a runner call are sinks; a comment and a runner import are not', () => {
    for (const line of [
      "import { exec, spawn } from 'node:child_process';",
      'await execaCommand(text);',
      "execa(cmd, { shell: '/bin/sh' });",
      'execa(cmd, { shell: true });',
      'await runShellCommand(command, cwd);',
      'execSync(text);',
    ]) {
      expect(startsShell(line), line).toBe(true);
    }
    for (const line of [
      ' * runs `shell: true` through node:child_process',
      '// runShellCommand(x)',
      "import { runShellCommand } from '@forge/engine/dispatch';",
      'export async function runShellCommand(',
    ]) {
      expect(startsShell(line), line).toBe(false);
    }
  });

  it('a listed sink whose file exists still starts a shell (a removed sink is trimmed from the list)', async () => {
    const stale: string[] = [];
    for (const file of Object.keys(INVENTORY)) {
      let text: string;
      try {
        text = await readFile(path.join(repoRoot, file), 'utf8');
      } catch {
        continue; // not present in this checkout (a concurrent piece's file not yet committed)
      }
      const hit = text.split('\n').some(startsShell);
      if (!hit) stale.push(file);
    }
    expect(stale).toEqual([]);
  });

  it('the untrusted-source sinks that P28 leaves open are exactly the ones the Q entry discloses', () => {
    const open = Object.entries(INVENTORY)
      .filter(([, sink]) => sink.status === 'open')
      .map(([file]) => file)
      .sort();
    expect(open).toEqual([
      'packages/cli/src/commands/kb.ts',
      'packages/engine/src/adopt/verification.ts',
    ]);
  });

  it('the model-proposed path is the only one with the confined status, and its runner is the RCA shell', async () => {
    const confined = Object.entries(INVENTORY)
      .filter(([, sink]) => sink.status === 'confined')
      .map(([file]) => file);
    expect(confined).toEqual(['packages/engine/src/dispatch/confined-command.ts']);
    const debugSource = await readFile(
      path.join(repoRoot, 'packages/cli/src/commands/loop/debug.ts'),
      'utf8',
    );
    expect(debugSource).toContain('createRcaShell(');
    const code = debugSource
      .split('\n')
      .filter((line) => !COMMENT_LINE.test(line) && !IMPORT_LINE.test(line))
      .join('\n');
    expect(code).not.toMatch(/runShellCommand/);
  });
});
