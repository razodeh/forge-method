/**
 * `staticCapabilities`/`confirmedCapabilities` — the pre/post-`session.started` `AdapterCapabilities`
 * pair `ClaudeCodeAdapter.capabilities()` (P4) switches between.
 *
 * @see specs/07 §7.2
 * @see SPEC-QUESTIONS.md Q116
 * @see PLAN-M7.md P4
 */
import { describe, expect, it } from 'vitest';

import { confirmedCapabilities, staticCapabilities } from '../src/capabilities.ts';

describe('staticCapabilities', () => {
  it('conservatively defaults partialText/sessionResume/structuredOutput to false', () => {
    const caps = staticCapabilities(['manual'], 'cli');
    expect(caps.partialText).toBe(false);
    expect(caps.sessionResume).toBe(false);
    expect(caps.structuredOutput).toBe(false);
  });

  it('passes permissionModes through verbatim, as a real (not shared-reference) copy', () => {
    const input = ['manual', 'auto'];
    const caps = staticCapabilities(input, 'cli');
    expect(caps.permissionModes).toEqual(['manual', 'auto']);
    expect(caps.permissionModes).not.toBe(input);
  });

  it('every other field is a fixed, non-degraded value regardless of permissionModes', () => {
    const caps = staticCapabilities([], 'sdk');
    expect(caps.streaming).toBe(true);
    expect(caps.toolAllowlist).toBe(true);
    expect(caps.subagents).toBe(true);
    expect(caps.mcp).toBe(true);
    expect(caps.costReporting).toBe('per-turn');
    expect(caps.tokenReporting).toBe(true);
    expect(caps.cwdIsolation).toBe(true);
    expect(caps.fileEditing).toBe(true);
    expect(caps.bash).toBe(true);
    expect(caps.network).toBe('full');
    expect(caps.bareMode).toBe(true);
    expect(caps.skills).toBe('native');
    expect(caps.toolProxy).toBe(false);
  });

  it('turnLimitEnforcement is true for sdk and false for cli -- a real, live-verified transport asymmetry (SPEC-QUESTIONS.md Q114, Q132), not a remote-environment unknown', () => {
    expect(staticCapabilities([], 'sdk').turnLimitEnforcement).toBe(true);
    expect(staticCapabilities([], 'cli').turnLimitEnforcement).toBe(false);
  });
});

describe('confirmedCapabilities', () => {
  it('flips exactly the two genuinely version-dependent fields to true, changing nothing else', () => {
    const before = staticCapabilities(['manual'], 'cli');
    const after = confirmedCapabilities(['manual'], 'cli');
    expect(after.partialText).toBe(true);
    expect(after.sessionResume).toBe(true);
    expect({ ...after, partialText: false, sessionResume: false }).toEqual(before);
  });

  it('structuredOutput stays false even once confirmed -- this adapter does not deliver it end to end on either transport yet, so confirming a session started must not misreport it as working', () => {
    const caps = confirmedCapabilities(['manual'], 'sdk');
    expect(caps.structuredOutput).toBe(false);
  });

  it('still passes permissionModes through verbatim', () => {
    const caps = confirmedCapabilities(['auto', 'deny-unlisted'], 'cli');
    expect(caps.permissionModes).toEqual(['auto', 'deny-unlisted']);
  });

  it('still reports turnLimitEnforcement per-transport once confirmed', () => {
    expect(confirmedCapabilities([], 'sdk').turnLimitEnforcement).toBe(true);
    expect(confirmedCapabilities([], 'cli').turnLimitEnforcement).toBe(false);
  });
});
