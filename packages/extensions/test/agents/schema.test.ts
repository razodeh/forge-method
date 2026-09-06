/**
 * `agentOverlaySchema`, `rosterConfigSchema` — `15` §15.3.1's changeable/constrained/immutable shape.
 *
 * @see specs/15 §15.3.1
 * @see PLAN-M2.md P3
 */
import { describe, expect, it } from 'vitest';

import { agentOverlaySchema, rosterConfigSchema } from '../../src/agents/schema.ts';

describe('agentOverlaySchema — free fields', () => {
  it('accepts persona, mandate, model, limits, briefs, skills, mcp, frameworks', () => {
    const result = agentOverlaySchema.safeParse({
      persona: { voice: 'terse' },
      mandate: 'Own backend implementation.',
      model: { tier: 'balanced', thinking: true },
      limits: { max_cost_usd: 3.0 },
      briefs: { 'implement-story': 'Do the thing.' },
      skills: { $append: ['acme-java-standards'] },
      mcp: { $append: [{ server: 'acme-jira', tools: ['search_issues'] }] },
      frameworks: ['repo-strategy'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the full 15 §15.2 worked example (minus $extends/$description, which resolve strips)', () => {
    const result = agentOverlaySchema.safeParse({
      model: { tier: 'balanced' },
      persona: { voice: 'terse, cites the standard it is applying' },
      tools: {
        exec: { $append: ['./gradlew *', 'internal-cli *'] },
        network: 'allowlist',
        allowlistHosts: { $set: ['artifactory.internal', 'registry.npmjs.org'] },
      },
      skills: {
        $append: ['acme-java-standards', 'acme-observability'],
        $remove: ['generic-node-conventions'],
      },
      mcp: {
        $append: [
          { server: 'acme-jira', tools: ['search_issues', 'get_issue'] },
          { server: 'acme-confluence', tools: ['search'] },
        ],
      },
      limits: { max_cost_usd: 3.0 },
      briefs: {
        'implement-story': 'overrides/prompts/backend.implement-story.md',
        $append_guidance: 'overrides/prompts/backend.house-rules.md',
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('agentOverlaySchema — immutable fields (15 §15.3.1)', () => {
  it('refuses gates.may_approve, naming separation of duties', () => {
    const result = agentOverlaySchema.safeParse({ gates: { may_approve: true } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(' ');
      expect(message).toMatch(/separation of duties/);
    }
  });

  it('refuses tier, pointing at creating a new agent instead', () => {
    const result = agentOverlaySchema.safeParse({ tier: 'strong' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(' ');
      expect(message).toMatch(/create a new agent instead/);
    }
  });

  it('refuses id, pointing at creating a new agent instead', () => {
    const result = agentOverlaySchema.safeParse({ id: 'renamed-backend' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(' ');
      expect(message).toMatch(/create a new agent instead/);
    }
  });

  it('reports all three immutable fields at once when all three are set', () => {
    const result = agentOverlaySchema.safeParse({ gates: {}, tier: 'x', id: 'y' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(3);
    }
  });
});

describe('agentOverlaySchema — unrecognised fields', () => {
  it('refuses a typo field name rather than silently accepting it', () => {
    const result = agentOverlaySchema.safeParse({ pesona: { voice: 'x' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Unrecognised field "pesona"/);
    }
  });
});

describe('rosterConfigSchema', () => {
  it('accepts the full 15 §15.3.3 worked example', () => {
    const result = rosterConfigSchema.safeParse({
      preset: 'startup-lean',
      enable: ['compliance'],
      disable: ['ux', 'mobile'],
      alias: { backend: 'Platform Engineer' },
      add: [
        {
          id: 'sap-integrator',
          decisions_owned: ['x'],
          outputs: ['y'],
          file_ownership: ['z'],
          tools: {},
        },
      ],
      split: {
        backend: [
          { id: 'backend-api', skills: ['acme-rest-standards'], file_ownership: ['src/api/**'] },
          {
            id: 'backend-worker',
            skills: ['acme-async-standards'],
            file_ownership: ['src/worker/**'],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    expect(rosterConfigSchema.safeParse({ disble: ['ux'] }).success).toBe(false);
  });
});
