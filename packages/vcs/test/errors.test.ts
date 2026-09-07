/**
 * `VcsError` — a real `Error` carrying `code`/`remedy`, with `cause` preserved for later diagnosis.
 *
 * @see PLAN-M5.md P1
 */
import { describe, expect, it } from 'vitest';

import { VcsError } from '../src/errors.ts';

describe('VcsError', () => {
  it('is a real Error carrying code, message and remedy', () => {
    const error = new VcsError({ code: 'VCS-TEST', message: 'something went wrong', remedy: 'do the fix' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('VcsError');
    expect(error.code).toBe('VCS-TEST');
    expect(error.message).toBe('something went wrong');
    expect(error.remedy).toBe('do the fix');
  });

  it('preserves a supplied cause', () => {
    const cause = new Error('root cause');
    const error = new VcsError({ code: 'VCS-TEST', message: 'wrapped', remedy: 'fix it' }, { cause });

    expect(error.cause).toBe(cause);
  });
});
