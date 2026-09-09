/**
 * `buildSdkOptions` — `07` §7.3's own mapping table, SDK column.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P3
 */
import { describe, expect, it } from 'vitest';

import { claudeCodeAdapterConfigSchema } from '../../src/config.ts';
import { buildSdkOptions } from '../../src/sdk/build-options.ts';
import { mapToolGrantToAllowedTools } from '../../src/tool-grant.ts';
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

describe('buildSdkOptions', () => {
  it('passes cwd and model verbatim', () => {
    const options = buildSdkOptions(
      baseRequest({ cwd: '/tmp/some-lane', model: 'claude-fable-5-1' }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.cwd).toBe('/tmp/some-lane');
    expect(options.model).toBe('claude-fable-5-1');
  });

  it('reuses the exact same mapToolGrantToAllowedTools function the CLI transport (P2) exports, not a second, potentially-diverging copy', () => {
    const grant: SessionRequest['tools'] = {
      read: false,
      write: false,
      exec: ['pnpm test*'],
      network: 'none',
    };
    const options = buildSdkOptions(
      baseRequest({ tools: grant }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.allowedTools).toEqual([...mapToolGrantToAllowedTools(grant)]);
  });

  it.each([
    ['deny-unlisted', 'dontAsk'],
    ['accept-edits', 'acceptEdits'],
    ['auto', 'auto'],
    ['manual', 'default'],
  ] as const)(
    'maps permissionMode %s to the real SDK PermissionMode value %s',
    (mode, expected) => {
      const options = buildSdkOptions(
        baseRequest({ permissionMode: mode }),
        claudeCodeAdapterConfigSchema.parse({}),
      );
      expect(options.permissionMode).toBe(expected);
    },
  );

  it('always sets includePartialMessages: true', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.includePartialMessages).toBe(true);
  });

  it('sets settingSources: [] (real SDK isolation mode) when config.bare is true', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({ bare: true }),
    );
    expect(options.settingSources).toEqual([]);
  });

  it('omits settingSources entirely when config.bare is false (real SDK default: all sources load)', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({ bare: false }),
    );
    expect(options.settingSources).toBeUndefined();
  });

  it("systemPrompt.mode 'append' maps to the real preset-append form", () => {
    const options = buildSdkOptions(
      baseRequest({ systemPrompt: { mode: 'append', text: 'extra context' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'extra context',
    });
  });

  it("systemPrompt.mode 'replace' maps to a bare custom-string prompt", () => {
    const options = buildSdkOptions(
      baseRequest({ systemPrompt: { mode: 'replace', text: 'full replacement' } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.systemPrompt).toBe('full replacement');
  });

  it('sets maxTurns from limits.maxTurns when present -- unlike the CLI transport, the SDK genuinely supports this natively', () => {
    const options = buildSdkOptions(
      baseRequest({ limits: { maxTurns: 5 } }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.maxTurns).toBe(5);
  });

  it('omits maxTurns entirely when limits.maxTurns is absent', () => {
    const options = buildSdkOptions(
      baseRequest({ limits: {} }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.maxTurns).toBeUndefined();
  });

  it('sets outputFormat to the real json_schema shape when outputSchema is set', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const options = buildSdkOptions(
      baseRequest({ outputSchema: schema }),
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(options.outputFormat).toEqual({ type: 'json_schema', schema });
  });

  it('omits outputFormat entirely when outputSchema is absent', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.outputFormat).toBeUndefined();
  });

  it('sets resume to the given resumeSessionId (P4)', () => {
    const options = buildSdkOptions(
      baseRequest(),
      claudeCodeAdapterConfigSchema.parse({}),
      'session-abc',
    );
    expect(options.resume).toBe('session-abc');
  });

  it('omits resume entirely for a fresh (non-resumed) session', () => {
    const options = buildSdkOptions(baseRequest(), claudeCodeAdapterConfigSchema.parse({}));
    expect(options.resume).toBeUndefined();
  });
});
