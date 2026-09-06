/**
 * `Resolver` — `15` §15.2's five-layer resolution model.
 *
 * @see specs/15 §15.2
 * @see PLAN-M2.md P2
 */
import { isForgeError } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { Resolver, explainField } from '../../src/resolve/resolve.ts';
import type { LayerContribution } from '../../src/resolve/types.ts';

function contribution(
  layer: LayerContribution['layer'],
  source: string,
  document: unknown,
): LayerContribution {
  return { layer, source, document };
}

describe('Resolver.resolve — deepest wins', () => {
  it('an L3 project override beats every L1 module and L0 default for the same field', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin/backend.agent.yaml', { model: { tier: 'fast' } }),
      contribution('L1', 'modules/fm-service/backend.agent.yaml', { model: { tier: 'balanced' } }),
      contribution('L3', '.forge/overrides/agents/backend.agent.yaml', {
        model: { tier: 'strong' },
      }),
    ]);
    expect(result.value).toEqual({ model: { tier: 'strong' } });
  });

  it('an L4 personal override beats L3', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L3', '.forge/overrides/agents/backend.agent.yaml', {
        model: { tier: 'strong' },
      }),
      contribution('L4', '.forge/overrides.local/agents/backend.agent.yaml', {
        model: { tier: 'fast' },
      }),
    ]);
    expect(result.value).toEqual({ model: { tier: 'fast' } });
  });

  it('applies layers in L0..L4 order regardless of the input array order', () => {
    const resolver = new Resolver();
    const inOrder = resolver.resolve('backend', [
      contribution('L0', 'a', { model: { tier: 'fast' } }),
      contribution('L3', 'b', { model: { tier: 'strong' } }),
    ]);
    const reversed = resolver.resolve('backend', [
      contribution('L3', 'b', { model: { tier: 'strong' } }),
      contribution('L0', 'a', { model: { tier: 'fast' } }),
    ]);
    expect(inOrder.value).toEqual(reversed.value);
    expect(inOrder.value).toEqual({ model: { tier: 'strong' } });
  });

  it('untouched fields from an earlier layer survive later layers', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'a', { model: { tier: 'fast' }, persona: { voice: 'formal' } }),
      contribution('L3', 'b', { model: { tier: 'strong' } }),
    ]);
    expect(result.value).toEqual({ model: { tier: 'strong' }, persona: { voice: 'formal' } });
  });
});

describe('Resolver.resolve — $extends', () => {
  it("omitted $extends resolves against the contribution's own id (the default)", () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'a', { model: { tier: 'fast' } }),
      contribution('L3', 'b', { $extends: 'backend', model: { tier: 'strong' } }),
    ]);
    expect(result.value).toEqual({ model: { tier: 'strong' } });
  });

  it('an explicit $extends naming a different id starts from the caller-supplied extendedBase', () => {
    const resolver = new Resolver();
    const result = resolver.resolve(
      'sap-integrator',
      [
        contribution('L3', '.forge/overrides/agents/sap-integrator.agent.yaml', {
          $extends: 'backend',
          persona: { voice: 'terse' },
        }),
      ],
      { extendedBase: { model: { tier: 'balanced' }, persona: { voice: 'formal' } } },
    );
    expect(result.value).toEqual({ model: { tier: 'balanced' }, persona: { voice: 'terse' } });
  });

  it('$extends is never left behind as a literal field in the resolved value', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L3', 'b', { $extends: 'backend', model: { tier: 'strong' } }),
    ]) as { value: Record<string, unknown> };
    expect(Object.keys(result.value)).not.toContain('$extends');
  });

  it('$description is stripped as a per-document directive, never merged as a field', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L3', 'b', { $description: 'Our house style', model: { tier: 'strong' } }),
    ]) as { value: Record<string, unknown> };
    expect(result.value).toEqual({ model: { tier: 'strong' } });
  });

  it('refuses a non-string $extends', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('backend', [contribution('L3', 'b', { $extends: 42, model: {} })]),
    ).toThrow(/\$extends needs a string/);
  });

  it('refuses a contribution whose document is not a plain object', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('backend', [contribution('L3', 'b', ['not', 'an', 'object'])]),
    ).toThrow(/an overlay document must be a plain object/);
  });

  it('does not discard content an earlier contribution to the same id already built', () => {
    const resolver = new Resolver();
    const result = resolver.resolve(
      'sap-integrator',
      [
        contribution('L1', 'module', { foo: 'bar' }),
        contribution('L1', 'project-extend', { $extends: 'other', qux: 'baz' }),
      ],
      { extendedBase: { base_field: 'X' } },
    );
    // foo: 'bar' must survive — a later, redundant $extends must not discard prior real content.
    expect(result.value).toEqual({ foo: 'bar', qux: 'baz' });
  });

  it('a second $extends contribution is a no-op on the base once something already exists', () => {
    const resolver = new Resolver();
    const result = resolver.resolve(
      'sap-integrator',
      [
        contribution('L1', 'a', { $extends: 'backend', qux: 'baz' }),
        contribution('L3', 'b', { $extends: 'backend', corge: 'grault' }),
      ],
      { extendedBase: { base_field: 'X' } },
    );
    expect(result.value).toEqual({ base_field: 'X', qux: 'baz', corge: 'grault' });
  });

  it('a genuine $extends still takes effect after a preceding no-op (description-only) contribution', () => {
    const resolver = new Resolver();
    const result = resolver.resolve(
      'sap-integrator',
      [
        contribution('L0', 'stub', { $description: 'placeholder module entry' }),
        contribution('L3', 'project', { $extends: 'backend', extra: 'x' }),
      ],
      { extendedBase: { base_field: 'X' } },
    );
    // The L0 contribution never established any real field, so it must not defeat the later, genuine
    // $extends — base_field must survive alongside extra.
    expect(result.value).toEqual({ base_field: 'X', extra: 'x' });
  });
});

describe('Resolver.resolve — per-field provenance (AC15-2)', () => {
  it('every field of a three-layer resolved object names the layer that actually set it', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', {
        model: { tier: 'fast' },
        persona: { voice: 'formal' },
        limits: { max_cost_usd: 1 },
      }),
      contribution('L1', 'module', { persona: { voice: 'direct' } }),
      contribution('L3', 'project', { model: { tier: 'strong' } }),
    ]);
    expect(explainField(result, ['model', 'tier'])).toBe('L3');
    expect(explainField(result, ['persona', 'voice'])).toBe('L1');
    expect(explainField(result, ['limits', 'max_cost_usd'])).toBe('L0');
  });

  it('a brand-new top-level field at L0 gets its own provenance entry, not one entry for the whole document', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { model: { tier: 'fast' }, persona: { voice: 'formal' } }),
    ]);
    expect(explainField(result, ['model', 'tier'])).toBe('L0');
    expect(explainField(result, ['persona', 'voice'])).toBe('L0');
  });

  it('a field no layer ever touched has no provenance entry', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { model: { tier: 'fast' } }),
    ]);
    expect(explainField(result, ['nonexistent'])).toBeUndefined();
  });

  it('re-setting a field to the same value at a later layer still updates its provenance', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { model: { tier: 'fast' } }),
      contribution('L3', 'project', { model: { tier: 'fast' } }),
    ]);
    // Different object reference even with the same content, so this is a real touch, not a no-op.
    expect(explainField(result, ['model', 'tier'])).toBe('L3');
  });

  it('a layer contribution with no fields beyond $extends/$description touches nothing', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { model: { tier: 'fast' } }),
      contribution('L3', 'project', { $description: 'no-op override' }),
    ]);
    expect(explainField(result, ['model', 'tier'])).toBe('L0');
  });

  it('an array field is one provenance entry, not diffed per index', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { skills: ['a', 'b'] }),
      contribution('L1', 'module', { skills: { $append: ['c'] } }),
    ]);
    expect(explainField(result, ['skills'])).toBe('L1');
  });

  it('$append_guidance itself is not treated as a declared field for provenance purposes', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { briefs: { a: 'A.', b: 'B.' } }),
      contribution('L3', 'project', { briefs: { $append_guidance: 'G.' } }),
    ]);
    // The guidance modified both briefs' *values*, so both are re-attributed to L3 by the value-diff
    // path — but that is `collectChanges`, not `collectDeclaredPaths` treating `$append_guidance`
    // itself as a field with its own provenance entry.
    expect(explainField(result, ['briefs', 'a'])).toBe('L3');
    expect(explainField(result, ['briefs', 'b'])).toBe('L3');
    expect(explainField(result, ['briefs', '$append_guidance'])).toBeUndefined();
  });

  it('deleting a whole subtree clears provenance for its former children, not just the parent', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { persona: { voice: 'formal', tone: 'polite' } }),
      contribution('L3', 'project', { persona: null }),
    ]);
    expect(result.value).toEqual({});
    expect(explainField(result, ['persona'])).toBeUndefined();
    expect(explainField(result, ['persona', 'voice'])).toBeUndefined();
    expect(explainField(result, ['persona', 'tone'])).toBeUndefined();
  });
});

describe('Resolver.resolve — same-layer conflicts (15 §15.2 rule 4)', () => {
  it('two L1 modules touching the same field with different values resolve by install order and warn', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L1', 'modules/fm-service', { model: { tier: 'balanced' } }),
      contribution('L1', 'modules/fm-web', { model: { tier: 'fast' } }),
    ]);
    // Install order (array order) wins: fm-web applied after fm-service.
    expect(result.value).toEqual({ model: { tier: 'fast' } });
    expect(result.warnings).toContainEqual({
      layer: 'L1',
      path: 'model.tier',
      sources: ['modules/fm-service', 'modules/fm-web'],
    });
  });

  it('two L1 modules touching the same field with the SAME value do not warn', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L1', 'modules/fm-service', { model: { tier: 'balanced' } }),
      contribution('L1', 'modules/fm-web', { model: { tier: 'balanced' } }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('does not warn when different layers touch the same field (that is ordinary override, not a conflict)', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L0', 'builtin', { model: { tier: 'fast' } }),
      contribution('L3', 'project', { model: { tier: 'strong' } }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('does not warn when two structurally-identical array values merely have differently-ordered object keys', () => {
    // `steps` is one field for provenance purposes (arrays are never diffed per index), so its whole
    // resulting array is what gets compared — this is where JSON.stringify's key-order sensitivity
    // would otherwise produce a false conflict between two structurally-identical values.
    const resolver = new Resolver();
    const result = resolver.resolve('backend', [
      contribution('L1', 'modules/fm-service', { steps: { $set: [{ id: 'a', weight: 1 }] } }),
      contribution('L1', 'modules/fm-web', { steps: { $set: [{ weight: 1, id: 'a' }] } }),
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe('Resolver.resolve — stale $replaceWhere targets (CFG-012)', () => {
  it('refuses a $replaceWhere entry whose id does not exist in what earlier layers produced', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('build-stage', [
        contribution('L0', 'builtin', { steps: [{ id: 'red' }, { id: 'green' }] }),
        contribution('L3', 'project', {
          steps: { $replaceWhere: [{ id: 'review', perspectives: [] }] },
        }),
      ]),
    ).toThrow(/Overlay target not found.*review/);
  });

  it('allows a $replaceWhere entry whose id does exist', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('build-stage', [
      contribution('L0', 'builtin', { steps: [{ id: 'red' }, { id: 'review' }] }),
      contribution('L3', 'project', {
        steps: { $replaceWhere: [{ id: 'review', perspectives: { $set: ['a11y'] } }] },
      }),
    ]) as { value: { steps: readonly unknown[] } };
    expect(result.value.steps).toEqual([{ id: 'red' }, { id: 'review', perspectives: ['a11y'] }]);
  });

  it('allows $replaceWhere to target an id introduced by $append in the very same directive', () => {
    // applyOverlay's fixed operator order runs $append before $replaceWhere, so this is a legitimate,
    // spec-conformant pattern — not a stale target, even though 'new-step' does not exist in `base`.
    const resolver = new Resolver();
    const result = resolver.resolve('build-stage', [
      contribution('L0', 'builtin', { steps: [{ id: 'red' }] }),
      contribution('L3', 'project', {
        steps: {
          $append: [{ id: 'new-step' }],
          $replaceWhere: [{ id: 'new-step', extra: true }],
        },
      }),
    ]) as { value: { steps: readonly unknown[] } };
    expect(result.value.steps).toEqual([{ id: 'red' }, { id: 'new-step', extra: true }]);
  });

  it('still refuses a $replaceWhere target that $append in the same directive does not actually introduce', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('build-stage', [
        contribution('L0', 'builtin', { steps: [{ id: 'red' }] }),
        contribution('L3', 'project', {
          steps: {
            $append: [{ id: 'new-step' }],
            $replaceWhere: [{ id: 'genuinely-nonexistent' }],
          },
        }),
      ]),
    ).toThrow(/Overlay target not found.*genuinely-nonexistent/);
  });

  it('allows $replaceWhere to target an id introduced by $set in the very same directive', () => {
    const resolver = new Resolver();
    const result = resolver.resolve('build-stage', [
      contribution('L0', 'builtin', { steps: [{ id: 'red' }] }),
      contribution('L3', 'project', {
        steps: {
          $set: [{ id: 'only-step' }],
          $replaceWhere: [{ id: 'only-step', extra: true }],
        },
      }),
    ]) as { value: { steps: readonly unknown[] } };
    expect(result.value.steps).toEqual([{ id: 'only-step', extra: true }]);
  });

  it('$set entries that are not id-bearing objects do not contribute an id to check against', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('build-stage', [
        contribution('L0', 'builtin', { steps: [{ id: 'red' }] }),
        contribution('L3', 'project', {
          steps: {
            $set: ['a plain string entry'],
            $replaceWhere: [{ id: 'nonexistent' }],
          },
        }),
      ]),
    ).toThrow(/Overlay target not found.*nonexistent/);
  });

  it('refuses a $replaceWhere target that $remove, in the same directive, just removed', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('build-stage', [
        contribution('L0', 'builtin', { steps: [{ id: 'red' }, { id: 'green' }] }),
        contribution('L3', 'project', {
          steps: {
            $remove: ['green'],
            $replaceWhere: [{ id: 'green' }],
          },
        }),
      ]),
    ).toThrow(/Overlay target not found.*green/);
  });

  it('$append entries that are not id-bearing objects do not contribute an id to check against', () => {
    const resolver = new Resolver();
    expect(() =>
      resolver.resolve('build-stage', [
        contribution('L0', 'builtin', { steps: [{ id: 'red' }] }),
        contribution('L3', 'project', {
          steps: {
            $append: ['a plain string entry'],
            $replaceWhere: [{ id: 'nonexistent' }],
          },
        }),
      ]),
    ).toThrow(/Overlay target not found.*nonexistent/);
  });

  it('is a real ForgeError with code CFG-012 and an actionable remedy', () => {
    const resolver = new Resolver();
    try {
      resolver.resolve('build-stage', [
        contribution('L3', 'project', { steps: { $replaceWhere: [{ id: 'nonexistent' }] } }),
      ]);
      expect.unreachable('resolve should have thrown');
    } catch (error) {
      expect(isForgeError(error)).toBe(true);
      if (isForgeError(error)) {
        expect(error.code).toBe('CFG-012');
        expect(error.remedy.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Resolver.resolve — determinism (QUALITY-BAR.md R10)', () => {
  it('resolving the same contributions twice produces byte-identical value and provenance', () => {
    const resolver = new Resolver();
    const contributions = [
      contribution('L0', 'a', { model: { tier: 'fast' } }),
      contribution('L1', 'b', { persona: { voice: 'direct' } }),
      contribution('L3', 'c', { model: { tier: 'strong' } }),
    ];
    const first = resolver.resolve('backend', contributions);
    const second = resolver.resolve('backend', contributions);
    expect(second.value).toEqual(first.value);
    expect([...second.provenance.entries()]).toEqual([...first.provenance.entries()]);
    expect(second.warnings).toEqual(first.warnings);
  });
});
