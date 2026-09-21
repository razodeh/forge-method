/**
 * What a workflow may say about an `elicit` step (`PLAN-M13.md` P20): a question's name is an identifier (it is the
 * answer's name and the suffix of `FORGE_ANSWER_<name>`), names are unique across a workflow (a repeat would
 * silently replace an earlier answer), `choices` narrows the answer to listed values, and a command may not spell an
 * answer as a `{{answers...}}` placeholder (the plan is compiled before anyone has answered).
 */
import { describe, expect, it } from 'vitest';

import { compilePlan } from '../../src/plan/index.ts';
import { parseWorkflow, validateStructure } from '../../src/workflow/index.ts';

function workflowYaml(steps: readonly string[]): string {
  return ['id: w', 'name: w', 'version: 1.0.0', 'description: d', 'steps:', ...steps, ''].join(
    '\n',
  );
}

const elicit = (id: string, ...questions: readonly string[]): string =>
  [`  - id: ${id}`, '    kind: elicit', '    questions:', ...questions].join('\n');
const question = (name: string, extra = ''): string =>
  [`      - name: ${name}`, '        prompt: "Question?"', ...(extra === '' ? [] : [extra])].join(
    '\n',
  );

function parse(steps: readonly string[]) {
  const parsed = parseWorkflow(workflowYaml(steps));
  if (!parsed.success) throw new Error(`does not parse: ${JSON.stringify(parsed.issues)}`);
  return parsed.workflow;
}

describe('elicit question shape', () => {
  it.each(['ideaSummary', 'a', 'level_2', 'Q1'])('accepts the identifier %s', (name) => {
    expect(parseWorkflow(workflowYaml([elicit('e', question(name))])).success).toBe(true);
  });

  it.each(['1st', 'has-dash', 'has space', 'a.b', 'a$b', 'a;b', ''])(
    'rejects %j, which cannot be an environment variable suffix or an answer name',
    (name) => {
      expect(
        parseWorkflow(workflowYaml([elicit('e', question(JSON.stringify(name)))])).success,
      ).toBe(false);
    },
  );

  it('carries choices through to the compiled step', () => {
    const workflow = parse([elicit('e', question('level', '        choices: [L0, L1]'))]);
    const compiled = compilePlan(workflow, {});
    expect(compiled.success && compiled.nodes[0]?.questions).toEqual([
      { name: 'level', prompt: 'Question?', choices: ['L0', 'L1'] },
    ]);
  });

  it('rejects a choice with surrounding space (it could never be answered) and a repeated one', () => {
    expect(
      parseWorkflow(workflowYaml([elicit('e', question('x', '        choices: [" L0", L1]'))]))
        .success,
    ).toBe(false);
    expect(
      parseWorkflow(workflowYaml([elicit('e', question('x', '        choices: [L0, L0]'))]))
        .success,
    ).toBe(false);
  });

  it('rejects an empty choices list and a blank choice', () => {
    expect(
      parseWorkflow(workflowYaml([elicit('e', question('x', '        choices: []'))])).success,
    ).toBe(false);
    expect(
      parseWorkflow(workflowYaml([elicit('e', question('x', '        choices: [""]'))])).success,
    ).toBe(false);
  });
});

describe('question names are unique across a workflow', () => {
  const twice = [elicit('one', question('level')), elicit('two', question('level'))];

  it('validateStructure reports the repeat and the steps that ask it', () => {
    const issues = validateStructure(parse(twice));
    const repeat = issues.find((found) => found.code === 'duplicate-elicit-question');
    expect(repeat?.severity).toBe('error');
    expect(repeat?.message).toContain('"level"');
    expect(repeat?.message).toContain('one, two');
  });

  it('a name repeated inside one step is the same problem', () => {
    const issues = validateStructure(parse([elicit('one', question('a'), question('a'))]));
    expect(issues.map((found) => found.code)).toContain('duplicate-elicit-question');
  });

  it('compilePlan refuses it too: forge run does not call validateStructure', () => {
    const compiled = compilePlan(parse(twice), {});
    expect(compiled.success).toBe(false);
    if (compiled.success) return;
    expect(compiled.issues.map((found) => found.code)).toContain('duplicate-elicit-question');
  });

  it('distinct names are clean', () => {
    const workflow = parse([elicit('one', question('a')), elicit('two', question('b'))]);
    expect(validateStructure(workflow)).toEqual([]);
    expect(compilePlan(workflow, {}).success).toBe(true);
  });
});

describe('a command reads an answer from its environment, not from a placeholder', () => {
  it('refuses {{answers.x}} in run, saying to use $FORGE_ANSWER_x', () => {
    const workflow = parse([
      elicit('ask', question('level')),
      [
        '  - id: record',
        '    kind: command',
        '    dependsOn: [ask]',
        '    run: "forge config set project.level {{answers.level}}"',
      ].join('\n'),
    ]);
    const compiled = compilePlan(workflow, {});
    expect(compiled.success).toBe(false);
    if (compiled.success) return;
    const found = compiled.issues.find((entry) => entry.code === 'answers-not-known-at-plan-time');
    expect(found?.stepId).toBe('w:record');
    expect(found?.message).toContain('FORGE_ANSWER_');
  });

  it('accepts the environment form, and leaves the command text exactly as written', () => {
    const run = 'forge config set project.level "$FORGE_ANSWER_level"';
    const workflow = parse([
      elicit('ask', question('level')),
      ['  - id: record', '    kind: command', '    dependsOn: [ask]', `    run: '${run}'`].join(
        '\n',
      ),
    ]);
    const compiled = compilePlan(workflow, {});
    expect(compiled.success && compiled.nodes[1]?.run).toBe(run);
  });
});
