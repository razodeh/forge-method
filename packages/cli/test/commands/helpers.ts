/**
 * Shared test setup for `@forge/cli/commands` — a real temp project directory, a real `ProjectPaths`,
 * and small real fixture content (a KB entry, an ADR via the real `adrNew`, a diagram sidecar, one
 * spec-type artifact) every command-family test file builds on rather than re-deriving.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
// Genuinely test-only (unrecognised by the `*.test.ts`/`test/**` exemption globs since this file's
// own name doesn't match either — the identical shape `packages/kb/test/lint/factories.ts` and
// `packages/engine/test/dispatch/helpers.ts` are already exempted for): every real caller is itself
// a `*.test.ts` file that only ever needs an isolated scratch directory, never a real host-machine
// fact used for behaviour.
// eslint-disable-next-line no-restricted-imports -- see comment above
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readArtifactTemplate } from '../../src/commands/shared.ts';

import { ProjectPaths } from '@forge/core/fs';

export const KB_ROOT = 'docs/forge/kb';
export const SPECS_ROOT = 'docs/forge/specs';

export interface TestProject {
  readonly dir: string;
  readonly paths: ProjectPaths;
}

const cleanupDirs: string[] = [];

export function registerCleanup(dir: string): void {
  cleanupDirs.push(dir);
}

export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function createTestProject(): Promise<TestProject> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-commands-'));
  registerCleanup(dir);
  await mkdir(path.join(dir, KB_ROOT), { recursive: true });
  return { dir, paths: new ProjectPaths(dir) };
}

/** A real, schema-valid KB entry (`kbEntrySchema`) — hand-built since there is no `kb new` command
 * to derive it from. */
export async function writeKbEntryFixture(
  project: TestProject,
  id = 'KB-ARCH-0001',
  options: { readonly related?: readonly string[] } = {},
): Promise<string> {
  const relPath = `${KB_ROOT}/architecture/${id}.md`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const related = options.related ?? [];
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
related: [${related.join(', ')}]
diagrams: []
tags: []
applies_to: []
---

## Verification

Confirmed directly against the real system.
`;
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}

/** A real, schema-valid diagram sidecar (`diagramSchema`, parsed as plain YAML, not front matter). */
export async function writeDiagramFixture(project: TestProject, id = 'DIAG-001'): Promise<string> {
  const relPath = `${KB_ROOT}/architecture/views/fixture.mmd.yaml`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const content = `id: ${id}
type: Diagram
schemaVersion: 1
title: Fixture diagram
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
kind: flowchart
notation: mermaid
source: |
  flowchart TD
    A --> B
generated: false
depicts: []
explains: []
caption: A fixture flowchart.
alt_text: A fixture flowchart from A to B.
owner: architect
`;
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}

/** A real, schema-valid diagram sidecar that declares a real generator (`deps-to-graph`) — for
 * exercising `diagramDiff`/`diagramSync`'s own real `checkDrift` call, which the plain, no-generator
 * fixture above cannot (it only ever hits `checkDrift`'s own `KB-003` "no generator" refusal). */
export async function writeGeneratedDiagramFixture(
  project: TestProject,
  id = 'DIAG-002',
): Promise<string> {
  const relPath = `${KB_ROOT}/architecture/views/generated-${id}.mmd.yaml`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const content = `id: ${id}
type: Diagram
schemaVersion: 1
title: Generated fixture diagram
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
kind: flowchart
notation: mermaid
source: |
  flowchart TB
    a --> b
generated: true
generator: deps-to-graph
depicts: []
explains: []
caption: A generated fixture flowchart.
alt_text: A generated fixture flowchart from a to b.
owner: architect
`;
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}

/** A real runbook, scaffolded from `@forge/templates`' own real `Runbook.md` template (the exact
 * worked example content, not a hand-rolled one) — the file *name* is what `classifyFile`'s own
 * `ops/runbooks/RUN-###-<slug>.md` pattern dispatches on, so it must match regardless of the id the
 * real template content already carries. */
export async function writeRunbookFixture(project: TestProject): Promise<string> {
  const relPath = `${KB_ROOT}/ops/runbooks/RUN-001-fixture.md`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const content = await readArtifactTemplate('Runbook');
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}

/** One of the five real `collection: true` "register" files `classifyFile` dispatches on by exact,
 * fixed path (`risks.md`, `assumptions.md`, `open-questions.md`, `delivery/environments.md`,
 * `architecture/components.md`) — all five share one real shape (`baseFrontMatterShape` minus `id`,
 * plus a `type` literal and one array field, itself allowed to be empty), so one generic writer
 * covers all five real fixtures `summarize`'s own switch needs to be genuinely exercised for. */
export async function writeCollectionFileFixture(
  project: TestProject,
  relativeToKbRoot: string,
  type: string,
  arrayField: string,
): Promise<string> {
  const relPath = `${KB_ROOT}/${relativeToKbRoot}`;
  await mkdir(path.dirname(path.join(project.dir, relPath)), { recursive: true });
  const content = `---
type: ${type}
schemaVersion: 1
title: Fixture ${type} register
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
${arrayField}: []
---
`;
  await writeFile(path.join(project.dir, relPath), content);
  return relPath;
}
