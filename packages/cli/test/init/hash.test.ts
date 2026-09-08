import { describe, expect, it } from 'vitest';

import { sha256 } from '../../src/init/hash.ts';

describe('sha256', () => {
  it('is deterministic for identical content', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('differs for different content', () => {
    expect(sha256('hello')).not.toBe(sha256('goodbye'));
  });

  it('matches a known real sha256 digest', () => {
    expect(sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
