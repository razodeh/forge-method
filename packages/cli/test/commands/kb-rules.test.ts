/**
 * `forge kb lint --rule adr-coverage` (`G-Design`) and `--rule kb-synced` (`G-Operate`), `PLAN-M13.md` P25, Q219.
 *
 * Fixtures are the shipped greenfield-service KB tree (a real, internally consistent tree with two components and
 * their owning ADRs) copied into a temp project, then broken one way per test.
 *
 * @see specs/08 §8.7, §8.9
 * @see specs/10 §10.3
 */
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { kbSync, type KbCommandContext } from '../../src/commands/kb.ts';
import { kbLintRule, type KbLintRuleId } from '../../src/commands/kb-rules.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

const FIXTURE_KB = fileURLToPath(
  new URL('../../../../fixtures/greenfield-service/docs/forge/kb', import.meta.url),
);

function ctx(project: TestProject): KbCommandContext {
  return { paths: project.paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: 'L2', env: {} };
}

async function fixtureProject(): Promise<TestProject> {
  const project = await createTestProject();
  await cp(FIXTURE_KB, path.join(project.dir, KB_ROOT), { recursive: true });
  return project;
}

async function findings(project: TestProject, rule: KbLintRuleId) {
  return (await kbLintRule(ctx(project), rule)).findings;
}

describe('adr-coverage', () => {
  it('passes the shipped greenfield KB: every component has an owning ADR', async () => {
    expect(await findings(await fixtureProject(), 'adr-coverage')).toEqual([]);
  });

  it('fails each component with no owning ADR, by component id, with a remedy', async () => {
    const project = await fixtureProject();
    // Remove every KB entry that ties a component to a decision: the ADR files stay, the ownership goes.
    const decisions = path.join(project.dir, KB_ROOT, 'decisions');
    const adrFiles = (await readdir(decisions)).filter((name) => name.startsWith('ADR-'));
    expect(adrFiles.length).toBeGreaterThan(0);
    for (const file of adrFiles) await rm(path.join(decisions, file));
    const found = await findings(project, 'adr-coverage');
    expect(found.map((finding) => finding.entryId)).toEqual(['component:api', 'component:db']);
    for (const finding of found) {
      expect(finding.ruleId).toBe('kb:component-coverage');
      expect(finding.severity).toBe('error');
      expect(finding.remedy).toMatch(/^Write /);
    }
  });

  it('fails when there is no components register: with nothing registered, coverage cannot be shown', async () => {
    const project = await fixtureProject();
    await rm(path.join(project.dir, KB_ROOT, 'architecture', 'components.md'));
    const found = await findings(project, 'adr-coverage');
    expect(found).toHaveLength(1);
    expect(found[0]?.ruleId).toBe('kb:component-coverage');
    expect(found[0]?.message).toContain('No components register');
  });

  it('fails an empty KB (a project that has recorded no architecture)', async () => {
    const project = await createTestProject();
    const found = await findings(project, 'adr-coverage');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No components register');
  });

  it('fails a components register with no components in it', async () => {
    const project = await fixtureProject();
    const file = path.join(project.dir, KB_ROOT, 'architecture', 'components.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/components:[\s\S]*?\n---/, 'components: []\n---'));
    const found = await findings(project, 'adr-coverage');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No components register');
  });

  it('an unreadable components register, or ADR, is a finding, never a pass', async () => {
    const project = await fixtureProject();
    await writeFile(
      path.join(project.dir, KB_ROOT, 'architecture', 'components.md'),
      '---\nnot: valid\n---\n',
    );
    const found = await findings(project, 'adr-coverage');
    expect(found.some((finding) => finding.ruleId === 'kb:schema')).toBe(true);
    expect(found.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('a malformed ADR file fails even though the coverage that remains is satisfied', async () => {
    const project = await fixtureProject();
    await writeFile(
      path.join(project.dir, KB_ROOT, 'decisions', 'ADR-9999-broken.md'),
      '---\ntype: ADR\n---\nnot a valid ADR\n',
    );
    const found = await findings(project, 'adr-coverage');
    expect(found.map((finding) => finding.ruleId)).toEqual(['kb:schema']);
    expect(found[0]?.message).toContain('ADR-9999-broken.md');
  });

  it('a KB root that is a plain file is a finding', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, KB_ROOT), { recursive: true, force: true });
    await mkdir(path.dirname(path.join(project.dir, KB_ROOT)), { recursive: true });
    await writeFile(path.join(project.dir, KB_ROOT), 'a file where the KB directory should be');
    const found = await findings(project, 'adr-coverage');
    expect(found.some((finding) => finding.ruleId === 'kb:schema')).toBe(true);
  });

  it('a decision that is not in force owns nothing: rejected and deprecated ADRs leave the component uncovered, and say why', async () => {
    for (const status of ['rejected', 'deprecated']) {
      const project = await fixtureProject();
      const decisions = path.join(project.dir, KB_ROOT, 'decisions');
      for (const file of await readdir(decisions)) {
        if (!file.startsWith('ADR-')) continue;
        const text = await readFile(path.join(decisions, file), 'utf8');
        await writeFile(
          path.join(decisions, file),
          text.replace(/^status: .*$/m, `status: ${status}`),
        );
      }
      const found = await findings(project, 'adr-coverage');
      expect(
        found.some((finding) => finding.ruleId === 'kb:component-coverage'),
        status,
      ).toBe(true);
    }
  });

  it('a corrupt spec document does not stop it: the rule reads the KB only, and a refusal is not a verdict', async () => {
    const project = await fixtureProject();
    await mkdir(path.join(project.dir, SPECS_ROOT, 'capabilities'), { recursive: true });
    await writeFile(
      path.join(project.dir, SPECS_ROOT, 'capabilities', 'CAP-001.md'),
      '---\nnot: [closed\n---\n',
    );
    expect(await findings(project, 'adr-coverage')).toEqual([]);
  });

  it('reports only this rule: an unrelated lint error (a dangling reference) does not fail it', async () => {
    const project = await fixtureProject();
    const decisions = path.join(project.dir, KB_ROOT, 'decisions');
    const adrFile = (await readdir(decisions)).find((name) => name.startsWith('ADR-')) ?? '';
    const file = path.join(decisions, adrFile);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/^related:.*$/m, 'related: [ADR-9998]'));
    expect(await findings(project, 'adr-coverage')).toEqual([]);
  });

  it('is deterministic and sorted', async () => {
    const project = await fixtureProject();
    const decisions = path.join(project.dir, KB_ROOT, 'decisions');
    for (const file of await readdir(decisions)) {
      if (file.startsWith('ADR-')) await rm(path.join(decisions, file));
    }
    const first = JSON.stringify(await findings(project, 'adr-coverage'));
    expect(first).toBe(JSON.stringify(await findings(project, 'adr-coverage')));
  });
});

describe('kb-synced', () => {
  async function indexBytes(project: TestProject): Promise<Record<string, string>> {
    const state = path.join(project.dir, '.forge', 'state');
    const out: Record<string, string> = {};
    for (const name of await readdir(state).catch(() => [] as string[])) {
      if (name.startsWith('index.'))
        out[name] = (await readFile(path.join(state, name))).toString('base64');
    }
    return out;
  }

  it('fails a project whose KB was never synced, naming the command that fixes it', async () => {
    const project = await fixtureProject();
    const found = await findings(project, 'kb-synced');
    expect(found).toHaveLength(1);
    expect(found[0]?.ruleId).toBe('kb:sync');
    expect(found[0]?.message).toContain('never been built');
    expect(found[0]?.remedy).toBe('Run `forge kb sync`, then run the check again.');
  });

  it('fails an empty, never-synced KB too (it is the index that is absent)', async () => {
    const project = await createTestProject();
    expect((await findings(project, 'kb-synced'))[0]?.message).toContain('never been built');
  });

  it('passes right after `forge kb sync`, and running the check writes nothing', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    const before = await indexBytes(project);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    expect(await findings(project, 'kb-synced')).toEqual([]);
    expect(await indexBytes(project)).toEqual(before);
  });

  it('passes an empty KB that was synced', async () => {
    const project = await createTestProject();
    await kbSync(ctx(project));
    expect(await findings(project, 'kb-synced')).toEqual([]);
  });

  it('fails an entry edited since the last sync, by id', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    const decisions = path.join(project.dir, KB_ROOT, 'decisions');
    const adrFile = (await readdir(decisions)).find((name) => name.startsWith('ADR-')) ?? '';
    const file = path.join(decisions, adrFile);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/^title: .*$/m, 'title: Edited by a human after the sync'));
    const found = await findings(project, 'kb-synced');
    expect(found).toHaveLength(1);
    expect(found[0]?.ruleId).toBe('kb:sync');
    expect(found[0]?.entryId).toMatch(/^ADR-/);
    expect(found[0]?.message).toContain('changed since the last sync');
  });

  it('fails an entry added since the last sync, and one deleted since', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    const decisions = path.join(project.dir, KB_ROOT, 'decisions');
    const adrFiles = (await readdir(decisions)).filter((name) => name.startsWith('ADR-')).sort();
    const removed = adrFiles[0] ?? '';
    const text = await readFile(path.join(decisions, removed), 'utf8');
    await rm(path.join(decisions, removed));
    await writeFile(
      path.join(decisions, 'ADR-8888-added.md'),
      text.replace(/^id: .*$/m, 'id: ADR-8888').replace(/^title: .*$/m, 'title: Added'),
    );
    const found = await findings(project, 'kb-synced');
    const messages = found.map((finding) => finding.message).join('\n');
    expect(messages).toContain('not in the index');
    expect(messages).toContain('no longer in the KB');
  });

  it('an edit the index cannot see is still an edit: an ADR body, the components register, the environments register, a runbook', async () => {
    const targets = [
      'decisions/ADR-0001-use-postgresql.md',
      'architecture/components.md',
      'delivery/environments.md',
      'ops/runbooks/RUN-001-restart-api.md',
    ];
    for (const relative of targets) {
      const project = await fixtureProject();
      const file = path.join(project.dir, KB_ROOT, relative);
      await kbSync(ctx(project));
      expect(await findings(project, 'kb-synced'), relative).toEqual([]);
      await writeFile(
        file,
        `${await readFile(file, 'utf8')}\nA line a human added after the sync.\n`,
      );
      const found = await findings(project, 'kb-synced');
      expect(found.map((finding) => finding.message).join('\n'), relative).toContain(relative);
    }
  });

  it('a KB synced before the sync record existed is not synced: edits since cannot be ruled out', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    await rm(path.join(project.dir, '.forge', 'state', 'kb-files.json'));
    const found = await findings(project, 'kb-synced');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No record of the KB files');
    await kbSync(ctx(project));
    expect(await findings(project, 'kb-synced')).toEqual([]);
  });

  it('a corrupt index.db does not make `forge kb sync` a remedy that never works', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    await writeFile(path.join(project.dir, '.forge', 'state', 'index.db'), 'corrupt');
    expect((await findings(project, 'kb-synced')).length).toBeGreaterThan(0);
    await kbSync(ctx(project));
    expect(await findings(project, 'kb-synced')).toEqual([]);
  });

  it('`forge kb sync` still succeeds when one KB file cannot be read, and the check reports that file', async () => {
    const project = await fixtureProject();
    await symlink('/nonexistent/target', path.join(project.dir, KB_ROOT, 'dangling.md'));
    await expect(kbSync(ctx(project))).resolves.toBeDefined();
    const found = await findings(project, 'kb-synced');
    expect(found.some((finding) => finding.ruleId === 'kb:schema')).toBe(true);
  });

  it('a KB file that fails its schema is a finding, because it cannot be synced', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    await writeFile(
      path.join(project.dir, KB_ROOT, 'decisions', 'ADR-9999-broken.md'),
      '---\ntype: ADR\n---\n',
    );
    const found = await findings(project, 'kb-synced');
    expect(found.some((finding) => finding.ruleId === 'kb:schema')).toBe(true);
  });

  it('an unreadable index is a finding, and is left as it was', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    const state = path.join(project.dir, '.forge', 'state');
    const target = (await readdir(state)).find((name) => /^index\.(db|json)$/.test(name)) ?? '';
    await writeFile(path.join(state, target), 'corrupt');
    const found = await findings(project, 'kb-synced');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('could not be read');
    expect(await readFile(path.join(state, target), 'utf8')).toBe('corrupt');
  });

  it('is deterministic', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    await rm(path.join(project.dir, KB_ROOT, 'architecture', 'components.md'));
    const first = JSON.stringify(await findings(project, 'kb-synced'));
    expect(first).toBe(JSON.stringify(await findings(project, 'kb-synced')));
  });

  it('the project files are untouched by either rule', async () => {
    const project = await fixtureProject();
    await kbSync(ctx(project));
    const listing = async () =>
      (await readdir(path.join(project.dir, KB_ROOT), { recursive: true })).sort();
    const before = await listing();
    await findings(project, 'kb-synced');
    await findings(project, 'adr-coverage');
    expect(await listing()).toEqual(before);
    expect(new ProjectPaths(project.dir).resolveWithin('.')).toBeTruthy();
  });
});
