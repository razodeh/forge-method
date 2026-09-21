/**
 * Real-subprocess proof of `forge run --answers` and `forge resume --answers` through the actual `forge` launcher
 * (`PLAN-M13.md` P20, `10` §10.1, owner decision 2026-09-20): the `elicit` step takes its answers from a file, a run
 * with no answers and no terminal stops at the question and says how to answer (it never waits on stdin), a bad
 * answers file is a usage error and not a stack trace, and a run stopped at a question is finished by a resume that
 * brings the answers. The workflow has an `elicit` step and `command` steps only, so no model session is started.
 *
 * A terminal cannot be attached to a subprocess here; the prompt itself is exercised against in-memory streams in
 * `commands/run/ask.test.ts`.
 *
 * @see specs/10 §10.1
 * @see specs/03 §3.2.4
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-cli-p20-${prefix}-`));
  dirs.push(dir);
  return dir;
}

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** stdin is `ignore`d: a process that waited on it would be waiting on `/dev/null` and see it end, so a hang would
 * show as the 60 s timeout, not pass. */
function run(args: readonly string[], cwd?: string): Result {
  const result = spawnSync(process.execPath, [LAUNCHER, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(cwd === undefined ? {} : { cwd }),
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

interface Project {
  readonly dir: string;
  /** Outside the repository, so an inline command may write there. */
  readonly outFile: string;
}

async function project(): Promise<Project> {
  const dir = await scratch('project');
  const outDir = await scratch('out');
  const outFile = path.join(outDir, 'answer.txt');
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await mkdir(path.join(dir, '.forge/workflows'), { recursive: true });
  await mkdir(path.join(dir, '.forge/checks'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
  await writeFile(
    path.join(dir, '.forge/workflows/p20-ask.workflow.yaml'),
    `id: p20-ask
name: P20 fixture
version: 1.0.0
description: An elicit step, then a command that reads the answer.

steps:
  - id: ask
    kind: elicit
    questions:
      - name: idea
        prompt: "What are we building?"
      - name: level
        prompt: "Which level?"
        choices: [L0, L1, L2]
  - id: record
    kind: command
    inline: true
    dependsOn: [ask]
    run: 'printf "%s|%s" "$FORGE_ANSWER_level" "$FORGE_ANSWER_idea" > ${outFile}'
`,
  );
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
  return { dir, outFile };
}

async function answers(content: unknown, name = 'answers.json'): Promise<string> {
  const dir = await scratch('answers');
  const file = path.join(dir, name);
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

describe('forge run --answers', () => {
  it('answers the elicit step from the file and the next step reads it from its environment', async () => {
    const { dir, outFile } = await project();
    const file = await answers({ idea: 'A booking app', level: 'L1' });

    const result = run(['run', 'p20-ask', '--answers', file, '-C', dir]);

    expect(result.stdout).toContain('status=completed');
    expect(result.status).toBe(0);
    expect(await readFile(outFile, 'utf8')).toBe('L1|A booking app');
  });

  it('an answer that looks like shell code is data: it reaches the command as text and nothing runs', async () => {
    const { dir, outFile } = await project();
    const proof = path.join(path.dirname(outFile), 'PWNED');
    const hostile = `x'; touch ${proof} #\`touch ${proof}\`$(touch ${proof})`;
    const file = await answers({ idea: hostile, level: 'L0' });

    const result = run(['run', 'p20-ask', '--answers', file, '-C', dir]);

    expect(result.status).toBe(0);
    expect(existsSync(proof)).toBe(false);
    expect(await readFile(outFile, 'utf8')).toBe(`L0|${hostile}`);
  });

  it('reads YAML too', async () => {
    const { dir, outFile } = await project();
    const file = await answers('idea: |\n  two\n  lines\nlevel: L2\n', 'answers.yaml');
    expect(run(['run', 'p20-ask', '--answers', file, '-C', dir]).status).toBe(0);
    expect(await readFile(outFile, 'utf8')).toBe('L2|two\nlines');
  });

  it('with no answers and no terminal the run stops at the question, says which and how to answer, and does not wait', async () => {
    const { dir, outFile } = await project();

    const result = run(['run', 'p20-ask', '-C', dir]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('status=failed');
    expect(result.stderr).toContain('no answer for question "idea"');
    expect(result.stderr).toContain('--answers');
    expect(result.stderr).not.toMatch(/\n\s+at /u);
    expect(existsSync(outFile)).toBe(false);
  });

  it('a partial answers file leaves the missing question unanswered and names it', async () => {
    const { dir, outFile } = await project();
    const file = await answers({ idea: 'x' });

    const result = run(['run', 'p20-ask', '--answers', file, '-C', dir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no answer for question "level"');
    expect(existsSync(outFile)).toBe(false);
  });

  it('an answer that is not one of the question choices is warned about at once and fails the step', async () => {
    const { dir, outFile } = await project();
    const file = await answers({ idea: 'x', level: 'L9' });

    const result = run(['run', 'p20-ask', '--answers', file, '-C', dir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'the answer to "level" in --answers is refused: it must be exactly one of: L0, L1, L2',
    );
    expect(existsSync(outFile)).toBe(false);
  });

  it('warns about an answer no question asks (a misspelt name)', async () => {
    const { dir } = await project();
    const file = await answers({ idea: 'x', level: 'L0', lvel: 'L1' });

    const result = run(['run', 'p20-ask', '--answers', file, '-C', dir]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('an answer for "lvel"');
    expect(result.stderr).toContain('no question of workflow p20-ask asks');
  });

  it.each([
    ['a file that does not exist', () => path.join(tmpdir(), 'forge-p20-missing', 'nope.json')],
    ['a list', () => answers('["a"]')],
    ['a nested value', () => answers({ idea: { deep: 1 } })],
    ['invalid syntax', () => answers('{"idea": ')],
  ])('%s is a usage error naming RUN-103, before any run starts', async (_label, make) => {
    const { dir } = await project();
    const file = await make();

    const result = run(['run', 'p20-ask', '--answers', file, '-C', dir]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('cannot be used');
    expect(result.stderr).toContain('question name');
    expect(result.stderr).not.toMatch(/\n\s+at /u);
    // No run began: nothing under .forge/state/runs.
    expect(existsSync(path.join(dir, '.forge/state/runs'))).toBe(false);
  });
});

describe('forge resume --answers', () => {
  it('finishes a run that stopped at a question, asking it again with the answers', async () => {
    const { dir, outFile } = await project();
    const first = run(['run', 'p20-ask', '-C', dir]);
    expect(first.status).toBe(1);
    expect(existsSync(outFile)).toBe(false);

    const file = await answers({ idea: 'second time', level: 'L2' });
    const second = run(['resume', '--answers', file, '-C', dir]);

    expect(second.stderr).not.toContain('no answer for question');
    expect(second.stdout).toContain('status=completed');
    expect(second.status).toBe(0);
    expect(await readFile(outFile, 'utf8')).toBe('L2|second time');
  });

  it('a resume with no answers fails at the same question again, with the same remedy', async () => {
    const { dir } = await project();
    run(['run', 'p20-ask', '-C', dir]);

    const second = run(['resume', '-C', dir]);

    expect(second.status).toBe(1);
    expect(second.stderr).toContain('no answer for question "idea"');
    expect(second.stderr).toContain('forge resume --answers');
  });
});
