/**
 * `runCartographyPhase` — `17` §17.2 phase 3's own real dispatch orchestration, end to end against a
 * real `FakePlatformAdapter`: read-only session construction, and the anti-fabrication check surviving
 * a real scripted adapter response that invents a component outside the fixture's own evidence.
 *
 * @see specs/17 §17.2
 * @see specs/20 §20.5
 * @see PLAN-M10.md P16
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import type { SessionRequest } from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { runCartographyPhase } from '../../src/adopt/cartography.ts';
import { createTestContext } from '../dispatch/helpers.ts';
import { fixtureInventory, fixtureSurvey, testAgent } from './fixtures.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function tempRepo(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-engine-adopt-cartography-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('runCartographyPhase', () => {
  it('dispatches every session read-only -- write:false, deny-unlisted, no lane', async () => {
    const projectRoot = await tempRepo();
    const seen: SessionRequest[] = [];
    const adapter = new FakePlatformAdapter();
    adapter.script(
      (request) => {
        seen.push(request);
        return true;
      },
      { structured: { claims: [] } },
    );
    const ctx = createTestContext({ projectRoot, adapter });

    await runCartographyPhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      dataArchitect: testAgent({ id: 'data-architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(seen).toHaveLength(5); // one per CARTOGRAPHY category
    for (const request of seen) {
      expect(request.tools.write).toBe(false);
      expect(request.permissionMode).toBe('deny-unlisted');
      expect(request.cwd).toBe(projectRoot);
      // `20` §20.5 points 1-2: SURVEY/INVENTORY evidence is untrusted brownfield content -- it must be
      // delimited/labelled as data, not interpolated raw into instruction position.
      expect(request.prompt).toContain('FORGE_UNTRUSTED_CONTENT');
      expect(request.prompt).toContain('source="forge-adopt-survey-inventory"');
    }
  });

  it('accepts a real, evidence-backed claim and rejects a fabricated one in the same run -- the central anti-fabrication check', async () => {
    const projectRoot = await tempRepo();
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes('cartography:component'), {
      structured: {
        claims: [
          {
            kind: 'component',
            statement: 'A routing component lives at src/routes.ts.',
            confidence: 'high',
            evidence: [{ kind: 'path', path: 'src/routes.ts' }],
          },
          {
            kind: 'component',
            // Invents a component with no basis in fixtureInventory()/fixtureSurvey() at all.
            statement: 'An AuditTrailService exists to record every mutation.',
            confidence: 'high',
            evidence: [{ kind: 'path', path: 'src/invented/audit-trail-service.ts' }],
          },
        ],
      },
    });
    adapter.script(() => true, { structured: { claims: [] } });
    const ctx = createTestContext({ projectRoot, adapter });

    const result = await runCartographyPhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      dataArchitect: testAgent({ id: 'data-architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(result.findings.some((f) => f.statement.includes('routing component'))).toBe(true);
    expect(result.findings.some((f) => f.statement.includes('AuditTrailService'))).toBe(false);
    expect(result.rejected.some((r) => r.claim.statement.includes('AuditTrailService'))).toBe(true);
  });

  it('flags a seeded shared-write table produced by two real, evidence-backed data-ownership claims', async () => {
    const projectRoot = await tempRepo();
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes('cartography:data-ownership'), {
      structured: {
        claims: [
          {
            kind: 'data-ownership',
            statement: 'The routes module writes the users table.',
            confidence: 'medium',
            evidence: [{ kind: 'path', path: 'src/routes.ts' }],
            table: 'users',
            owner: 'routes-component',
          },
          {
            kind: 'data-ownership',
            statement: 'The db module also writes the users table.',
            confidence: 'medium',
            evidence: [{ kind: 'path', path: 'src/db.ts' }],
            table: 'users',
            owner: 'db-component',
          },
        ],
      },
    });
    adapter.script(() => true, { structured: { claims: [] } });
    const ctx = createTestContext({ projectRoot, adapter });

    const result = await runCartographyPhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      dataArchitect: testAgent({ id: 'data-architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(result.sharedWriteTables).toEqual([
      { table: 'users', owners: ['db-component', 'routes-component'] },
    ]);
  });

  it('a session with no structured output at all contributes zero claims, not a crash', async () => {
    const projectRoot = await tempRepo();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['no structured output here'] });
    const ctx = createTestContext({ projectRoot, adapter });

    const result = await runCartographyPhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      dataArchitect: testAgent({ id: 'data-architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(result.findings).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});
