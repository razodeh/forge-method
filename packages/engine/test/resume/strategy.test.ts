/**
 * `decideResumeStrategy` — `PLAN-M5.md` P19's own Checks text: session-resume capability present and a
 * remembered session id both required for `'resume-session'`, `'reroll'` otherwise.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import type { AdapterCapabilities } from '@forge/adapter-kit';
import { describe, expect, it } from 'vitest';

import { decideResumeStrategy } from '../../src/resume/strategy.ts';

function capabilities(overrides: Partial<AdapterCapabilities> = {}): AdapterCapabilities {
  return {
    streaming: true,
    partialText: true,
    sessionResume: true,
    interject: false,
    structuredOutput: true,
    toolAllowlist: true,
    permissionModes: ['auto'],
    subagents: false,
    mcp: false,
    costReporting: 'per-turn',
    tokenReporting: true,
    maxConcurrentSessions: 1,
    cwdIsolation: true,
    systemPromptControl: 'replace',
    fileEditing: true,
    bash: true,
    network: 'full',
    bareMode: true,
    skills: 'none',
    toolProxy: false,
    turnLimitEnforcement: true,
    ...overrides,
  };
}

describe('decideResumeStrategy', () => {
  it('resumes when the adapter supports session resume and a session id is remembered', () => {
    expect(decideResumeStrategy('session-1', capabilities({ sessionResume: true }))).toBe(
      'resume-session',
    );
  });

  it('rerolls when the adapter does not support session resume, even with a remembered session id', () => {
    expect(decideResumeStrategy('session-1', capabilities({ sessionResume: false }))).toBe(
      'reroll',
    );
  });

  it('rerolls when no session id was ever remembered, even when the adapter supports resume', () => {
    expect(decideResumeStrategy(undefined, capabilities({ sessionResume: true }))).toBe('reroll');
  });

  it('rerolls when neither condition holds', () => {
    expect(decideResumeStrategy(undefined, capabilities({ sessionResume: false }))).toBe('reroll');
  });
});
