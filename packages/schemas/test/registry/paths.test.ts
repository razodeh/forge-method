/**
 * `renderArtifactPath` — substituting a registered type's `pathTemplate`.
 *
 * @see specs/18 §18.7
 * @see PLAN-M1.md P5
 * @see SPEC-QUESTIONS.md Q3
 */
import { describe, expect, it } from 'vitest';

import { renderArtifactPath } from '../../src/registry/paths.ts';

describe('renderArtifactPath — success', () => {
  it('substitutes a single {id} placeholder', () => {
    expect(renderArtifactPath('NFR', { id: 'NFR-0002' })).toEqual({
      success: true,
      path: 'specs/nfr/NFR-0002.md',
    });
  });

  it('substitutes {id} and {slug} together', () => {
    const result = renderArtifactPath('Story', { id: 'STORY-014', slug: 'render-invoice-preview' });
    expect(result).toEqual({
      success: true,
      path: 'specs/stories/STORY-014-render-invoice-preview.md',
    });
  });

  it('substitutes an id in the suffixed sub-id form ({id}-{n})', () => {
    // Both the base regex and the per-type check in baseFrontMatterSchema allow a trailing `-\d+`
    // (a sub-id, e.g. a split acceptance criterion); this proves renderArtifactPath treats the whole
    // value as opaque and passes it through rather than only handling the common unsuffixed shape.
    expect(renderArtifactPath('Story', { id: 'STORY-014-2', slug: 'split-part' })).toEqual({
      success: true,
      path: 'specs/stories/STORY-014-2-split-part.md',
    });
  });

  it('substitutes a non-id placeholder name ({name})', () => {
    expect(renderArtifactPath('InterfaceContract', { name: 'invoice-api' })).toEqual({
      success: true,
      path: 'specs/interfaces/invoice-api.yaml',
    });
  });

  it('substitutes two non-id placeholders ({section}, {slug})', () => {
    const result = renderArtifactPath('Diagram', { section: 'specs/epics', slug: 'checkout-flow' });
    expect(result).toEqual({ success: true, path: 'specs/epics/views/checkout-flow.mmd' });
  });

  it('substitutes two differently-named placeholders on the same template ({gate}, {ts})', () => {
    const result = renderArtifactPath('GateReport', { gate: 'g-ready', ts: '20260311T140000Z' });
    expect(result).toEqual({ success: true, path: 'reports/gates/g-ready-20260311T140000Z.md' });
  });

  it('renders a template with no placeholders at all, ignoring extra vars', () => {
    expect(renderArtifactPath('Risk', { unused: 'ignored' })).toEqual({
      success: true,
      path: 'kb/risks.md',
    });
  });

  it('ignores vars the template does not reference', () => {
    expect(renderArtifactPath('NFR', { id: 'NFR-0002', slug: 'unused' })).toEqual({
      success: true,
      path: 'specs/nfr/NFR-0002.md',
    });
  });
});

describe('renderArtifactPath — failure, as a typed result rather than a throw', () => {
  it('fails, naming the missing variable, rather than emitting a literal placeholder', () => {
    expect(renderArtifactPath('Story', { id: 'STORY-014' })).toEqual({
      success: false,
      missingVariable: 'slug',
    });
  });

  it('reports the first missing variable when more than one is absent', () => {
    expect(renderArtifactPath('Story', {})).toEqual({ success: false, missingVariable: 'id' });
  });
});
