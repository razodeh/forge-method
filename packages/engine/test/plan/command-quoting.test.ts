/**
 * A `kind: command` step's `run` is shell text, and the values substituted into it come from run inputs, story and
 * epic fields and fanout items (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222; `20` §20.5: content not authored by the
 * user or FORGE is untrusted). Before this, `stageId`, `defectId`, `{{item.id}}` and every other placeholder were
 * substituted verbatim, so `--input stageId='x; touch pwned'` was code. Every value is now data: these tests compile
 * a command step with hostile values, run the compiled text in a real `/bin/sh` and check that the value arrives as
 * ONE argument, byte for byte, and that a canary file the value tried to create does not exist.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveTemplate, shellQuoteValue, type ExpressionContext } from '../../src/expr/index.ts';
import { compilePlan, expandFanout } from '../../src/plan/compile.ts';
import type { StepNode } from '../../src/plan/types.ts';
import type { Workflow, WorkflowStep } from '../../src/workflow/types.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-quote-'));
  dirs.push(dir);
  return dir;
}

function workflow(steps: readonly WorkflowStep[]): Workflow {
  return { id: 'w', name: 'W', version: '1.0.0', description: 'd', steps };
}

/** The context a run would supply: named roots the type does not enumerate (`stageId`, `vars`, an input name). */
function asContext(value: Readonly<Record<string, unknown>>): ExpressionContext {
  return value;
}

function compiledRun(run: string, context: Readonly<Record<string, unknown>>): string {
  const result = compilePlan(workflow([{ kind: 'command', id: 'c', run }]), asContext(context));
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  const node: StepNode | undefined = result.nodes[0];
  if (node?.run === undefined) throw new Error('no run');
  return node.run;
}

/** Values that are code if substituted raw. `CANARY` is replaced by the absolute path the test checks afterwards. */
const HOSTILE: readonly string[] = [
  'x; touch CANARY',
  'x && touch CANARY',
  'x || touch CANARY',
  'x | touch CANARY',
  'x & touch CANARY',
  '$(touch CANARY)',
  '`touch CANARY`',
  'x\ntouch CANARY',
  "x'; touch CANARY; '",
  'x"; touch CANARY; "',
  'x > CANARY',
  '$HOME',
  '${IFS}',
  'a b  c',
  '*',
  '~',
  "it's",
  'say "hi"',
  '\\',
  '',
  '-rf',
  '#comment',
  '(subshell)',
  'ünïcode ✓',
];

describe('a substituted value is data in an unquoted position', () => {
  it.each(HOSTILE)(
    '%j reaches the program as one argument, unchanged, and runs nothing',
    async (raw) => {
      const dir = await scratch();
      const canary = path.join(dir, 'pwned');
      const value = raw.replaceAll('CANARY', canary);
      for (const [template, context] of [
        ['printf "%s|" {{stageId}}', { stageId: value }],
        ['printf "%s|" {{defectId}}', { defectId: value }],
        ['printf "%s|" {{vars.integration_branch}}', { vars: { integration_branch: value } }],
        ['printf "%s|" --flag={{stageId}}', { stageId: value }],
      ] as const) {
        const run = compiledRun(template, context);
        const result = await execa(run, { cwd: dir, shell: true, reject: false });
        expect(result.exitCode, run).toBe(0);
        const expected = template.includes('--flag=') ? `--flag=${value}|` : `${value}|`;
        expect(result.stdout, run).toBe(expected);
      }
      await expect(stat(canary)).rejects.toThrow();
    },
  );

  it('a fanout item field is data too ({{item.id}} and {{item.owner_role}})', async () => {
    const dir = await scratch();
    const canary = path.join(dir, 'pwned');
    const hostile = `STORY-1; touch ${canary}`;
    const result = expandFanout(
      {
        kind: 'fanout',
        id: 'verify',
        over: 'stage.stories',
        itemKey: 'one',
        step: { kind: 'command', run: 'printf "%s|%s|" {{item.id}} {{item.owner_role}}' },
      },
      'w',
      { stage: { stories: [{ id: hostile, owner_role: '$(touch ' + canary + ')' }] } },
    );
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    const run = result.nodes[0]?.run;
    if (run === undefined) throw new Error('no run');
    const out = await execa(run, { cwd: dir, shell: true, reject: false });
    expect(out.stdout).toBe(`${hostile}|$(touch ${canary})|`);
    await expect(stat(canary)).rejects.toThrow();
  });
});

describe('a template that already quotes its placeholder stays safe', () => {
  it.each(HOSTILE)('%j inside single and inside double quotes', async (raw) => {
    const dir = await scratch();
    const canary = path.join(dir, 'pwned');
    const value = raw.replaceAll('CANARY', canary);
    for (const template of ['printf "%s|" \'{{stageId}}\'', 'printf "%s|" "{{stageId}}"']) {
      const run = compiledRun(template, { stageId: value });
      const result = await execa(run, { cwd: dir, shell: true, reject: false });
      expect(result.exitCode, run).toBe(0);
      expect(result.stdout, run).toBe(`${value}|`);
    }
    await expect(stat(canary)).rejects.toThrow();
  });

  it('a quote in the literal text before the placeholder does not confuse the quote state after it', async () => {
    const dir = await scratch();
    const run = compiledRun('printf "%s|%s|" \'a b\' {{stageId}} && printf x', { stageId: 'c d' });
    const result = await execa(run, { cwd: dir, shell: true, reject: false });
    expect(result.stdout).toBe('a b|c d|x');
  });

  it('an escaped quote in the literal text is not read as opening a quote', async () => {
    const dir = await scratch();
    const run = compiledRun('printf "%s|" \\\'{{stageId}}', { stageId: 'a b' });
    const result = await execa(run, { cwd: dir, shell: true, reject: false });
    expect(result.stdout).toBe("'a b|");
  });
});

describe('a placeholder in a context the scanner cannot model is refused, not guessed at', () => {
  it.each([
    ['command substitution', 'echo $(echo {{x}})'],
    ['a backtick', 'echo `echo {{x}}`'],
    ['a here-document', 'cat <<EOF\n{{x}}\nEOF'],
    ['ANSI-C quoting', "echo $'a'{{x}}"],
    ['a parameter expansion', 'echo ${A:-{{x}}}'],
    ['a comment', 'echo hi # {{x}}'],
    ['a literal backslash', "echo \\{{x}} it's"],
    ['a backslash inside double quotes', 'echo "\\{{x}}"'],
    ['a literal dollar', 'echo ${{x}}'],
    ['a backtick inside double quotes', 'echo "`date` {{x}}"'],
  ])('%s', (_label, run) => {
    const result = compilePlan(
      workflow([{ kind: 'command', id: 'c', run }]),
      asContext({ x: 'v' }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(['template-resolution-failed']);
  });

  it('single-quoted literal text that only LOOKS like one of them is data, and a value after it is still quoted', () => {
    expect(compiledRun("echo '$(not code)' {{x}}", { x: 'a b' })).toBe("echo '$(not code)' 'a b'");
  });

  it('a line continuation (backslash-newline) is consumed by the shell, so the value after it is quoted as usual and stays data', async () => {
    const dir = await scratch();
    const canary = path.join(dir, 'pwned');
    const run = compiledRun('printf "%s|" a\\\n{{x}}', { x: `b; touch ${canary}` });
    const result = await execa(run, { cwd: dir, shell: true, reject: false });
    expect(result.stdout).toBe(`ab; touch ${canary}|`);
    await expect(stat(canary)).rejects.toThrow();
  });

  it('a comment ends at its newline: a placeholder on a later line is quoted as usual, and an apostrophe in the comment does not confuse it', () => {
    expect(compiledRun("# it's a note\necho {{x}}", { x: 'a b' })).toBe(
      "# it's a note\necho 'a b'",
    );
  });

  it('a template with none of them in front of the placeholder is untouched by the check (a `#` inside a word, `<` once)', () => {
    expect(compiledRun('echo a#b {{x}}', { x: 'v' })).toBe('echo a#b v');
    expect(compiledRun('cat < {{x}}', { x: 'v' })).toBe('cat < v');
  });
});

describe('the shipped commands keep their exact text', () => {
  it('a plain token is substituted as it is, so no shipped `run:` string changes', () => {
    expect(compiledRun('forge plan run-plan {{stageId}} --json', { stageId: 'mvp' })).toBe(
      'forge plan run-plan mvp --json',
    );
    expect(compiledRun('forge story verify {{storyId}} --json', { storyId: 'STORY-014' })).toBe(
      'forge story verify STORY-014 --json',
    );
    expect(
      compiledRun(
        'git switch -c {{vars.integration_branch}} || git switch {{vars.integration_branch}}',
        {
          vars: { integration_branch: 'forge/integration/mvp' },
        },
      ),
    ).toBe('git switch -c forge/integration/mvp || git switch forge/integration/mvp');
  });

  it('only a `command` step’s `run` is quoted: a branch name, a glob and an agent id are substituted verbatim', () => {
    const result = compilePlan(
      workflow([
        { kind: 'agent', id: 'a', agent: '{{who}}', produces: ['{{dir}}/x.md'] },
        { kind: 'command', id: 'c', run: 'echo {{dir}}' },
      ]),
      asContext({ who: 'engineer', dir: 'a b' }),
    );
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect(result.nodes[0]?.produces).toEqual(['a b/x.md']);
    expect(result.nodes[1]?.run).toBe("echo 'a b'");
  });

  it('resolveTemplate without an escape option is unchanged', () => {
    expect(resolveTemplate('x {{a}}', asContext({ a: 'b c; d' }))).toBe('x b c; d');
  });
});

describe('shellQuoteValue', () => {
  it('leaves plain tokens alone and wraps everything else', () => {
    expect(shellQuoteValue('STORY-014', 'none')).toBe('STORY-014');
    expect(shellQuoteValue('a/b.c_d@e:f,g=h+i%j', 'none')).toBe('a/b.c_d@e:f,g=h+i%j');
    expect(shellQuoteValue('', 'none')).toBe("''");
    expect(shellQuoteValue('a b', 'none')).toBe("'a b'");
    expect(shellQuoteValue("it's", 'none')).toBe("'it'\\''s'");
    expect(shellQuoteValue("it's", 'single')).toBe("it'\\''s");
    expect(shellQuoteValue('a"b$c`d\\e', 'double')).toBe('a\\"b\\$c\\`d\\\\e');
  });

  it('a NUL byte cannot be part of a shell word and is refused (CFG-015), not truncated', () => {
    expect(() =>
      resolveTemplate('echo {{a}}', asContext({ a: 'x\0y' }), { escapeValue: shellQuoteValue }),
    ).toThrow(expect.objectContaining({ code: 'CFG-015' }));
  });
});
