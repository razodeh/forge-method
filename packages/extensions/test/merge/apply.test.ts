/**
 * `applyOverlay` — `15` §15.2's merge semantics.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P1
 */
import { isForgeError } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { applyOverlay } from '../../src/merge/apply.ts';

describe('applyOverlay — scalars and objects (JSON-Merge-Patch)', () => {
  it('replaces a scalar field', () => {
    expect(applyOverlay({ tier: 'fast' }, { tier: 'balanced' })).toEqual({ tier: 'balanced' });
  });

  it('recursively merges nested objects, keeping untouched sibling fields', () => {
    const base = { model: { tier: 'fast', thinking: false }, persona: { voice: 'formal' } };
    const overlay = { model: { tier: 'balanced' } };
    expect(applyOverlay(base, overlay)).toEqual({
      model: { tier: 'balanced', thinking: false },
      persona: { voice: 'formal' },
    });
  });

  it('adds a field the base does not have', () => {
    expect(applyOverlay({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('merges a nested object overlay into a base field that does not exist yet', () => {
    expect(applyOverlay({}, { model: { tier: 'balanced' } })).toEqual({
      model: { tier: 'balanced' },
    });
  });

  it('merges a nested object overlay into a base field whose current value is not an object', () => {
    expect(applyOverlay({ model: 'legacy-string-value' }, { model: { tier: 'balanced' } })).toEqual(
      {
        model: { tier: 'balanced' },
      },
    );
  });

  it('deletes a field when the overlay sets it to null (RFC 7386)', () => {
    expect(applyOverlay({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  it('does not mutate the base object', () => {
    const base = { model: { tier: 'fast' } };
    applyOverlay(base, { model: { tier: 'balanced' } });
    expect(base).toEqual({ model: { tier: 'fast' } });
  });
});

describe('applyOverlay — array operators', () => {
  it('$set replaces the whole array', () => {
    expect(applyOverlay({ hosts: ['a', 'b'] }, { hosts: { $set: ['c'] } })).toEqual({
      hosts: ['c'],
    });
  });

  it('$append adds to the end without disturbing existing order', () => {
    expect(
      applyOverlay({ exec: ['git *'] }, { exec: { $append: ['./gradlew *', 'internal-cli *'] } }),
    ).toEqual({
      exec: ['git *', './gradlew *', 'internal-cli *'],
    });
  });

  it('$prepend adds to the start without disturbing existing order', () => {
    expect(applyOverlay({ exec: ['git *'] }, { exec: { $prepend: ['pnpm *'] } })).toEqual({
      exec: ['pnpm *', 'git *'],
    });
  });

  it('$remove removes by plain value', () => {
    expect(applyOverlay({ skills: ['a', 'b', 'c'] }, { skills: { $remove: ['b'] } })).toEqual({
      skills: ['a', 'c'],
    });
  });

  it('$remove removes objects by id', () => {
    const base = { steps: [{ id: 'red' }, { id: 'green' }, { id: 'review' }] };
    expect(applyOverlay(base, { steps: { $remove: ['green'] } })).toEqual({
      steps: [{ id: 'red' }, { id: 'review' }],
    });
  });

  it('$replaceWhere matches on id and merges the matched element, leaving others untouched', () => {
    const base = {
      perspectives: [
        { id: 'security', weight: 1 },
        { id: 'perf', weight: 1 },
      ],
    };
    const overlay = { perspectives: { $replaceWhere: [{ id: 'security', weight: 2 }] } };
    expect(applyOverlay(base, overlay)).toEqual({
      perspectives: [
        { id: 'security', weight: 2 },
        { id: 'perf', weight: 1 },
      ],
    });
  });

  it('$replaceWhere is a no-op for an id that does not match anything', () => {
    const base = { perspectives: [{ id: 'security', weight: 1 }] };
    const overlay = { perspectives: { $replaceWhere: [{ id: 'nonexistent', weight: 2 }] } };
    expect(applyOverlay(base, overlay)).toEqual(base);
  });

  it('$replaceWhere leaves a non-object item, and an object with no id, untouched', () => {
    const base = {
      perspectives: ['a plain string', { noId: true }, { id: 'security', weight: 1 }],
    };
    const overlay = { perspectives: { $replaceWhere: [{ id: 'security', weight: 2 }] } };
    expect(applyOverlay(base, overlay)).toEqual({
      perspectives: ['a plain string', { noId: true }, { id: 'security', weight: 2 }],
    });
  });

  it('applies an array operator to a field the base does not have yet, treating it as empty', () => {
    expect(applyOverlay({}, { skills: { $append: ['acme-java-standards'] } })).toEqual({
      skills: ['acme-java-standards'],
    });
  });

  it('applies an array operator to a field whose base value is not an array, treating it as empty', () => {
    expect(applyOverlay({ skills: 'not-an-array' }, { skills: { $append: ['a'] } })).toEqual({
      skills: ['a'],
    });
  });

  it('$clear empties the array regardless of its current contents', () => {
    expect(applyOverlay({ scope_out: ['a', 'b', 'c'] }, { scope_out: { $clear: true } })).toEqual({
      scope_out: [],
    });
  });

  it('composes multiple operators on the same array, in the fixed order', () => {
    // 15 §15.2's own worked example: allowlistHosts uses $set alone, but skills combines $append
    // and $remove in one overlay document — reproduced here on one field to prove ordering.
    const base = { skills: ['generic-node-conventions', 'acme-observability'] };
    const overlay = {
      skills: { $append: ['acme-java-standards'], $remove: ['generic-node-conventions'] },
    };
    expect(applyOverlay(base, overlay)).toEqual({
      skills: ['acme-observability', 'acme-java-standards'],
    });
  });

  it("composes every distinct field's own operator in one overlay document, 15 §15.2's full example", () => {
    const base = {
      tools: { exec: ['git *'], network: 'none', allowlistHosts: [] },
      skills: ['generic-node-conventions', 'acme-observability'],
    };
    const overlay = {
      tools: {
        exec: { $append: ['./gradlew *', 'internal-cli *'] },
        network: 'allowlist',
        allowlistHosts: { $set: ['artifactory.internal', 'registry.npmjs.org'] },
      },
      skills: { $append: ['acme-java-standards'], $remove: ['generic-node-conventions'] },
    };
    expect(applyOverlay(base, overlay)).toEqual({
      tools: {
        exec: ['git *', './gradlew *', 'internal-cli *'],
        network: 'allowlist',
        allowlistHosts: ['artifactory.internal', 'registry.npmjs.org'],
      },
      skills: ['acme-observability', 'acme-java-standards'],
    });
  });
});

describe('applyOverlay — refusals (CFG-011)', () => {
  it('refuses an unrecognised operator key rather than silently dropping or applying it', () => {
    expect(() => applyOverlay({ hosts: [] }, { hosts: { $appand: ['x'] } })).toThrow(
      /Invalid overlay at \$\.hosts: unrecognised operator \$appand/,
    );
  });

  it('refuses a bare array overlay value with no operator, rather than silently replacing', () => {
    expect(() => applyOverlay({ hosts: ['a'] }, { hosts: ['b'] })).toThrow(
      /a bare array needs an explicit operator/,
    );
  });

  it('refuses $set given a non-array value', () => {
    expect(() => applyOverlay({ hosts: [] }, { hosts: { $set: 'not-an-array' } })).toThrow(
      /\$set needs an array value/,
    );
  });

  it('refuses $append given a non-array value', () => {
    expect(() => applyOverlay({ hosts: [] }, { hosts: { $append: 'not-an-array' } })).toThrow(
      /\$append needs an array value/,
    );
  });

  it('refuses $prepend given a non-array value', () => {
    expect(() => applyOverlay({ hosts: [] }, { hosts: { $prepend: 'not-an-array' } })).toThrow(
      /\$prepend needs an array value/,
    );
  });

  it('refuses $remove given a non-array value', () => {
    expect(() => applyOverlay({ hosts: [] }, { hosts: { $remove: 'not-an-array' } })).toThrow(
      /\$remove needs an array of values or ids/,
    );
  });

  it('refuses $replaceWhere given a non-array value', () => {
    expect(() => applyOverlay({ hosts: [] }, { hosts: { $replaceWhere: 'not-an-array' } })).toThrow(
      /\$replaceWhere needs an array of objects/,
    );
  });

  it('refuses $append_guidance given a non-string value', () => {
    expect(() => applyOverlay({ briefs: {} }, { briefs: { $append_guidance: 42 } })).toThrow(
      /\$append_guidance needs a string/,
    );
  });

  it('refuses a plain (non-operator) object overlaying an array base, rather than discarding the array', () => {
    expect(() =>
      applyOverlay({ skills: ['a', 'b'] }, { skills: { description: 'my skills' } }),
    ).toThrow(/a plain object cannot overlay an array/);
  });

  it('refuses a scalar overlaying an array base, rather than discarding the array', () => {
    expect(() => applyOverlay({ hosts: ['a', 'b'] }, { hosts: 'oops' })).toThrow(
      /a scalar cannot overlay an array/,
    );
  });

  it('is a real ForgeError with code CFG-011 and an actionable remedy', () => {
    try {
      applyOverlay({ hosts: [] }, { hosts: { $appand: ['x'] } });
      expect.unreachable('applyOverlay should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-011');
        expect(error.remedy.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('applyOverlay — $append_guidance', () => {
  it('appends the guidance to every sibling string field, after they are otherwise merged', () => {
    const base = { briefs: { 'implement-story': 'Do the thing.' } };
    const overlay = {
      briefs: {
        'implement-story': 'Do the thing, our way.',
        $append_guidance: 'Always cite the ADR that governs this area.',
      },
    };
    expect(applyOverlay(base, overlay)).toEqual({
      briefs: {
        'implement-story': 'Do the thing, our way.\n\nAlways cite the ADR that governs this area.',
      },
    });
  });

  it('applies to every string field already present from the base, not only overlay-supplied ones', () => {
    const base = { briefs: { a: 'A.', b: 'B.' } };
    const overlay = { briefs: { $append_guidance: 'G.' } };
    expect(applyOverlay(base, overlay)).toEqual({
      briefs: { a: 'A.\n\nG.', b: 'B.\n\nG.' },
    });
  });

  it('is not itself left behind as a literal field in the merged result', () => {
    const result = applyOverlay(
      { briefs: { a: 'A.' } },
      { briefs: { $append_guidance: 'G.' } },
    ) as {
      briefs: Record<string, unknown>;
    };
    expect(Object.keys(result.briefs)).not.toContain('$append_guidance');
  });

  it('refuses $append_guidance in an object that mixes strings with other types, rather than guessing which strings are prose', () => {
    // Reproduces the exact shape 15 §15.2 itself shows two fields apart: `network: 'allowlist'` is a
    // structured enum value, not prose — appending guidance to it would silently corrupt it.
    const base = { tools: { exec: ['git *'], network: 'allowlist' } };
    const overlay = { tools: { $append_guidance: 'Never touch prod without a ticket.' } };
    expect(() => applyOverlay(base, overlay)).toThrow(
      /every field alongside \$append_guidance must be a string, but exec is not/,
    );
  });

  it('refuses $append_guidance in an object mixing strings and numbers', () => {
    const base = { briefs: { count: 3, text: 'T.' } };
    const overlay = { briefs: { $append_guidance: 'G.' } };
    expect(() => applyOverlay(base, overlay)).toThrow(/count is not/);
  });
});

describe('applyOverlay — top-level overlay/base shapes', () => {
  it('returns base unchanged when the top-level overlay is null', () => {
    const base = { a: 1 };
    expect(applyOverlay(base, null)).toBe(base);
  });

  it('returns a non-object, non-null top-level overlay verbatim, replacing the base entirely', () => {
    expect(applyOverlay({ a: 1 }, 'not-an-object')).toBe('not-an-object');
  });

  it('treats a non-object top-level base as absent, merging the overlay into an empty document', () => {
    expect(applyOverlay(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('applyOverlay — determinism (QUALITY-BAR.md R10)', () => {
  it('is a pure function: repeated calls with equivalent input in different key order agree', () => {
    const base = { a: 1, b: 2, model: { tier: 'fast', thinking: true } };
    const overlayA = { model: { tier: 'balanced' }, b: 3 };
    const overlayB = { b: 3, model: { tier: 'balanced' } };
    expect(applyOverlay(base, overlayA)).toEqual(applyOverlay(base, overlayB));
  });
});
