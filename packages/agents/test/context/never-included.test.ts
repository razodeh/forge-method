/**
 * `05` §5.4 point 7's own negative list -- "never included: secrets, `.env` contents, other lanes'
 * in-flight work, raw event logs" -- asserted as a real negative test against `packForStep`'s own
 * output on a fixture project containing all four, per `PLAN-M6.md` A4's own Checks text ("not merely
 * a documentation claim").
 *
 * @see specs/05 §5.4 point 7
 * @see PLAN-M6.md A4
 */
import { ProjectPaths } from '@forge/core';
import { JsonBackend, parseKbTree, rebuildIndex } from '@forge/kb';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { packForStep, type StepContext } from '../../src/context/pack-for-step.ts';
import type { AgentDefinition } from '../../src/schema/types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const templatesPackageRoot = new ProjectPaths(repoRoot).resolveWithin('packages/templates');

let scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

const SECRET_MARKER = 'sk-live-THIS-IS-A-REAL-LOOKING-SECRET-0123456789';
const ENV_MARKER = 'DATABASE_PASSWORD=hunter2-env-marker';
const OTHER_LANE_MARKER = 'other-lane-in-flight-diff-marker';
const EVENT_LOG_MARKER = 'raw-event-log-line-marker';

/** A real project directory with all four `05` §5.4 point 7 categories present on disk, plus a
 * minimal but real KB tree a genuine step would actually pack from. */
function fixtureProjectWithSensitiveContent(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'forge-agents-never-included-'));
  scratchDirs.push(root);

  // A real KB entry -- the only thing packForStep is actually supposed to draw from.
  const kbDir = path.join(root, 'docs', 'forge', 'kb', 'architecture');
  mkdirSync(kbDir, { recursive: true });
  writeFileSync(
    path.join(kbDir, 'billing.md'),
    [
      '---',
      'id: KB-ARCH-0001',
      'type: knowledge',
      'section: architecture',
      'title: Billing invariants',
      'status: active',
      'confidence: high',
      'owner: architect',
      'sources: [{ kind: human, ref: elicitation }]',
      'created: 2026-01-05',
      'updated: 2026-01-05',
      'review_by: 2026-04-05',
      'supersedes: []',
      'superseded_by: null',
      'related: []',
      'diagrams: []',
      'tags: []',
      'applies_to: []',
      '---',
      '',
      '## Statement',
      'Invoices never total negative.',
      '',
    ].join('\n'),
  );

  // (1) secrets -- a real credentials file, never under docs/forge/kb/.
  mkdirSync(path.join(root, 'secrets'), { recursive: true });
  writeFileSync(
    path.join(root, 'secrets', 'credentials.json'),
    JSON.stringify({ apiKey: SECRET_MARKER }),
  );

  // (2) .env contents.
  writeFileSync(path.join(root, '.env'), `${ENV_MARKER}\n`);

  // (3) another lane's in-flight work -- .forge/state is a real, denied-write namespace elsewhere in
  // this codebase (@forge/core/fs's own DENIED_PREFIXES); this piece never reads it either.
  const otherLaneDir = path.join(root, '.forge', 'state', 'runs', 'run-1', 'lanes', 'other-lane');
  mkdirSync(otherLaneDir, { recursive: true });
  writeFileSync(path.join(otherLaneDir, 'diff.patch'), `${OTHER_LANE_MARKER}\n`);

  // (4) raw event logs.
  const logsDir = path.join(root, '.forge', 'state', 'runs', 'run-1');
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(path.join(logsDir, 'events.ndjson'), `{"event":"${EVENT_LOG_MARKER}"}\n`);

  return root;
}

function minimalAgent(): AgentDefinition {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    tier: 'core',
    mandate: 'test',
    decisions_owned: ['x.y'],
    persona: { voice: 'v', stance: 's', disagreement_style: 'd' },
    inputs: { required: [] },
    outputs: [{ type: 'X', schema: 'x.schema.json', path: 'x.md' }],
    kb_write: [],
    tools: { read: true, write: false, network: false, git_commit: 'none', deploy: false },
    model: { tier: 'balanced', thinking: 'medium' },
    limits: { max_turns: 1, wall_clock_ms: 1, max_cost_usd: 1 },
    parallel_safety: { file_ownership: [], exclusive: false },
    gates: { produces_evidence_for: [], may_approve: [] },
    skills: [],
    prompt: { system: 'p.md' },
  };
}

describe("packForStep never includes 05 §5.4 point 7's own four excluded categories", () => {
  it("a real pack built against a project with secrets/.env/another lane's work/raw event logs on disk contains none of them", async () => {
    const projectRoot = fixtureProjectWithSensitiveContent();
    const paths = new ProjectPaths(projectRoot);
    const tree = await parseKbTree(paths);
    expect(tree.entries.length).toBeGreaterThan(0); // the fixture's own real KB entry did parse

    const backend = new JsonBackend(
      path.join(mkdtempSync(path.join(tmpdir(), 'forge-agents-never-included-idx-')), 'index.json'),
    );
    rebuildIndex(tree, backend);

    const step: StepContext = {
      brief: 'billing invariants',
      declaredInputIds: ['KB-ARCH-0001'],
      produces: [],
      consumes: [],
    };
    const pack = await packForStep(step, minimalAgent(), backend, tree, {
      budgetTokens: 10_000,
      skillsPackBudgetTokens: 8000,
      templatesPackageRoot,
    });

    const serialized = JSON.stringify(pack);
    expect(serialized).toContain('Invoices never total negative.'); // the real KB content IS present
    expect(serialized).not.toContain(SECRET_MARKER);
    expect(serialized).not.toContain(ENV_MARKER);
    expect(serialized).not.toContain(OTHER_LANE_MARKER);
    expect(serialized).not.toContain(EVENT_LOG_MARKER);
  });
});
