/**
 * `loadFramework`/`readFramework` — `PLAN-M6.md` M1's own Checks section.
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M1
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { loadFramework, readFramework } from '../../src/schema/load.ts';
import { REPO_STRATEGY } from '../fixtures/repo-strategy.ts';

describe('loadFramework', () => {
  it('round-trips the full 11 §11.0 repo-strategy worked example with every field intact', () => {
    const result = loadFramework(REPO_STRATEGY, 'repo-strategy.framework.yaml');

    if (!result.success)
      throw new Error(`expected success, got issues: ${JSON.stringify(result.issues)}`);
    expect(result.framework.id).toBe('repo-strategy');
    expect(result.framework.owner_agent).toBe('platform');
    expect(result.framework.produces).toEqual({
      adr_category: 'delivery',
      kb_section: 'delivery/repo-strategy.md',
    });
    expect(result.framework.inputs.derived).toHaveLength(2);
    expect(result.framework.questions).toHaveLength(2);
    expect(result.framework.options).toHaveLength(4);
    expect(result.framework.criteria).toHaveLength(6);
    expect(result.framework.scoring).toBe('rubric');
    expect(result.framework.rules).toHaveLength(2);
    expect(result.framework.output_template).toBe('templates/adr-repo-strategy.md.hbs');
    expect(result.framework.follow_on).toEqual([
      { create_stories_from: 'templates/stories/repo-bootstrap.yaml' },
    ]);
  });

  it('rejects a genuine YAML syntax error as a real issue, not a thrown error', () => {
    const result = loadFramework('id: a\n  bad indentation:', 'bad.framework.yaml');
    expect(result.success).toBe(false);
  });

  it('rejects criteria weights that do not sum to 1.0, naming the field', () => {
    const source = REPO_STRATEGY.replace('weight: 0.25', 'weight: 0.5');
    const result = loadFramework(source, 'repo-strategy.framework.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((issue) => issue.path === 'criteria')).toBe(true);
  });

  it('rejects a rules[].if expression that does not parse, naming the exact rule', () => {
    const source = REPO_STRATEGY.replace('deployable_units == 1', 'deployable_units ==');
    const result = loadFramework(source, 'repo-strategy.framework.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((issue) => issue.path === 'rules.0.if')).toBe(true);
  });

  it('scoring: rubric with a real elimination pre-pass (rules with eliminate/prefer) is accepted -- the worked example itself is exactly this shape', () => {
    // A first version of this piece's own validation assumed `scoring: rubric` meant "no elimination
    // phase" and rejected this -- disproven directly by 11 §11.0's own worked example, which is
    // `scoring: rubric` with two real eliminate/prefer rules. Kept as its own explicit regression test
    // so that assumption cannot silently creep back in.
    const result = loadFramework(REPO_STRATEGY, 'repo-strategy.framework.yaml');
    expect(result.success).toBe(true);
  });

  it('rejects an unknown top-level field rather than silently ignoring it (.strict())', () => {
    const source = REPO_STRATEGY.replace('scoring: rubric', 'scoring: rubric\nbogus_field: 1');
    const result = loadFramework(source, 'x.framework.yaml');
    expect(result.success).toBe(false);
  });

  it('rejects a rules[].then.eliminate id that names no declared option', () => {
    const source = REPO_STRATEGY.replace(
      'eliminate: [ polyrepo, meta-repo ]',
      'eliminate: [ nope ]',
    );
    const result = loadFramework(source, 'repo-strategy.framework.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((issue) => issue.path === 'rules.0.then.eliminate')).toBe(true);
  });

  it('rejects a rules[].then.prefer id that names no declared option', () => {
    const source = REPO_STRATEGY.replace(
      'prefer: monorepo-single-package',
      'prefer: not-a-real-option',
    );
    const result = loadFramework(source, 'repo-strategy.framework.yaml');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues.some((issue) => issue.path === 'rules.0.then.prefer')).toBe(true);
  });

  it('rejects a "choice" question with no declared options', () => {
    const source = REPO_STRATEGY.replace(
      '    type: choice\n    options: [ always, usually, independent ]',
      '    type: choice',
    );
    const result = loadFramework(source, 'repo-strategy.framework.yaml');
    expect(result.success).toBe(false);
  });
});

describe('readFramework', () => {
  it('reads a real file from disk through ProjectPaths, containment-checked', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-methods-load-'));
    await writeFile(path.join(root, 'repo-strategy.framework.yaml'), REPO_STRATEGY);
    const paths = new ProjectPaths(root);

    const result = await readFramework(paths, 'repo-strategy.framework.yaml');

    expect(result.success).toBe(true);
  });

  it('rejects a path escaping the project root, via ProjectPaths itself, not a raw fs error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-methods-load-'));
    const paths = new ProjectPaths(root);

    await expect(readFramework(paths, '../outside.framework.yaml')).rejects.toThrow();
  });
});
