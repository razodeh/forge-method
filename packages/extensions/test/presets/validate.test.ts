/**
 * `validatePreset` — `15` §15.9: "a preset is just a bundle of the above."
 *
 * @see specs/15 §15.9
 * @see PLAN-M2.md P7
 */
import { describe, expect, it } from 'vitest';

import { validatePreset } from '../../src/presets/validate.ts';
import type { PresetDefinition } from '../../src/presets/types.ts';

describe('validatePreset — bundle shape', () => {
  it('flags a preset with no files at all', () => {
    const preset: PresetDefinition = { id: 'fixture-empty', posture: 'Empty.', files: [] };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.length).toBeGreaterThan(0);
  });

  it('reports a root-level bundle-shape issue (no specific field path) as "(root)"', () => {
    const preset = {
      id: 'fixture-stray-field',
      posture: 'A fixture preset with a stray top-level field.',
      files: [{ path: 'x.agent.yaml', kind: 'agentOverlay', data: {} }],
      extraField: true,
    } as unknown as PresetDefinition;
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings[0]?.message).toMatch(/^\(root\):/);
  });
});

describe('validatePreset — schema dispatch', () => {
  it('is valid for a preset whose one file validates against its own kind', () => {
    const preset: PresetDefinition = {
      id: 'fixture',
      posture: 'A fixture preset for testing.',
      files: [
        {
          path: '.forge/overrides/agents/reviewer.agent.yaml',
          kind: 'agentOverlay',
          data: { model: { tier: 'frugal' } },
        },
      ],
    };
    expect(validatePreset(preset)).toEqual({ valid: true, findings: [] });
  });

  it("flags a file whose data fails its own kind's schema", () => {
    const preset: PresetDefinition = {
      id: 'fixture-broken',
      posture: 'A fixture preset with a broken file.',
      files: [
        {
          path: '.forge/overrides/agents/reviewer.agent.yaml',
          kind: 'agentOverlay',
          data: { gates: ['G-Design'] }, // an immutable, overlay-forbidden key
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]?.path).toBe('.forge/overrides/agents/reviewer.agent.yaml');
  });

  it('reports one finding per invalid file across a multi-file preset, valid files unaffected', () => {
    const preset: PresetDefinition = {
      id: 'fixture-mixed',
      posture: 'A fixture preset mixing a valid and an invalid file.',
      files: [
        {
          path: 'valid.agent.yaml',
          kind: 'agentOverlay',
          data: { model: { tier: 'frugal' } },
        },
        {
          path: 'invalid.check.yaml',
          kind: 'gateCheck',
          data: { id: 'x' }, // missing run/failOn/remedy/appliesTo/severity
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.every((finding) => finding.path === 'invalid.check.yaml')).toBe(true);
    expect(outcome.findings.length).toBeGreaterThan(0);
  });

  it('reports a root-level schema issue (no specific field path) as "(root)"', () => {
    const preset: PresetDefinition = {
      id: 'fixture-root-issue',
      posture: 'A fixture preset with a stray top-level field.',
      files: [
        {
          path: 'x.framework.yaml',
          kind: 'frameworkOverlay',
          data: { extraField: true },
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings[0]?.message).toMatch(/^\(root\):/);
  });
});

describe('validatePreset — z.union-aware schema dispatch (SPEC-QUESTIONS.md Q325)', () => {
  // Four of the seven `KIND_SCHEMAS` compose a real `z.union` somewhere in their own shape (traced
  // through an imported/shared helper, not a literal `z.union` in this package's own schema.ts files
  // -- `mcpConfigSchema`'s own `toolGrantValueSchema`, `agentOverlaySchema`'s own `limitsSchema`,
  // `workflowOverlaySchema`'s own `workflowStepsFieldSchema`, and `frameworkOverlaySchema`'s own
  // `overlayArrayField(...)` helper). Each of these was confirmed live through this exact function
  // before the fix (rendering zod's generic "Invalid input"), not merely a hypothetical schema shape.

  it('names every toolGrantValueSchema union member\'s own reason for a malformed mcpConfig grant, not "Invalid input"', () => {
    const preset: PresetDefinition = {
      id: 'fixture-mcp-bad-grant',
      posture: 'A fixture preset with a malformed mcp grant value.',
      files: [
        {
          path: 'mcp.yaml',
          kind: 'mcpConfig',
          data: { servers: [], grants: { pm: { 'acme-jira': 'everything' } } },
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    const message = outcome.findings[0]?.message;
    expect(message).not.toContain('Invalid input');
    expect(message).toContain('did not match any of the 2 allowed shapes');
    expect(message).toContain('Expected array, received string');
    expect(message).toContain('Invalid literal value');
  });

  it('names every limitsSchema union member\'s own reason for a malformed agentOverlay limit, not "Invalid input"', () => {
    const preset: PresetDefinition = {
      id: 'fixture-agent-bad-limit',
      posture: 'A fixture preset with a malformed agent-overlay limit value.',
      files: [
        {
          path: 'agent.yaml',
          kind: 'agentOverlay',
          data: { limits: { max_turns: [1, 2, 3] } },
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    const message = outcome.findings[0]?.message;
    expect(message).not.toContain('Invalid input');
    expect(message).toContain('did not match any of the 3 allowed shapes');
    expect(message).toContain('Expected number, received array');
    expect(message).toContain('Expected string, received array');
    expect(message).toContain('Expected boolean, received array');
  });

  it('names every workflowStepsFieldSchema union member\'s own reason for a malformed workflowOverlay steps value, not "Invalid input"', () => {
    const preset: PresetDefinition = {
      id: 'fixture-workflow-bad-steps',
      posture: 'A fixture preset with a malformed workflow-overlay steps value.',
      files: [
        {
          path: 'workflow.yaml',
          kind: 'workflowOverlay',
          data: { steps: 'not-an-array-or-directive' },
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    const message = outcome.findings[0]?.message;
    expect(message).not.toContain('Invalid input');
    expect(message).toContain('did not match any of the 2 allowed shapes');
    expect(message).toContain('Expected array, received string');
    expect(message).toContain('Expected object, received string');
  });

  it('names every overlayArrayField union member\'s own reason for a malformed frameworkOverlay criteria value, not "Invalid input"', () => {
    const preset: PresetDefinition = {
      id: 'fixture-framework-bad-criteria',
      posture: 'A fixture preset with a malformed framework-overlay criteria value.',
      files: [
        {
          path: 'framework.yaml',
          kind: 'frameworkOverlay',
          data: { criteria: 'not-an-array-or-directive' },
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    const message = outcome.findings[0]?.message;
    expect(message).not.toContain('Invalid input');
    expect(message).toContain('did not match any of the 2 allowed shapes');
    expect(message).toContain('Expected array, received string');
    expect(message).toContain('Expected object, received string');
  });
});

describe('validatePreset — templateOverlay', () => {
  const COMPLETE_ADR_FRONT_MATTER = {
    id: 'ADR-0001',
    type: 'ADR',
    schemaVersion: 1,
    title: 'x',
    status: 'proposed',
    created: '2026-01-15',
    updated: '2026-01-15',
    revision: 1,
    author: 'architect',
    changelog: [],
    category: 'architecture',
    deciders: [],
    date: '2026-01-15',
    reversibility: 'medium',
    blast_radius: [],
    revisit_trigger: 'x',
    supersedes: [],
    superseded_by: null,
    related: [],
    diagrams: [],
    framework: 'x',
  };

  it('is valid when every required ADR field is present', () => {
    const preset: PresetDefinition = {
      id: 'fixture-template',
      posture: 'A fixture preset with a complete template overlay.',
      files: [
        {
          path: '.forge/overrides/templates/ADR.md',
          kind: 'templateOverlay',
          data: COMPLETE_ADR_FRONT_MATTER,
        },
      ],
    };
    expect(validatePreset(preset)).toEqual({ valid: true, findings: [] });
  });

  it('flags a missing required field, naming it', () => {
    const incomplete: Record<string, unknown> = { ...COMPLETE_ADR_FRONT_MATTER };
    Reflect.deleteProperty(incomplete, 'title');
    const preset: PresetDefinition = {
      id: 'fixture-template-incomplete',
      posture: 'A fixture preset with an incomplete template overlay.',
      files: [
        { path: '.forge/overrides/templates/ADR.md', kind: 'templateOverlay', data: incomplete },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.some((finding) => finding.message.includes('title'))).toBe(true);
  });

  it('flags a template overlay with no "type" field at all', () => {
    const preset: PresetDefinition = {
      id: 'fixture-template-no-type',
      posture: 'A fixture preset with an untyped template overlay.',
      files: [
        { path: '.forge/overrides/templates/x.md', kind: 'templateOverlay', data: { id: 'x' } },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings).toEqual([
      {
        severity: 'error',
        path: '.forge/overrides/templates/x.md',
        message: 'type: a template overlay must name a real, registered artifact type.',
      },
    ]);
  });

  it('flags a template overlay where every required field name is present but a value is invalid — field presence alone is not enough', () => {
    const garbageValues: Record<string, unknown> = {
      ...COMPLETE_ADR_FRONT_MATTER,
      status: 'not-a-real-status',
      schemaVersion: 'not-a-number',
      id: 'not-an-id-at-all',
      superseded_by: 12345,
    };
    const preset: PresetDefinition = {
      id: 'fixture-template-garbage-values',
      posture: 'A fixture preset whose template overlay has every field but bad values.',
      files: [
        { path: '.forge/overrides/templates/ADR.md', kind: 'templateOverlay', data: garbageValues },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.length).toBeGreaterThanOrEqual(4);
  });

  it('reports a root-level real-schema issue (a stray field the real ADR schema rejects) as "(root)"', () => {
    const strayField: Record<string, unknown> = {
      ...COMPLETE_ADR_FRONT_MATTER,
      notARealAdrField: true,
    };
    const preset: PresetDefinition = {
      id: 'fixture-template-stray-field',
      posture: 'A fixture preset whose template overlay has an unrecognised field.',
      files: [
        { path: '.forge/overrides/templates/ADR.md', kind: 'templateOverlay', data: strayField },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
    expect(outcome.findings.some((finding) => finding.message.startsWith('(root):'))).toBe(true);
  });

  it('flags a template overlay whose "type" names an unregistered artifact type', () => {
    const preset: PresetDefinition = {
      id: 'fixture-template-bad-type',
      posture: 'A fixture preset with an unknown template overlay type.',
      files: [
        {
          path: '.forge/overrides/templates/x.md',
          kind: 'templateOverlay',
          data: { type: 'NotReal' },
        },
      ],
    };
    const outcome = validatePreset(preset);
    expect(outcome.valid).toBe(false);
  });
});
