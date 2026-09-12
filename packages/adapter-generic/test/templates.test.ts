/**
 * `templates.ts` proven directly: `07` §7.5's own worked-example template vocabulary
 * (`{{promptFile}}`/`{{cwd}}`/`{{model}}`/`{{limits.maxTurns}}`), the two `when.if` shapes
 * (`"tools.write == false"`, `"limits.maxTurns"`), and `events.map[].emit`'s own dot-prefixed
 * vocabulary (`{{.content}}`, `{{.tool}}`, `{{.args}}`), including type preservation for a
 * whole-string token.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { describe, expect, it } from 'vitest';

import {
  buildInvokeArgs,
  buildInvokeTemplateVars,
  evaluateWhenCondition,
  resolveEmitTemplate,
  resolveEmitValue,
  resolveInvokeTemplate,
  type InvokeTemplateVars,
} from '../src/templates.ts';

const BASE_VARS: InvokeTemplateVars = {
  promptFile: '/tmp/prompt.txt',
  outFile: '/tmp/out.txt',
  cwd: '/work/lane',
  model: 'claude-x',
  permissionMode: 'auto',
  tools: { read: true, write: false, network: 'none' },
  limits: { maxTurns: 3, wallClockMs: undefined, maxCostUsd: undefined },
};

describe('resolveInvokeTemplate', () => {
  it('resolves every worked-example bare token', () => {
    expect(resolveInvokeTemplate('--prompt-file', BASE_VARS)).toBe('--prompt-file');
    expect(resolveInvokeTemplate('{{promptFile}}', BASE_VARS)).toBe('/tmp/prompt.txt');
    expect(resolveInvokeTemplate('{{cwd}}', BASE_VARS)).toBe('/work/lane');
    expect(resolveInvokeTemplate('{{model}}', BASE_VARS)).toBe('claude-x');
    expect(resolveInvokeTemplate('{{limits.maxTurns}}', BASE_VARS)).toBe('3');
  });

  it('substitutes the empty string for an absent field, never the literal "undefined"', () => {
    expect(resolveInvokeTemplate('{{limits.wallClockMs}}', BASE_VARS)).toBe('');
    expect(resolveInvokeTemplate('{{no.such.path}}', BASE_VARS)).toBe('');
  });

  it('resolves multiple tokens embedded in one string', () => {
    expect(resolveInvokeTemplate('{{model}}@{{cwd}}', BASE_VARS)).toBe('claude-x@/work/lane');
  });

  it("resolves {{outFile}}, result.finalTextFrom: file:{{outFile}}'s own template token", () => {
    expect(resolveInvokeTemplate('{{outFile}}', BASE_VARS)).toBe('/tmp/out.txt');
    expect(resolveInvokeTemplate('--out {{outFile}}', BASE_VARS)).toBe('--out /tmp/out.txt');
  });
});

describe("evaluateWhenCondition: 07 §7.5's own two worked shapes", () => {
  it('"tools.write == false" is true exactly when tools.write is false', () => {
    expect(evaluateWhenCondition('tools.write == false', BASE_VARS)).toBe(true);
    expect(
      evaluateWhenCondition('tools.write == false', {
        ...BASE_VARS,
        tools: { ...BASE_VARS.tools, write: true },
      }),
    ).toBe(false);
  });

  it('"limits.maxTurns" is a bare truthiness check', () => {
    expect(evaluateWhenCondition('limits.maxTurns', BASE_VARS)).toBe(true);
    expect(
      evaluateWhenCondition('limits.maxTurns', {
        ...BASE_VARS,
        limits: { ...BASE_VARS.limits, maxTurns: undefined },
      }),
    ).toBe(false);
    expect(
      evaluateWhenCondition('limits.maxTurns', {
        ...BASE_VARS,
        limits: { ...BASE_VARS.limits, maxTurns: 0 },
      }),
    ).toBe(false);
  });

  it('supports string-literal equality too', () => {
    expect(evaluateWhenCondition('model == "claude-x"', BASE_VARS)).toBe(true);
    expect(evaluateWhenCondition("model == 'other'", BASE_VARS)).toBe(false);
  });
});

describe('buildInvokeArgs', () => {
  it('resolves base args then every when-rule whose condition is true, in order', () => {
    const args = buildInvokeArgs(
      {
        args: ['--prompt-file', '{{promptFile}}'],
        when: [
          { if: 'tools.write == false', args: ['--read-only'] },
          { if: 'tools.read == false', args: ['--should-not-appear'] },
          { if: 'limits.maxTurns', args: ['--max-steps', '{{limits.maxTurns}}'] },
        ],
      },
      BASE_VARS,
    );
    expect(args).toEqual(['--prompt-file', '/tmp/prompt.txt', '--read-only', '--max-steps', '3']);
  });

  it('is fine with no when rules at all', () => {
    expect(buildInvokeArgs({ args: ['--cwd', '{{cwd}}'] }, BASE_VARS)).toEqual([
      '--cwd',
      '/work/lane',
    ]);
  });
});

describe('resolveEmitValue: events.map[].emit dot-prefixed vocabulary', () => {
  const rawLine = {
    type: 'tool_call',
    tool: 'exec',
    args: { command: 'echo hi' },
    count: 3,
    ok: true,
  };

  it('preserves the real type for a whole-string single token', () => {
    expect(resolveEmitValue('{{.tool}}', rawLine)).toBe('exec');
    expect(resolveEmitValue('{{.args}}', rawLine)).toEqual({ command: 'echo hi' });
    expect(resolveEmitValue('{{.count}}', rawLine)).toBe(3);
    expect(resolveEmitValue('{{.ok}}', rawLine)).toBe(true);
  });

  it('stringifies a token embedded in a larger string', () => {
    expect(resolveEmitValue('tool={{.tool}}!', rawLine)).toBe('tool=exec!');
  });

  it('passes a plain literal value through unresolved', () => {
    expect(resolveEmitValue('complete', rawLine)).toBe('complete');
    expect(resolveEmitValue(false, rawLine)).toBe(false);
  });

  it('resolves to undefined for a field the raw line does not have', () => {
    expect(resolveEmitValue('{{.missing}}', rawLine)).toBeUndefined();
  });
});

describe('resolveEmitTemplate', () => {
  it("resolves every field of an emit object against one matched line, 07 §7.5's own worked entries", () => {
    const rawLine = { type: 'tool_call', tool: 'write_file', args: { path: 'out.txt' } };
    expect(
      resolveEmitTemplate({ type: 'tool.call', name: '{{.tool}}', input: '{{.args}}' }, rawLine),
    ).toEqual({ type: 'tool.call', name: 'write_file', input: { path: 'out.txt' } });
  });

  it('resolves the message worked-example entry', () => {
    const rawLine = { type: 'message', role: 'assistant', content: 'hi there' };
    expect(resolveEmitTemplate({ type: 'text', text: '{{.content}}' }, rawLine)).toEqual({
      type: 'text',
      text: 'hi there',
    });
  });
});

describe('buildInvokeTemplateVars', () => {
  it('mirrors the real SessionRequest fields the worked example templates against', () => {
    const vars = buildInvokeTemplateVars(
      {
        runId: 'r1',
        stepId: 's1',
        cwd: '/lane',
        systemPrompt: { mode: 'append', text: '' },
        prompt: 'hello',
        model: 'm1',
        tools: { read: true, write: true, exec: false, network: 'none' },
        permissionMode: 'auto',
        limits: { maxTurns: 5 },
        env: {},
        abortSignal: new AbortController().signal,
      },
      '/lane/.forge-scratch/prompt.txt',
      '/lane/.forge-scratch/out.txt',
    );
    expect(vars).toEqual({
      promptFile: '/lane/.forge-scratch/prompt.txt',
      outFile: '/lane/.forge-scratch/out.txt',
      cwd: '/lane',
      model: 'm1',
      permissionMode: 'auto',
      tools: { read: true, write: true, network: 'none' },
      limits: { maxTurns: 5, wallClockMs: undefined, maxCostUsd: undefined },
    });
  });
});
