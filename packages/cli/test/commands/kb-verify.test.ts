/**
 * `forge kb verify` — `17` §17.4 point 6 / §17.6: "run stored verification commands." Exercised
 * against a real, on-disk KB entry and a real, spawned subprocess — the literal `PLAN-M10.md` P20
 * exit check: "`forge kb verify` against a fixture whose verified build command now fails reports real
 * drift."
 *
 * @see specs/17 §17.4
 * @see specs/17 §17.6
 * @see PLAN-M10.md P20
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { kbVerify, type KbCommandContext } from '../../src/commands/kb.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject): KbCommandContext {
  return { paths: project.paths, kbRoot: KB_ROOT, specsRoot: SPECS_ROOT, level: 'L1' };
}

/** A real, schema-valid, `confidence: verified` KB entry whose `## Verification` section carries the
 * exact `` Command: `<cmd>` `` convention `reconstruction.ts` writes. */
async function writeVerifiedEntryWithCommand(
  project: TestProject,
  id: string,
  command: string | undefined,
): Promise<string> {
  const relPath = `${KB_ROOT}/architecture/${id}.md`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const verificationBody =
    command === undefined
      ? 'Confirmed directly against the real system.'
      : `This check passed; see the Verification section for what was actually observed.\n\nCommand: \`${command}\``;
  const content = `---
id: ${id}
type: knowledge
section: architecture
title: Fixture knowledge entry
status: active
confidence: verified
owner: architect
sources:
  - kind: decision
    ref: ADR-0001
created: 2026-01-01
updated: 2026-01-01
review_by: 2026-06-01
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

## Verification

${verificationBody}
`;
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}

async function writeDraftEntry(project: TestProject, id: string): Promise<string> {
  const relPath = `${KB_ROOT}/architecture/${id}.md`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const content = `---
id: ${id}
type: knowledge
section: architecture
title: Fixture draft entry
status: active
confidence: low
owner: architect
sources:
  - kind: decision
    ref: ADR-0001
created: 2026-01-01
updated: 2026-01-01
review_by: 2026-06-01
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

## Statement

Nothing verified about this one yet.
`;
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}

describe('kbVerify', () => {
  it('reports a passing command as pass', async () => {
    const project = await createTestProject();
    await writeVerifiedEntryWithCommand(project, 'KB-ARCH-0001', 'exit 0');

    const findings = await kbVerify(ctx(project));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'KB-ARCH-0001', command: 'exit 0', outcome: 'pass' });
  });

  it('reports real drift when a previously-verified command now fails', async () => {
    const project = await createTestProject();
    await writeVerifiedEntryWithCommand(project, 'KB-ARCH-0002', 'exit 1');

    const findings = await kbVerify(ctx(project));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.outcome).toBe('fail');
    expect(findings[0]?.detail).toContain('exited 1');
  });

  it('skips an entry whose Verification section has no machine-runnable command', async () => {
    const project = await createTestProject();
    await writeVerifiedEntryWithCommand(project, 'KB-ARCH-0003', undefined);

    const findings = await kbVerify(ctx(project));

    expect(findings).toEqual([
      expect.objectContaining({ id: 'KB-ARCH-0003', command: undefined, outcome: 'skipped' }),
    ]);
  });

  it('never checks a non-verified entry at all', async () => {
    const project = await createTestProject();
    await writeDraftEntry(project, 'KB-ARCH-0004');

    const findings = await kbVerify(ctx(project));

    expect(findings).toEqual([]);
  });

  it('reports a signal-terminated command honestly, never as a fabricated exit code', async () => {
    const project = await createTestProject();
    await writeVerifiedEntryWithCommand(project, 'KB-ARCH-0005', 'kill -9 $$');

    const findings = await kbVerify(ctx(project));

    expect(findings[0]?.outcome).toBe('fail');
    expect(findings[0]?.detail).toContain('terminated by signal');
  });

  it('checks every verified entry independently, one failure does not hide another result', async () => {
    const project = await createTestProject();
    await writeVerifiedEntryWithCommand(project, 'KB-ARCH-0006', 'exit 0');
    await writeVerifiedEntryWithCommand(project, 'KB-ARCH-0007', 'exit 1');

    const findings = await kbVerify(ctx(project));

    expect(findings).toHaveLength(2);
    const byId = new Map(findings.map((f) => [f.id, f.outcome]));
    expect(byId.get('KB-ARCH-0006')).toBe('pass');
    expect(byId.get('KB-ARCH-0007')).toBe('fail');
  });
});
