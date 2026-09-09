/**
 * `compareVersions` — real `major.minor.patch` comparison.
 */
import { describe, expect, it } from 'vitest';

import { compareVersions } from '../../../src/commands/upgrade/version.ts';

describe('compareVersions', () => {
  it('is 0 for two identical real versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('is 1 when the major component is newer', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('is -1 when the major component is older', () => {
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
  });

  it('compares minor when major is tied', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersions('1.2.9', '1.3.0')).toBe(-1);
  });

  it('compares patch when major and minor are tied', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });

  it('is 0, not a throw, for an unparseable version on either side', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', 'not-a-version')).toBe(0);
  });
});
