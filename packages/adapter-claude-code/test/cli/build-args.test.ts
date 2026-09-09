/**
 * `buildCliArgs` — `07` §7.3's own mapping table, CLI column.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P2
 */
import { describe, expect, it } from 'vitest';

import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { buildCliArgs } from '../../src/cli/build-args.ts';
import type { SessionRequest } from '@forge/adapter-kit';

function baseRequest(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    runId: 'run-1',
    stepId: 'implement-story-1',
    cwd: '/tmp/lane',
    systemPrompt: { mode: 'append', text: 'You are a FORGE engineer.' },
    prompt: 'Implement the story.',
    model: 'claude-sonnet-5',
    tools: { read: true, write: true, exec: false, network: 'none' },
    permissionMode: 'accept-edits',
    limits: {},
    env: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('buildCliArgs', () => {
  it('includes -p, --verbose, and a display name from stepId', () => {
    const args = buildCliArgs(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(args).toContain('-p');
    expect(args).toContain('--verbose');
    const nameIndex = args.indexOf('--name');
    expect(args[nameIndex + 1]).toBe('implement-story-1');
  });

  it('defaults to --output-format stream-json --include-partial-messages when no outputSchema is set', () => {
    const args = buildCliArgs(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    const formatIndex = args.indexOf('--output-format');
    expect(args[formatIndex + 1]).toBe('stream-json');
    expect(args).toContain('--include-partial-messages');
  });

  it('switches to --output-format json --json-schema when outputSchema is set, and drops streaming flags', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const args = buildCliArgs(
      baseRequest({ outputSchema: schema }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const formatIndex = args.indexOf('--output-format');
    expect(args[formatIndex + 1]).toBe('json');
    const schemaIndex = args.indexOf('--json-schema');
    expect(JSON.parse(args[schemaIndex + 1] ?? '{}')).toEqual(schema);
    expect(args).not.toContain('--include-partial-messages');
  });

  it('passes --model verbatim', () => {
    const args = buildCliArgs(
      baseRequest({ model: 'claude-fable-5-1' }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const modelIndex = args.indexOf('--model');
    expect(args[modelIndex + 1]).toBe('claude-fable-5-1');
  });

  it.each([
    ['deny-unlisted', 'dontAsk'],
    ['accept-edits', 'acceptEdits'],
    ['auto', 'auto'],
    ['manual', 'manual'],
  ] as const)('maps permissionMode %s to --permission-mode %s', (mode, expected) => {
    const args = buildCliArgs(
      baseRequest({ permissionMode: mode }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const index = args.indexOf('--permission-mode');
    expect(args[index + 1]).toBe(expected);
  });

  it("07 §7.3's own worked example: exec:['pnpm test*'] produces --allowedTools 'Bash(pnpm test*)'", () => {
    const args = buildCliArgs(
      baseRequest({ tools: { read: false, write: false, exec: ['pnpm test*'], network: 'none' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const index = args.indexOf('--allowedTools');
    expect(args[index + 1]).toBe('Bash(pnpm test*)');
  });

  it('always passes --allowedTools explicitly, even for a fully-denied grant (fail closed, never omitted)', () => {
    const args = buildCliArgs(
      baseRequest({ tools: { read: false, write: false, exec: false, network: 'none' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const index = args.indexOf('--allowedTools');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(args[index + 1]).toBe('');
  });

  it("P5's own hardening fix: multiple tool names each become their own separate argv element after --allowedTools, never one joined/re-splittable string", () => {
    // The real, installed CLI's own --help text documents --allowedTools <tools...> as accepting a
    // "comma or space-separated list" -- a single joined value asks Claude Code's own parser to
    // re-split it, real risk this fix avoids entirely by never producing that joined value in the
    // first place. `<tools...>` is commander's own variadic syntax: each of these trailing argv
    // elements belongs to --allowedTools, ending only at the next real flag (--append-system-prompt).
    const args = buildCliArgs(
      baseRequest({
        tools: { read: true, write: true, exec: ['pnpm test*'], network: 'full' },
      }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const index = args.indexOf('--allowedTools');
    expect(args.slice(index + 1, index + 7)).toEqual([
      'Read',
      'Edit',
      'Write',
      'Bash(pnpm test*)',
      'WebFetch',
      'WebSearch',
    ]);
    // The very next argv element genuinely is a different flag, not a seventh tool name -- proves
    // the slice above captured the whole (and only the whole) --allowedTools value.
    expect(args[index + 7]).toBe('--append-system-prompt');
  });

  it("systemPrompt.mode 'append' uses --append-system-prompt", () => {
    const args = buildCliArgs(
      baseRequest({ systemPrompt: { mode: 'append', text: 'extra context' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const index = args.indexOf('--append-system-prompt');
    expect(args[index + 1]).toBe('extra context');
  });

  it("systemPrompt.mode 'replace' uses --system-prompt", () => {
    const args = buildCliArgs(
      baseRequest({ systemPrompt: { mode: 'replace', text: 'full replacement' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    const index = args.indexOf('--system-prompt');
    expect(args[index + 1]).toBe('full replacement');
  });

  it('includes --bare when config.bare is true (the real default)', () => {
    const args = buildCliArgs(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(args).toContain('--bare');
  });

  it('omits --bare when config.bare is explicitly false', () => {
    const args = buildCliArgs(baseRequest(), claudeCodeAdapterConfigSchema.parse({ bare: false }));
    expect(args).not.toContain('--bare');
  });

  it('the prompt is the final, trailing positional argument, preceded by a -- end-of-options guard', () => {
    const args = buildCliArgs(
      baseRequest({ prompt: 'a distinctive real prompt' }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(args.at(-1)).toBe('a distinctive real prompt');
    expect(args.at(-2)).toBe('--');
  });

  it('includes --resume <sessionId> when a resumeSessionId is given (P4)', () => {
    const args = buildCliArgs(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({}),
      'session-abc',
    );
    const index = args.indexOf('--resume');
    expect(args[index + 1]).toBe('session-abc');
  });

  it('omits --resume entirely for a fresh (non-resumed) session', () => {
    const args = buildCliArgs(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(args).not.toContain('--resume');
  });

  it('a prompt beginning with a dash is still passed as literal text, guarded by --, not misread as a flag', () => {
    // A fresh critic round flagged this as a real, if low-severity, risk an earlier draft left
    // unguarded. Not live-verified against the real CLI (see build-args.ts's own doc comment), but
    // this proves the argv shape itself is correct: `--` immediately precedes the dash-prefixed
    // prompt, which is exactly the standard convention that makes it unambiguous to any
    // commander.js-family parser.
    const args = buildCliArgs(
      baseRequest({ prompt: '--not-a-flag' }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('--not-a-flag');
  });
});
