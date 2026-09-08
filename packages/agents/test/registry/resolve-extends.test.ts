/**
 * `resolveExtends` — `PLAN-M6.md` A1's own Checks section.
 *
 * @see specs/05 §5.3
 * @see PLAN-M6.md A1
 */
import { describe, expect, it } from 'vitest';

import { loadAgentDefinition } from '../../src/schema/load.ts';
import { AgentRegistry } from '../../src/registry/registry.ts';
import { resolveExtends } from '../../src/registry/resolve-extends.ts';
import { ARCHITECT } from '../fixtures/architect.ts';

function loadAgent(source: string) {
  const result = loadAgentDefinition(source, 'x.agent.yaml');
  if (!result.success)
    throw new Error(`fixture agent failed to load: ${JSON.stringify(result.issues)}`);
  return result.agent;
}

// A minimal, deliberately-small base agent -- ARCHITECT's own `extends: base-engineer` names an agent
// this test suite defines fresh, not a real shipped roster member (that's A2/A3's own content). Its own
// `extends:` line keeps a distinct sentinel value (not simply removed) so each test below can reliably
// find-and-replace it -- ARCHITECT's own fixture already contains the literal substring
// "extends: base-engineer", making a later `.replace('extends: base-engineer\n', ...)` against an
// *already-stripped* copy of this constant a real no-op that silently fails to set what the test
// actually wants (an earlier version of this file had exactly that bug in two tests below).
const BASE_ENGINEER_WITH_PLACEHOLDER_EXTENDS = ARCHITECT.replace(
  'id: architect',
  'id: base-engineer',
)
  .replace('name: System Architect', 'name: Base Engineer')
  .replace('extends: base-engineer\n', 'extends: __PARENT__\n')
  .replace('max_turns: 40', 'max_turns: 20')
  .replace('max_cost_usd: 6.00', 'max_cost_usd: 2.00');

/** `BASE_ENGINEER_WITH_PLACEHOLDER_EXTENDS`, either with `extends:` removed entirely (`parent:
 * undefined`) or pointed at a real `parentId`. */
function baseEngineer(id: string, parentId: string | undefined): string {
  const withId = BASE_ENGINEER_WITH_PLACEHOLDER_EXTENDS.replace('id: base-engineer', `id: ${id}`);
  return parentId === undefined
    ? withId.replace('extends: __PARENT__\n', '')
    : withId.replace('__PARENT__', parentId);
}

const BASE_ENGINEER = baseEngineer('base-engineer', undefined);

describe('resolveExtends', () => {
  it('returns the agent unchanged when it declares no extends', () => {
    const base = loadAgent(BASE_ENGINEER);
    const registry = new AgentRegistry([base]);
    expect(resolveExtends('base-engineer', registry)).toEqual(base);
  });

  it("layers a child's own fields over the parent's, with the child winning on any field both declare", () => {
    const registry = new AgentRegistry([loadAgent(BASE_ENGINEER), loadAgent(ARCHITECT)]);
    const resolved = resolveExtends('architect', registry);
    // architect's own limits (max_turns: 40) win over base-engineer's (max_turns: 20) -- both declare it.
    expect(resolved.limits.max_turns).toBe(40);
    expect(resolved.id).toBe('architect');
    expect(resolved.name).toBe('System Architect');
  });

  it('a field the child never declares at all is inherited from the parent, not erased to undefined', () => {
    const childWithNoFrameworks = ARCHITECT.replace(/frameworks:\n(\s+- .*\n)+/, '');
    const registry = new AgentRegistry([
      loadAgent(BASE_ENGINEER),
      loadAgent(childWithNoFrameworks),
    ]);
    const resolved = resolveExtends('architect', registry);
    // base-engineer's own frameworks (inherited from ARCHITECT's fixture, unmodified) survive.
    expect(resolved.frameworks).toBeDefined();
    expect(resolved.frameworks?.length).toBeGreaterThan(0);
  });

  it('resolves a multi-level extends chain: a field neither the child nor the immediate parent declares is inherited from the grandparent', () => {
    // frameworks is optional, so a fixture can genuinely omit it (unlike a required field, which every
    // fixture must set, making "inherited vs. overridden" unobservable through it) -- the real proof
    // this walks two full levels, not just the immediate parent.
    const withoutFrameworks = (source: string) => source.replace(/frameworks:\n(\s+- .*\n)+/, '');

    const grandparent = loadAgent(
      baseEngineer('root-agent', undefined).replace(
        '- system-design\n  - pattern-selection\n  - nfr-strategy',
        '- grandparent-only-framework',
      ),
    );
    const parent = loadAgent(withoutFrameworks(baseEngineer('base-engineer', 'root-agent')));
    const childArchitect = withoutFrameworks(ARCHITECT);
    const registry = new AgentRegistry([grandparent, parent, loadAgent(childArchitect)]);

    const resolved = resolveExtends('architect', registry);
    expect(resolved.frameworks).toEqual(['grandparent-only-framework']);
    // architect's own limits (max_turns: 40) still win over both ancestors' -- a required field is
    // always declared by every fixture, so this confirms the child-wins rule held throughout the chain.
    expect(resolved.limits.max_turns).toBe(40);
  });

  it('throws for an id absent from the registry', () => {
    const registry = new AgentRegistry([]);
    expect(() => resolveExtends('not-real', registry)).toThrow();
  });

  it('throws for an extends chain naming an agent absent from the registry', () => {
    const registry = new AgentRegistry([loadAgent(ARCHITECT)]);
    expect(() => resolveExtends('architect', registry)).toThrow(/base-engineer/);
  });

  it('throws for a real circular extends chain rather than looping forever', () => {
    const cycleA = loadAgent(baseEngineer('cycle-a', 'cycle-b'));
    const cycleB = loadAgent(baseEngineer('cycle-b', 'cycle-a'));
    const registry = new AgentRegistry([cycleA, cycleB]);
    expect(() => resolveExtends('cycle-a', registry)).toThrow(/circular/);
  });
});
