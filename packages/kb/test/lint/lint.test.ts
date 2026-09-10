/**
 * `lintKb` — `08` §8.7's rule table, checked against a real, minimal, internally-consistent KB tree
 * (`fixtures/greenfield-service`, extended for P10) plus one synthetic fixture case per rule.
 *
 * @see specs/08 §8.7
 * @see SPEC-QUESTIONS.md Q44
 * @see SPEC-QUESTIONS.md Q56
 * @see PLAN-M3.md P10
 */
import { ProjectPaths } from '@forge/core/fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { lintKb, type LintKbSpecArtifacts } from '../../src/lint/lint.ts';
import { parseKbTree, type KbTree } from '../../src/schema/tree.ts';
import {
  adr,
  capability,
  component,
  componentsFile,
  diagram,
  epic,
  kbEntry,
  runbook,
  treeOf,
} from './factories.ts';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '../../../../fixtures/greenfield-service');
const NO_SPEC_ARTIFACTS: LintKbSpecArtifacts = { capabilities: [], epics: [] };
const CLEAN_NOW = new Date('2026-01-06T00:00:00.000Z');

async function realTree(): Promise<KbTree> {
  const paths = new ProjectPaths(FIXTURE_ROOT);
  return parseKbTree(paths);
}

function findingsOf(
  ruleId: string,
  findings: ReturnType<typeof lintKb>,
): ReturnType<typeof lintKb> {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

describe('lintKb — fixtures/greenfield-service', () => {
  it("lints clean: no findings against the base fixture (the milestone's own exit-test target, Q43)", async () => {
    const tree = await realTree();
    const findings = lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW);
    expect(findings).toEqual([]);
  });
});

describe('lintKb — kb:dangling-ref', () => {
  it('flags a related id shaped like a KB-tree id that does not resolve to a real entry', () => {
    const tree = treeOf([{ kind: 'kb-entry', value: kbEntry({ related: ['KB-ARCH-0099'] }) }]);
    const findings = findingsOf(
      'kb:dangling-ref',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
  });

  it('does not flag a related id that is not shaped like a KB-tree id at all (an out-of-tree reference)', () => {
    const tree = treeOf([{ kind: 'kb-entry', value: kbEntry({ related: ['NFR-0004'] }) }]);
    expect(findingsOf('kb:dangling-ref', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toEqual(
      [],
    );
  });

  it("also checks an ADR's own superseded_by field, not just related/supersedes", () => {
    const tree = treeOf([
      { kind: 'adr', value: adr({ status: 'superseded', superseded_by: 'ADR-0099' }) },
    ]);
    const findings = findingsOf(
      'kb:dangling-ref',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
  });

  it('reports a repeated dangling id once, not once per repetition', () => {
    const tree = treeOf([
      { kind: 'kb-entry', value: kbEntry({ related: ['KB-ARCH-0099', 'KB-ARCH-0099'] }) },
    ]);
    const findings = findingsOf(
      'kb:dangling-ref',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
  });

  it('flags a decision source citing an ADR id that does not exist in the tree', () => {
    const tree = treeOf([
      { kind: 'kb-entry', value: kbEntry({ sources: [{ kind: 'decision', ref: 'ADR-0099' }] }) },
    ]);
    const findings = findingsOf(
      'kb:dangling-ref',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
  });

  it('does not flag a decision source citing a real ADR', () => {
    const tree = treeOf([
      { kind: 'adr', value: adr({ id: 'ADR-0001' }) },
      { kind: 'kb-entry', value: kbEntry({ sources: [{ kind: 'decision', ref: 'ADR-0001' }] }) },
    ]);
    expect(findingsOf('kb:dangling-ref', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toEqual(
      [],
    );
  });

  it('does not flag a non-decision source, even one shaped like a dangling KB-tree id', () => {
    const tree = treeOf([
      { kind: 'kb-entry', value: kbEntry({ sources: [{ kind: 'human', ref: 'ADR-0099' }] }) },
    ]);
    expect(findingsOf('kb:dangling-ref', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toEqual(
      [],
    );
  });
});

describe('lintKb — kb:supersession-cycle', () => {
  it('flags a real cycle (A supersedes B supersedes A)', () => {
    const a = kbEntry({ id: 'KB-ARCH-0001', supersedes: ['KB-ARCH-0002'] });
    const b = kbEntry({ id: 'KB-ARCH-0002', supersedes: ['KB-ARCH-0001'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: a },
      { kind: 'kb-entry', value: b },
    ]);
    const findings = findingsOf(
      'kb:supersession-cycle',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag a plain (acyclic) supersession chain', () => {
    const a = kbEntry({ id: 'KB-ARCH-0001', status: 'superseded', superseded_by: 'KB-ARCH-0002' });
    const b = kbEntry({ id: 'KB-ARCH-0002', supersedes: ['KB-ARCH-0001'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: a },
      { kind: 'kb-entry', value: b },
    ]);
    expect(
      findingsOf('kb:supersession-cycle', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });

  it('walks through a dangling supersedes id without crashing or reporting a cycle', () => {
    // KB-ARCH-0002 does not exist at all — a real gap for kb:dangling-ref to catch, not this rule.
    const a = kbEntry({ id: 'KB-ARCH-0001', supersedes: ['KB-ARCH-0002'] });
    const tree = treeOf([{ kind: 'kb-entry', value: a }]);
    expect(
      findingsOf('kb:supersession-cycle', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });
});

describe('lintKb — kb:contradiction (antonym tags, via checkContradictions)', () => {
  it('surfaces a real antonym-tag conflict through lintKb, not only through checkContradictions directly', () => {
    const a = kbEntry({ applies_to: ['component:api'], tags: ['sync'] });
    const b = kbEntry({ applies_to: ['component:api'], tags: ['async'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: a },
      { kind: 'kb-entry', value: b },
    ]);
    expect(
      findingsOf('kb:contradiction', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)).length,
    ).toBe(1);
  });
});

describe('lintKb — kb:component-coverage', () => {
  it('flags a component with zero owning ADRs at error severity', () => {
    const tree = treeOf([
      { kind: 'components-file', value: componentsFile([component({ id: 'component:api' })]) },
    ]);
    const findings = findingsOf(
      'kb:component-coverage',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.entryId).toBe('component:api');
  });

  it('is clean once a KB entry applies_to it and cites a decision', () => {
    const a = adr({ id: 'ADR-0001' });
    const entry = kbEntry({
      applies_to: ['component:api'],
      sources: [{ kind: 'decision', ref: 'ADR-0001' }],
    });
    const tree = treeOf([
      { kind: 'components-file', value: componentsFile([component({ id: 'component:api' })]) },
      { kind: 'adr', value: a },
      { kind: 'kb-entry', value: entry },
    ]);
    expect(
      findingsOf('kb:component-coverage', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });

  it('a component covered only by a deprecated KB entry is still flagged (a stale citation does not count)', () => {
    const a = adr({ id: 'ADR-0001' });
    const entry = kbEntry({
      status: 'deprecated',
      applies_to: ['component:api'],
      sources: [{ kind: 'decision', ref: 'ADR-0001' }],
    });
    const tree = treeOf([
      { kind: 'components-file', value: componentsFile([component({ id: 'component:api' })]) },
      { kind: 'adr', value: a },
      { kind: 'kb-entry', value: entry },
    ]);
    expect(
      findingsOf('kb:component-coverage', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toHaveLength(1);
  });
});

describe('lintKb — kb:dangling-ref (component register)', () => {
  it('flags a component whose dependsOn names a component that does not exist in components.md', () => {
    const tree = treeOf([
      {
        kind: 'components-file',
        value: componentsFile([component({ id: 'component:api', dependsOn: ['component:ghost'] })]),
      },
    ]);
    const findings = findingsOf(
      'kb:dangling-ref',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.entryId).toBe('component:api');
  });

  it('flags a KB entry whose applies_to names a component: tag that is not a registered component', () => {
    const tree = treeOf([
      { kind: 'components-file', value: componentsFile([component({ id: 'component:api' })]) },
      { kind: 'kb-entry', value: kbEntry({ applies_to: ['component:ghost'] }) },
    ]);
    const findings = findingsOf(
      'kb:dangling-ref',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
  });

  it('does not check applies_to component: tags at all when no components.md exists in the tree', () => {
    const tree = treeOf([
      { kind: 'kb-entry', value: kbEntry({ applies_to: ['component:ghost'] }) },
    ]);
    expect(findingsOf('kb:dangling-ref', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toEqual(
      [],
    );
  });

  it('is clean once dependsOn/applies_to only ever name real, registered components', () => {
    const tree = treeOf([
      {
        kind: 'components-file',
        value: componentsFile([
          component({ id: 'component:api', dependsOn: ['component:db'] }),
          component({ id: 'component:db' }),
        ]),
      },
      { kind: 'kb-entry', value: kbEntry({ applies_to: ['component:api', 'component:db'] }) },
    ]);
    expect(findingsOf('kb:dangling-ref', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toEqual(
      [],
    );
  });
});

describe('lintKb — diagram:required', () => {
  it('flags a missing required diagram at L2+', () => {
    const tree = treeOf([]);
    const findings = findingsOf(
      'diagram:required',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L2', CLEAN_NOW),
    );
    expect(findings).toHaveLength(2);
  });

  it('is clean once both required diagram sources exist', () => {
    const tree = treeOf([
      { kind: 'diagram', value: diagram({ source: 'architecture/views/context.mmd' }) },
      { kind: 'diagram', value: diagram({ source: 'architecture/views/containers.mmd' }) },
    ]);
    expect(
      findingsOf('diagram:required', lintKb(tree, NO_SPEC_ARTIFACTS, 'L2', CLEAN_NOW)),
    ).toEqual([]);
  });

  it('does not apply below L2', () => {
    const tree = treeOf([]);
    expect(
      findingsOf('diagram:required', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });

  it('fails safe (no findings, no throw) for a malformed level string', () => {
    const tree = treeOf([]);
    expect(
      findingsOf('diagram:required', lintKb(tree, NO_SPEC_ARTIFACTS, 'not-a-level', CLEAN_NOW)),
    ).toEqual([]);
  });
});

describe('lintKb — diagram:adr-coverage', () => {
  it('flags a structural ADR (category: architecture) with no diagram', () => {
    const tree = treeOf([{ kind: 'adr', value: adr({ category: 'architecture', diagrams: [] }) }]);
    const findings = findingsOf(
      'diagram:adr-coverage',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
  });

  it('is clean once the ADR names a diagram', () => {
    const tree = treeOf([
      { kind: 'adr', value: adr({ category: 'architecture', diagrams: ['DIAG-001'] }) },
    ]);
    expect(
      findingsOf('diagram:adr-coverage', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });

  it('does not apply to a non-architecture-category ADR', () => {
    const tree = treeOf([{ kind: 'adr', value: adr({ category: 'data', diagrams: [] }) }]);
    expect(
      findingsOf('diagram:adr-coverage', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });
});

describe('lintKb — kb:cap-coverage', () => {
  it('flags a capability with no downstream epic', () => {
    const tree = treeOf([]);
    const artifacts: LintKbSpecArtifacts = {
      capabilities: [capability({ id: 'CAP-001' })],
      epics: [],
    };
    const findings = findingsOf('kb:cap-coverage', lintKb(tree, artifacts, 'L1', CLEAN_NOW));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });

  it('is clean once an epic names the capability', () => {
    const tree = treeOf([]);
    const artifacts: LintKbSpecArtifacts = {
      capabilities: [capability({ id: 'CAP-001' })],
      epics: [epic({ capability: 'CAP-001' })],
    };
    expect(findingsOf('kb:cap-coverage', lintKb(tree, artifacts, 'L1', CLEAN_NOW))).toEqual([]);
  });

  it('does not flag a capability explicitly marked priority: wont', () => {
    const tree = treeOf([]);
    const artifacts: LintKbSpecArtifacts = {
      capabilities: [capability({ id: 'CAP-001', priority: 'wont' })],
      epics: [],
    };
    expect(findingsOf('kb:cap-coverage', lintKb(tree, artifacts, 'L1', CLEAN_NOW))).toEqual([]);
  });
});

describe('lintKb — kb:staleness', () => {
  it('flags an entry whose review_by is in the past', () => {
    const tree = treeOf([{ kind: 'kb-entry', value: kbEntry({ review_by: '2026-01-01' }) }]);
    const findings = findingsOf(
      'kb:staleness',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', new Date('2026-06-01')),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });

  it('does not flag an entry whose review_by has not passed yet', () => {
    const tree = treeOf([{ kind: 'kb-entry', value: kbEntry({ review_by: '2026-12-01' }) }]);
    expect(
      findingsOf('kb:staleness', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', new Date('2026-06-01'))),
    ).toEqual([]);
  });
});

describe('lintKb — kb:low-confidence-input', () => {
  it('flags an accepted ADR that draws on a low-confidence KB entry via related', () => {
    const low = kbEntry({ id: 'KB-ARCH-0001', confidence: 'low' });
    const a = adr({ status: 'accepted', related: ['KB-ARCH-0001'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: low },
      { kind: 'adr', value: a },
    ]);
    const findings = findingsOf(
      'kb:low-confidence-input',
      lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });

  it('does not flag a proposed (not accepted) ADR drawing on a low-confidence entry', () => {
    const low = kbEntry({ id: 'KB-ARCH-0001', confidence: 'low' });
    const a = adr({ status: 'proposed', related: ['KB-ARCH-0001'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: low },
      { kind: 'adr', value: a },
    ]);
    expect(
      findingsOf('kb:low-confidence-input', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });

  it('does not flag an accepted ADR drawing on a real, non-low-confidence KB entry', () => {
    const high = kbEntry({ id: 'KB-ARCH-0001', confidence: 'high' });
    const a = adr({ status: 'accepted', related: ['KB-ARCH-0001'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: high },
      { kind: 'adr', value: a },
    ]);
    expect(
      findingsOf('kb:low-confidence-input', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    ).toEqual([]);
  });
});

describe('lintKb — kb:orphan', () => {
  it('flags a non-root entry with no inbound link', () => {
    const tree = treeOf([{ kind: 'runbook', value: runbook(), path: 'ops/runbooks/RUN-001-x.md' }]);
    const findings = findingsOf('kb:orphan', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });

  it('does not flag a root-section entry (glossary.md) even with no inbound link', () => {
    const tree = treeOf([
      { kind: 'kb-entry', value: kbEntry({ section: 'glossary' }), path: 'glossary.md' },
    ]);
    expect(findingsOf('kb:orphan', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toEqual([]);
  });

  it('does not flag a non-root entry once something else links to it', () => {
    const target = runbook({ id: 'RUN-001' });
    // `linker` itself is also a non-root entry with no inbound link of its own, so it is expected to
    // still show up as its own orphan finding here — this test is only about RUN-001 no longer being
    // one, once `linker` points at it.
    const linker = kbEntry({ related: ['RUN-001'] });
    const tree = treeOf([
      { kind: 'runbook', value: target, path: 'ops/runbooks/RUN-001-x.md' },
      { kind: 'kb-entry', value: linker },
    ]);
    const orphans = findingsOf('kb:orphan', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW));
    expect(orphans.some((finding) => finding.entryId === 'RUN-001')).toBe(false);
  });

  it('does not flag a KB entry that a diagram explains, even with no other inbound link', () => {
    // A gauntlet critic found `Diagram.explains`/`depicts` were never consulted, so a real, legitimate
    // reference from a diagram still left the entry it explains looking orphaned.
    const target = kbEntry({ id: 'KB-ARCH-0001' });
    const explainer = diagram({ explains: ['KB-ARCH-0001'] });
    const tree = treeOf([
      { kind: 'kb-entry', value: target },
      { kind: 'diagram', value: explainer },
    ]);
    const orphans = findingsOf('kb:orphan', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW));
    expect(orphans.some((finding) => finding.entryId === 'KB-ARCH-0001')).toBe(false);
  });

  it('does not flag an ADR that a diagram depicts, even with no other inbound link', () => {
    const target = adr({ id: 'ADR-0001' });
    const depicter = diagram({ depicts: ['ADR-0001'] });
    const tree = treeOf([
      { kind: 'adr', value: target },
      { kind: 'diagram', value: depicter },
    ]);
    const orphans = findingsOf('kb:orphan', lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW));
    expect(orphans.some((finding) => finding.entryId === 'ADR-0001')).toBe(false);
  });
});

describe('lintKb — kb:glossary-drift', () => {
  it("flags a backtick-quoted term in a capability's own text that is not defined in the glossary", () => {
    const glossary = kbEntry({
      section: 'glossary',
      body: '## Statement\n- **Widget** — a thing.',
    });
    const tree = treeOf([{ kind: 'kb-entry', value: glossary, path: 'glossary.md' }]);
    const artifacts: LintKbSpecArtifacts = {
      capabilities: [capability({ statement: 'Uses a `Gadget` internally.' })],
      epics: [],
    };
    const findings = findingsOf('kb:glossary-drift', lintKb(tree, artifacts, 'L1', CLEAN_NOW));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
  });

  it('does not flag a backtick-quoted term that is defined in the glossary (case-insensitive)', () => {
    const glossary = kbEntry({
      section: 'glossary',
      body: '## Statement\n- **Widget** — a thing.',
    });
    const tree = treeOf([{ kind: 'kb-entry', value: glossary, path: 'glossary.md' }]);
    const artifacts: LintKbSpecArtifacts = {
      capabilities: [capability({ statement: 'Uses a `widget` internally.' })],
      epics: [],
    };
    expect(findingsOf('kb:glossary-drift', lintKb(tree, artifacts, 'L1', CLEAN_NOW))).toEqual([]);
  });
});

describe('lintKb — composing an LLM-shaped semantic finding never elevates severity', () => {
  it('a caller-composed warning-severity finding stays warn, by construction', () => {
    const tree = treeOf([]);
    const findings = lintKb(tree, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW);
    const composed = [
      ...findings,
      { ruleId: 'kb:llm-contradiction', severity: 'warn' as const, message: 'maybe?' },
    ];
    expect(
      composed.every((f) => f.ruleId !== 'kb:llm-contradiction' || f.severity === 'warn'),
    ).toBe(true);
  });
});

describe('lintKb — determinism (R10)', () => {
  it('produces identically-ordered output across repeated calls over the same tree and now', async () => {
    const tree = await realTree();
    const artifacts: LintKbSpecArtifacts = {
      capabilities: [capability({ id: 'CAP-001' })],
      epics: [],
    };
    const a = lintKb(tree, artifacts, 'L2', new Date('2026-06-01'));
    const b = lintKb(tree, artifacts, 'L2', new Date('2026-06-01'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it('produces the identical finding set for a logically identical tree whose entries array is reversed', () => {
    // `KbTree.entries` carries no ordering guarantee for any caller other than `parseKbTree`'s own
    // lexically-sorted walk — a gauntlet critic found this incidental order leaking into finding
    // *content* (which id becomes entryId, message wording), not just list order.
    const a = kbEntry({
      id: 'KB-ARCH-0001',
      section: 'architecture',
      applies_to: ['component:api'],
      tags: ['sync'],
    });
    const b = kbEntry({
      id: 'KB-ARCH-0002',
      section: 'architecture',
      applies_to: ['component:api'],
      tags: ['async'],
    });
    const forward = treeOf([
      { kind: 'kb-entry', value: a },
      { kind: 'kb-entry', value: b },
    ]);
    const reversed = treeOf([
      { kind: 'kb-entry', value: b },
      { kind: 'kb-entry', value: a },
    ]);
    expect(JSON.stringify(lintKb(forward, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW))).toBe(
      JSON.stringify(lintKb(reversed, NO_SPEC_ARTIFACTS, 'L1', CLEAN_NOW)),
    );
  });
});
