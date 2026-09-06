/**
 * `PRESET_REGISTRY` — `15` §15.9's five named presets: every one must be real, schema-valid content.
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { describe, expect, it } from 'vitest';

import { PRESET_REGISTRY } from '../../src/presets/registry.ts';
import { validatePreset } from '../../src/presets/validate.ts';

describe('PRESET_REGISTRY', () => {
  it('names exactly the five presets 15 §15.9 lists', () => {
    expect(PRESET_REGISTRY.map((preset) => preset.id).sort()).toEqual(
      ['agency-delivery', 'enterprise-rigor', 'regulated', 'solo-fast', 'startup-lean'].sort(),
    );
  });

  it('has no duplicate preset ids', () => {
    const ids = PRESET_REGISTRY.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const preset of PRESET_REGISTRY) {
    it(`"${preset.id}" validates against every relevant schema, with no drift`, () => {
      const outcome = validatePreset(preset);
      expect(outcome.findings).toEqual([]);
      expect(outcome.valid).toBe(true);
    });

    it(`"${preset.id}" has at least one real overlay file`, () => {
      expect(preset.files.length).toBeGreaterThan(0);
    });

    it(`"${preset.id}"'s posture is real prose, not a placeholder`, () => {
      expect(preset.posture.length).toBeGreaterThan(10);
    });
  }

  it("enterprise-rigor's and regulated's postures are real, not nominal, per their own worked", () => {
    const enterpriseRigor = PRESET_REGISTRY.find((preset) => preset.id === 'enterprise-rigor');
    const regulated = PRESET_REGISTRY.find((preset) => preset.id === 'regulated');
    expect(enterpriseRigor?.files.some((file) => file.kind === 'workflowOverlay')).toBe(true);
    expect(regulated?.files.some((file) => file.kind === 'mcpConfig')).toBe(true);
    const mcp = regulated?.files.find((file) => file.kind === 'mcpConfig');
    expect(mcp?.data['servers']).toEqual([]);
  });
});
