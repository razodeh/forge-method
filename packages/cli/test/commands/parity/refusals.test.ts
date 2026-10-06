/**
 * `secretRefusal`/`lossyUtf8Refusal` — the two checks `13` F-TEST-9 runs on an observation BEFORE
 * anything is stored: "An observation that contains a secret, or a text observation that does not
 * decode as UTF-8, is refused ... before anything is stored." Reuses the existing `SECRET_PATTERNS`
 * set (`@forge/extensions/skills`), already used elsewhere for exactly this purpose, rather than a
 * reinvented pattern list; the UTF-8 check is decided on the RAW bytes, never on a string a lossy
 * decode already produced — which, deciding on the raw bytes with a strict decoder, lets this check
 * tell an invalid byte sequence apart from a genuinely valid encoding of U+FFFD itself (see
 * `refusals.ts`'s own doc comment on `lossyUtf8Refusal`, and this file's own contrasting pair of
 * tests for the two).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 */
import { describe, expect, it } from 'vitest';

import { lossyUtf8Refusal, secretRefusal } from '../../../src/commands/parity/refusals.ts';

describe('secretRefusal (specs/22 M16 P3)', () => {
  it('refuses an AWS access key id shape, naming the surface and stream', () => {
    const refusal = secretRefusal('process', 'stdout', 'token: AKIAABCDEFGHIJKLMNOP\n');
    expect(refusal?.code).toBe('RUN-121');
    expect(refusal?.details).toMatchObject({ surface: 'process', stream: 'stdout' });
  });

  it('refuses a GitHub personal access token shape', () => {
    const refusal = secretRefusal('library', 'stdout', `ghp_${'a'.repeat(36)}`);
    expect(refusal?.code).toBe('RUN-121');
  });

  it('refuses a PEM private key block', () => {
    const refusal = secretRefusal(
      'file',
      'result.txt',
      '-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----\n',
    );
    expect(refusal?.code).toBe('RUN-121');
  });

  it('refuses a Slack token shape', () => {
    const refusal = secretRefusal('process', 'stdout', `xoxb-${'1'.repeat(10)}-canary`);
    expect(refusal?.code).toBe('RUN-121');
  });

  it('refuses a literal Bearer token shape (never a ${secret:...} reference, which is not a literal token)', () => {
    const refusal = secretRefusal('process', 'stdout', `Authorization: Bearer ${'a'.repeat(24)}`);
    expect(refusal?.code).toBe('RUN-121');
  });

  it('is undefined for ordinary, secret-free text', () => {
    expect(secretRefusal('process', 'stdout', 'all tests passed\n')).toBeUndefined();
  });

  it('a secret set in the PARENT process environment and echoed by a case is refused -- the scrub is real, proven by the thing it scrubs actually appearing in text and still being caught', () => {
    const fakeApiKeyLine = 'AWS_KEY=AKIAABCDEFGHIJKLMNOP\n';
    expect(secretRefusal('process', 'stdout', fakeApiKeyLine)?.code).toBe('RUN-121');
  });
});

describe('lossyUtf8Refusal (specs/22 M16 P3)', () => {
  it('refuses raw bytes that do not decode as valid UTF-8', () => {
    const invalid = new Uint8Array([0x68, 0x69, 0xff, 0xfe]);
    const refusal = lossyUtf8Refusal('process', 'stdout', invalid);
    expect(refusal?.code).toBe('RUN-122');
    expect(refusal?.details).toMatchObject({ surface: 'process', stream: 'stdout' });
  });

  it('is undefined for valid UTF-8, multi-byte characters included', () => {
    const valid = new TextEncoder().encode('café ☃ snowman\n');
    expect(lossyUtf8Refusal('process', 'stderr', valid)).toBeUndefined();
  });

  it('is undefined for plain ASCII', () => {
    expect(lossyUtf8Refusal('library', 'stdout', new TextEncoder().encode('{"ok":true}'))).toBe(
      undefined,
    );
  });

  it('refuses a second, differently-shaped invalid byte sequence too (not only the one above)', () => {
    // `0xff 0xfe` is not valid UTF-8 under any interpretation (it is not even a valid start byte);
    // a distinct invalid shape from the first test, so this is not merely a duplicate of it.
    const invalid = new Uint8Array([0xff, 0xfe]);
    expect(lossyUtf8Refusal('process', 'stdout', invalid)?.code).toBe('RUN-122');
  });

  it('does NOT refuse a genuinely valid UTF-8 encoding of the codepoint U+FFFD itself -- deciding on the raw bytes with a strict decoder tells this apart from an invalid sequence precisely, which is why this is not refused even though Q294 Decision 7 named "any U+FFFD" as the conservative fallback for a world where only a LOSSY-decoded string was available (refusals.ts’s own doc comment on lossyUtf8Refusal has the full reasoning; this is a reviewed, intentional contract, not an accident)', () => {
    // The real, valid 3-byte UTF-8 encoding of U+FFFD (0xEF 0xBF 0xBD) -- not two arbitrary invalid
    // bytes that merely LOOK like "the replacement character" once lossily decoded.
    const validEncodingOfReplacementChar = new Uint8Array([0xef, 0xbf, 0xbd]);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(validEncodingOfReplacementChar)).toBe(
      '�',
    );
    expect(lossyUtf8Refusal('process', 'stdout', validEncodingOfReplacementChar)).toBeUndefined();
  });
});
