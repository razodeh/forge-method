/**
 * `genericCapabilities` proven directly against real, schema-valid configs — a round-1 critic finding:
 * `tokenReporting`/`fileEditing` used to be unconditional `true` constants regardless of what a specific
 * `adapter.yaml` actually declared, checkably wrong against `07` §7.5's own worked example (zero
 * `usage`-type `events.map` entries).
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { describe, expect, it } from 'vitest';

import { genericCapabilities } from '../src/capabilities.ts';
import { adapterYamlConfigSchema, type AdapterYamlConfig } from '../src/config/schema.ts';

const BASE_CONFIG_INPUT = {
  id: 'fixture-tool',
  displayName: 'Fixture Tool',
  binary: 'fixture-tool',
  minimumVersion: '1.0.0',
  versionRegex: 'v?(\\d+\\.\\d+\\.\\d+)',
  capabilities: {
    streaming: true,
    sessionResume: false,
    structuredOutput: false,
    toolAllowlist: true,
    cwdIsolation: true,
    costReporting: 'none' as const,
  },
  invoke: { args: ['--prompt-file', '{{promptFile}}'], stdin: 'none' as const },
  events: { format: 'ndjson' as const, map: [] as { match: object; emit: object }[] },
  result: { successExitCodes: [0], finalTextFrom: 'lastAssistantText' },
  files: { changeDetection: 'git-status' as const },
};

function parseConfig(overrides: Record<string, unknown>): AdapterYamlConfig {
  return adapterYamlConfigSchema.parse({ ...BASE_CONFIG_INPUT, ...overrides });
}

describe('genericCapabilities: pass-through fields', () => {
  it('passes streaming/sessionResume/structuredOutput/toolAllowlist/cwdIsolation/costReporting through unchanged', () => {
    const config = parseConfig({
      capabilities: {
        streaming: false,
        sessionResume: true,
        structuredOutput: true,
        toolAllowlist: false,
        cwdIsolation: false,
        costReporting: 'per-turn',
      },
    });
    const capabilities = genericCapabilities(config);
    expect(capabilities.streaming).toBe(false);
    expect(capabilities.sessionResume).toBe(true);
    expect(capabilities.structuredOutput).toBe(true);
    expect(capabilities.toolAllowlist).toBe(false);
    expect(capabilities.cwdIsolation).toBe(false);
    expect(capabilities.costReporting).toBe('per-turn');
  });
});

describe('genericCapabilities: tokenReporting, derived from config, not a fixed constant', () => {
  it("is false for 07 §7.5's own worked example (zero usage-type events.map entries)", () => {
    const config = parseConfig({
      events: {
        format: 'ndjson',
        map: [
          {
            match: { type: 'message', role: 'assistant' },
            emit: { type: 'text', text: '{{.content}}' },
          },
          {
            match: { type: 'tool_call' },
            emit: { type: 'tool.call', name: '{{.tool}}', input: '{{.args}}' },
          },
          { match: { type: 'done' }, emit: { type: 'session.ended', reason: 'complete' } },
        ],
      },
    });
    expect(genericCapabilities(config).tokenReporting).toBe(false);
  });

  it('is true once the config declares a usage-type events.map entry', () => {
    const config = parseConfig({
      events: {
        format: 'ndjson',
        map: [
          {
            match: { type: 'usage' },
            emit: {
              type: 'usage',
              inputTokens: '{{.inputTokens}}',
              outputTokens: '{{.outputTokens}}',
            },
          },
        ],
      },
    });
    expect(genericCapabilities(config).tokenReporting).toBe(true);
  });
});

describe('genericCapabilities: fileEditing, derived from config, not a fixed constant', () => {
  it('is false for a config with no tools.write-conditioned invoke.when rule (a read-only tool)', () => {
    const config = parseConfig({ invoke: { args: ['--cwd', '{{cwd}}'], stdin: 'none' } });
    expect(genericCapabilities(config).fileEditing).toBe(false);
  });

  it("is true once the config declares 07 §7.5's own worked tools.write == false -> --read-only rule", () => {
    const config = parseConfig({
      invoke: {
        args: ['--cwd', '{{cwd}}'],
        when: [{ if: 'tools.write == false', args: ['--read-only'] }],
        stdin: 'none',
      },
    });
    expect(genericCapabilities(config).fileEditing).toBe(true);
  });
});

describe('genericCapabilities: fixed, disclosed generic defaults for fields 07 §7.5 gives no config field for', () => {
  it('reports the documented fixed defaults', () => {
    const capabilities = genericCapabilities(parseConfig({}));
    expect(capabilities.partialText).toBe(false);
    expect(capabilities.interject).toBe(false);
    expect(capabilities.subagents).toBe(false);
    expect(capabilities.mcp).toBe(false);
    expect(capabilities.maxConcurrentSessions).toBe(0);
    expect(capabilities.systemPromptControl).toBe('none');
    expect(capabilities.bash).toBe(true);
    expect(capabilities.network).toBe('none');
    expect(capabilities.bareMode).toBe(false);
    expect(capabilities.skills).toBe('none');
    expect(capabilities.toolProxy).toBe(false);
    expect(capabilities.turnLimitEnforcement).toBe(false);
    expect(capabilities.permissionModes).toEqual([
      'manual',
      'accept-edits',
      'deny-unlisted',
      'auto',
    ]);
  });
});
