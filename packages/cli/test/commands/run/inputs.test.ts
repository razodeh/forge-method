/**
 * `forge run --input <name>=<value>` (`03` §3.2.4, `PLAN-M13.md` P21): what a pair may look like, how a value
 * is typed by the workflow's declared input type, and what a refusal says. Every refusal is a `RUN-088` that
 * carries a remedy (the exit code is the usage one), never a bare `Error`.
 *
 * @see specs/03 §3.2.4
 * @see specs/10 §10.1
 */
import { describe, expect, it } from 'vitest';
import { isForgeError } from '@forge/core/errors';

import {
  assertShellSafe,
  coerceInput,
  extractInputFlags,
  parseInputPairs,
  readsRunValues,
  referencedRunInputs,
  shellFacingInputs,
} from '../../../src/commands/run/inputs.ts';

interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
  readonly exitCode: number;
}

function refusal(fn: () => unknown): Refusal {
  try {
    fn();
  } catch (error) {
    if (isForgeError(error)) {
      return {
        code: error.code,
        message: error.message,
        remedy: error.remedy,
        exitCode: error.exitCode,
      };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('extractInputFlags', () => {
  it('collects every --input, in order, and leaves the other arguments alone', () => {
    expect(
      extractInputFlags(['--stage', 'S1', '--input', 'a=1', '--epic', 'E', '--input', 'b=2']),
    ).toEqual({ inputs: ['a=1', 'b=2'], rest: ['--stage', 'S1', '--epic', 'E'] });
  });

  it('takes the very next token as the value, whatever it looks like', () => {
    expect(extractInputFlags(['--input', '--stage'])).toEqual({ inputs: ['--stage'], rest: [] });
  });

  it('refuses a trailing --input with a remedy', () => {
    const error = refusal(() => extractInputFlags(['--stage', 'S1', '--input']));
    expect(error.code).toBe('RUN-088');
    expect(error.remedy).toContain('--input <name>=<value>');
    expect(error.exitCode).toBe(2);
  });

  it('is a no-op when there is no --input', () => {
    expect(extractInputFlags(['--stage', 'S1'])).toEqual({ inputs: [], rest: ['--stage', 'S1'] });
    expect(extractInputFlags([])).toEqual({ inputs: [], rest: [] });
  });
});

describe('parseInputPairs', () => {
  it('splits at the first "=", so a value may contain one', () => {
    expect([...parseInputPairs(['url=https://x/?a=b', 'goal=Simplify billing'])]).toEqual([
      ['url', 'https://x/?a=b'],
      ['goal', 'Simplify billing'],
    ]);
  });

  it('accepts the same input given twice with the same value, and refuses two different values', () => {
    expect([...parseInputPairs(['a=1', 'a=1'])]).toEqual([['a', '1']]);
    const error = refusal(() => parseInputPairs(['a=1', 'a=2']));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('one value');
  });

  it.each([
    ['stageId', 'no "="'],
    ['=x', 'name before'],
    ['stageId=', 'value is empty'],
    ['stageId=   ', 'value is empty'],
    ['1abc=x', 'plain identifier'],
    ['a-b=x', 'plain identifier'],
    ['a.b=x', 'plain identifier'],
    ['a b=x', 'plain identifier'],
    ['item=x', 'reserved'],
    ['stage=x', 'reserved'],
    ['run=x', 'reserved'],
    ['config=x', 'reserved'],
    ['kb=x', 'reserved'],
    ['failures=x', 'reserved'],
    ['vars=x', 'reserved'],
    ['__proto__=x', 'reserved'],
    ['constructor=x', 'reserved'],
  ])('refuses %j (%s)', (pair, why) => {
    const error = refusal(() => parseInputPairs([pair]));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain(why);
    expect(error.remedy).toContain('--input <name>=<value>');
  });

  it('never lets a name reach the prototype of the object it is stored on', () => {
    expect(Object.keys(Object.fromEntries(parseInputPairs(['safe_name=1'])))).toEqual([
      'safe_name',
    ]);
  });
});

describe('refusals are one clean line', () => {
  it('strips newlines, carriage returns, bidi controls and escapes from what the user typed', () => {
    const hostile = 'evil\nforge: ok\rX\u202EY\u001b[31m';
    for (const fn of [
      () => parseInputPairs([`bad name=${hostile}`]),
      () => parseInputPairs([hostile]),
      () => {
        assertShellSafe('stageId', hostile, 'wf');
      },
    ]) {
      const error = refusal(fn);
      expect(error.code).toBe('RUN-088');
      expect(/[\n\r\u202E]/u.test(error.message)).toBe(false);
      expect(error.message.includes(String.fromCharCode(27))).toBe(false);
    }
  });
});

describe('coerceInput', () => {
  it('keeps text for string, for an undeclared input, and for a type it does not recognise', () => {
    expect(coerceInput('a', '007', 'string')).toBe('007');
    expect(coerceInput('a', '007', undefined)).toBe('007');
    expect(coerceInput('a', '007', 'artifact-id')).toBe('007');
  });

  it('types number, integer and boolean by the declared type, and only for a plain literal', () => {
    expect(coerceInput('n', '3', 'number')).toBe(3);
    expect(coerceInput('n', '-2.5', 'NUMBER')).toBe(-2.5);
    expect(coerceInput('n', '7', 'integer')).toBe(7);
    expect(coerceInput('b', 'true', 'boolean')).toBe(true);
    expect(coerceInput('b', 'false', 'boolean')).toBe(false);
  });

  it('refuses an integer past the range a number is exact in', () => {
    expect(refusal(() => coerceInput('n', '99999999999999999999', 'integer')).code).toBe('RUN-088');
    expect(coerceInput('n', '9007199254740991', 'integer')).toBe(9007199254740991);
  });

  it.each([
    ['n', '1e3', 'number'],
    ['n', '0x10', 'number'],
    ['n', ' 3', 'number'],
    ['n', '', 'number'],
    ['n', '2.5', 'integer'],
    ['b', 'yes', 'boolean'],
    ['b', 'TRUE', 'boolean'],
    ['b', '1', 'boolean'],
  ])('refuses %s=%j for a declared %s, naming the type', (name, raw, type) => {
    const error = refusal(() => coerceInput(name, raw, type));
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain(`declared ${type}`);
  });
});

describe('referencedRunInputs', () => {
  it('names the bare placeholders a workflow reads, sorted and once each, and not the helper roots', () => {
    const source = `
      run: 'forge plan run-plan {{stageId}} --json {{ stageId }}'
      inputs: ['artifact:Defect({{defectId}})']
      agent: '{{ownerRole}}'
      over: 'stage.stories'
      x: '{{item.id}} {{vars.integration_branch}} {{run.filesExpected}} {{config.a}} {{kb.b}} {{failures.c}}'
      y: '{{ true }} {{not flag}} {{length(items)}} {{a == "literal" && b in c}}'
    `;
    expect(referencedRunInputs(source)).toEqual([
      'a',
      'b',
      'c',
      'defectId',
      'flag',
      'items',
      'ownerRole',
      'stageId',
    ]);
  });

  it('is empty for a workflow with no placeholders', () => {
    expect(referencedRunInputs('id: a\nsteps: []')).toEqual([]);
  });

  it('reads the parsed document, so a placeholder in a comment or a key is not a reference', () => {
    const parsed = { id: 'w', '{{inKey}}': 1, steps: [{ run: 'echo {{real}}' }] };
    expect(referencedRunInputs(parsed)).toEqual(['real']);
    expect(readsRunValues({ produces: '{{run.filesExpected}}' })).toBe(true);
    expect(readsRunValues({ produces: '{{item.files_expected}}', note: 'run.x' })).toBe(false);
  });
});

describe('shellFacingInputs and assertShellSafe', () => {
  const workflow = {
    vars: {
      integration_branch: 'forge/integration/{{stageId}}',
      agent_only: 'x-{{agentOnly}}',
    },
    steps: [
      {
        kind: 'command',
        run: 'forge plan run-plan {{planTarget}} --json {{vars.integration_branch}}',
      },
      {
        kind: 'agent',
        brief: 'b.md',
        inputs: ['artifact:Defect({{defectId}})'],
        agent: '{{ownerRole}}',
      },
      {
        kind: 'parallel',
        steps: [
          {
            kind: 'fanout',
            over: 'stage.stories',
            step: { kind: 'command', run: 'pnpm test -- {{nested}}' },
          },
        ],
      },
    ],
    onComplete: [{ kind: 'command', run: 'echo {{afterwards}}' }],
    onFailure: {
      default: 'escalate',
      escalations: [{ when: 'x', do: { kind: 'command', run: 'notify {{escalated}}' } }],
    },
  };

  it('is the inputs a command step reads, wherever it sits (onComplete, onFailure escalations, nested), and the ones a var a command reads is built from, and not a var only an agent reads', () => {
    expect([...shellFacingInputs(workflow).inputs].sort()).toEqual([
      'afterwards',
      'escalated',
      'nested',
      'planTarget',
      'stageId',
    ]);
  });

  it('says whether --stage, --epic and --story can reach a shell, through {{stage}}, {{vars.epic}} and {{vars.story}}', () => {
    const none = shellFacingInputs({ steps: [{ kind: 'command', run: 'echo {{stageId}}' }] });
    expect([none.stage, none.epic, none.story]).toEqual([false, false, false]);
    const all = shellFacingInputs({
      steps: [
        { kind: 'command', run: 'echo {{stage}}' },
        { kind: 'command', run: 'echo {{ vars.epic }} {{vars.story}}' },
      ],
    });
    expect([all.stage, all.epic, all.story]).toEqual([true, true, true]);
    expect(
      shellFacingInputs({ steps: [{ kind: 'agent', brief: '{{stage}} {{vars.epic}}' }] }).stage,
    ).toBe(false);
  });

  it.each(['stage-1', 'STAGE_1.a', 'a/b/c', 'x:y@z+1,2', 'test/a.test.ts', '1'])(
    'accepts the plain token %j',
    (value) => {
      expect(() => {
        assertShellSafe('stageId', value, 'wf');
      }).not.toThrow();
    },
  );

  it.each([
    'x; touch /tmp/pwned',
    '$(id)',
    '`id`',
    'a b',
    'a&b',
    'a|b',
    'a>b',
    'a<b',
    "a'b",
    'a"b',
    'a\\b',
    'a*b',
    'a\nb',
    '-rf',
    '--help',
    '',
    '#x',
    '~',
    '!x',
  ])('refuses %j as a value bound for a shell', (value) => {
    const error = refusal(() => {
      assertShellSafe('stageId', value, 'wf');
    });
    expect(error.code).toBe('RUN-088');
    expect(error.message).toContain('shell command');
  });
});
