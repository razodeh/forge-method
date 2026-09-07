/**
 * `readKbBodySection`, `sectionLineRange` — `08` §8.3's four fixed body sections.
 *
 * @see specs/08 §8.3
 * @see PLAN-M3.md P7
 * @see PLAN-M3.md P8
 */
import { describe, expect, it } from 'vitest';

import { readKbBodySection, sectionLineRange } from '../../src/schema/body-sections.ts';

const BODY = [
  '## Statement',
  'Work is executed asynchronously.',
  '',
  '## Rationale',
  'See ADR-0011.',
  '',
  '## Implications',
  'Callers must not assume synchronous completion.',
].join('\n');

describe('readKbBodySection', () => {
  it('reads the first section', () => {
    expect(readKbBodySection(BODY, 'statement')).toBe('Work is executed asynchronously.');
  });

  it('reads a middle section, stopping before the next heading', () => {
    expect(readKbBodySection(BODY, 'rationale')).toBe('See ADR-0011.');
  });

  it('reads the last section, running to the end of the body', () => {
    expect(readKbBodySection(BODY, 'implications')).toBe(
      'Callers must not assume synchronous completion.',
    );
  });

  it('returns undefined for a section the body does not have at all', () => {
    expect(readKbBodySection(BODY, 'verification')).toBeUndefined();
  });

  it('tolerates a heading indented up to 3 spaces, per CommonMark', () => {
    const indented = BODY.replace('## Rationale', '  ## Rationale');
    expect(readKbBodySection(indented, 'rationale')).toBe('See ADR-0011.');
  });
});

describe('sectionLineRange', () => {
  it('returns undefined for an empty body', () => {
    expect(sectionLineRange([''], 'statement')).toBeUndefined();
  });

  it('finds the heading line and the content range up to the next heading', () => {
    const lines = BODY.split('\n');
    const range = sectionLineRange(lines, 'statement');
    expect(range).toEqual({ contentStart: 1, contentEnd: 3 });
  });
});
