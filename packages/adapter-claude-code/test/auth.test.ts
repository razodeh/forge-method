/**
 * `probeAuthAvailability` — two independent, real credential facts.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P1
 */
import { describe, expect, it } from 'vitest';

import { probeAuthAvailability } from '../src/auth.ts';
import type { ClaudeCliRunner } from '../src/process.ts';

function fixedRunner(exitCode: number, stdout: string): ClaudeCliRunner {
  return () => Promise.resolve({ exitCode, stdout });
}

describe('probeAuthAvailability — fixture-driven branch coverage', () => {
  it('apiKey is true when ANTHROPIC_API_KEY is present, regardless of the (fixture) subscription answer', async () => {
    const result = await probeAuthAvailability(
      { ANTHROPIC_API_KEY: 'sk-ant-fixture' },
      fixedRunner(0, JSON.stringify({ loggedIn: false })),
    );
    expect(result.apiKey).toBe(true);
    expect(result.subscription).toBe(false);
  });

  it('apiKey is false when ANTHROPIC_API_KEY is absent or empty', async () => {
    const emptyResult = await probeAuthAvailability(
      { ANTHROPIC_API_KEY: '' },
      fixedRunner(0, '{}'),
    );
    expect(emptyResult.apiKey).toBe(false);
    const absentResult = await probeAuthAvailability({}, fixedRunner(0, '{}'));
    expect(absentResult.apiKey).toBe(false);
  });

  it('subscription is true only when the real loggedIn field is exactly true', async () => {
    const result = await probeAuthAvailability(
      {},
      fixedRunner(0, JSON.stringify({ loggedIn: true })),
    );
    expect(result.subscription).toBe(true);
  });

  it('subscription is false when loggedIn is any other value, including a truthy non-boolean', async () => {
    const stringy = await probeAuthAvailability(
      {},
      fixedRunner(0, JSON.stringify({ loggedIn: 'true' })),
    );
    expect(stringy.subscription).toBe(false);
    const falseValue = await probeAuthAvailability(
      {},
      fixedRunner(0, JSON.stringify({ loggedIn: false })),
    );
    expect(falseValue.subscription).toBe(false);
  });

  it('subscription is false, never thrown, when the command exits non-zero', async () => {
    const result = await probeAuthAvailability({}, fixedRunner(1, ''));
    expect(result.subscription).toBe(false);
  });

  it('subscription is false, never thrown, when stdout is not valid JSON', async () => {
    const result = await probeAuthAvailability({}, fixedRunner(0, 'not json'));
    expect(result.subscription).toBe(false);
  });

  it('subscription is false, never thrown, for valid JSON that parses to a non-object (null, an array, a bare number)', async () => {
    // A fresh critic round found the code's own real defensiveness here (`typeof parsed === 'object'
    // && parsed !== null`) had no test actually exercising it -- only a syntactically-invalid string
    // was tested, which never reaches that check at all (JSON.parse itself throws first).
    for (const stdout of ['null', '[1,2,3]', '42', '"a bare string"']) {
      const result = await probeAuthAvailability({}, fixedRunner(0, stdout));
      expect(result.subscription).toBe(false);
    }
  });

  it('never reads or returns email/orgId/orgName, even when the real command output carries them', async () => {
    const result = await probeAuthAvailability(
      {},
      fixedRunner(
        0,
        JSON.stringify({
          loggedIn: true,
          email: 'someone@example.com',
          orgId: 'org-1',
          orgName: 'Someone Org',
        }),
      ),
    );
    expect(result).toEqual({ apiKey: false, subscription: true });
    expect(Object.keys(result)).toEqual(['apiKey', 'subscription']);
  });
});

describe('probeAuthAvailability — real environment integration', () => {
  it('probes the real, installed claude CLI in this environment honestly (never throws, real booleans)', async () => {
    const result = await probeAuthAvailability(process.env);
    expect(typeof result.apiKey).toBe('boolean');
    expect(typeof result.subscription).toBe('boolean');
  });
});
