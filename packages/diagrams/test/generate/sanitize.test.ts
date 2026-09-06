/**
 * `buildSanitizedIdMap` — collision- and reserved-word-safe Mermaid identifiers.
 *
 * @see SPEC-QUESTIONS.md Q46
 * @see PLAN-M3.md P3
 */
import { buildSanitizedIdMap } from '@forge/diagrams';
import { describe, expect, it } from 'vitest';

describe('buildSanitizedIdMap', () => {
  it('gives two ids that sanitize to the same character-level result distinct identifiers', () => {
    const idFor = buildSanitizedIdMap(['component-api', 'component_api']);
    const a = idFor('component-api');
    const b = idFor('component_api');
    expect(a).not.toBe(b);
    expect(new Set([a, b]).size).toBe(2);
  });

  it('picks the collision winner by sorted id order, deterministically regardless of input order', () => {
    const forward = buildSanitizedIdMap(['component-api', 'component_api']);
    const reversed = buildSanitizedIdMap(['component_api', 'component-api']);
    expect(forward('component-api')).toBe(reversed('component-api'));
    expect(forward('component_api')).toBe(reversed('component_api'));
    // The alphabetically-first raw id ("component-api" < "component_api", '-' < '_' in ASCII) keeps
    // the plain sanitized form; the second claimant gets a numbered suffix.
    expect(forward('component-api')).toBe('component_api');
    expect(forward('component_api')).toBe('component_api_2');
  });

  it('prefixes an id that sanitizes to a reserved Mermaid word', () => {
    expect(buildSanitizedIdMap(['end'])('end')).toBe('n_end');
  });

  it('is case-insensitive when detecting a reserved word', () => {
    expect(buildSanitizedIdMap(['END'])('END')).toBe('n_END');
  });

  it('prefixes an id that sanitizes to the empty string', () => {
    expect(buildSanitizedIdMap([''])('')).toBe('n_');
  });

  it('gives every distinct id in a larger set its own identifier, with no unintended collisions', () => {
    const ids = ['A', 'B', 'component-x', 'component_x', 'end', 'Component-x'];
    const idFor = buildSanitizedIdMap(ids);
    const values = ids.map((id) => idFor(id));
    expect(new Set(values).size).toBe(ids.length);
  });

  it('is a pure function of its input id set', () => {
    const ids = ['x', 'y', 'end'];
    const first = buildSanitizedIdMap(ids);
    const second = buildSanitizedIdMap(ids);
    expect(ids.map((id) => second(id))).toEqual(ids.map((id) => first(id)));
  });

  it('throws a RangeError for an id never passed to buildSanitizedIdMap', () => {
    const idFor = buildSanitizedIdMap(['known']);
    expect(() => idFor('unknown')).toThrow(RangeError);
  });
});
