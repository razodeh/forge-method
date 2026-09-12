/**
 * `runInferencePhase` — `17` §17.2 phase 4's own real dispatch orchestration, end to end: every accepted
 * finding is `confidence: low|medium`/`status: draft` no matter what a scripted session claimed, read-only
 * dispatch, and the same anti-fabrication check `cartography.test.ts` runs, for INFERENCE's own claim
 * shape.
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

import { runInferencePhase } from '../../src/adopt/inference.ts';
import { createTestContext } from '../dispatch/helpers.ts';
import { fixtureInventory, fixtureSurvey, testAgent } from './fixtures.ts';

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function tempRepo(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'forge-engine-adopt-inference-'));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('runInferencePhase', () => {
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

    await runInferencePhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(seen).toHaveLength(4); // convention, intent, nfr, glossary
    for (const request of seen) {
      expect(request.tools.write).toBe(false);
      expect(request.permissionMode).toBe('deny-unlisted');
      // `20` §20.5 points 1-2: SURVEY/INVENTORY evidence is untrusted brownfield content -- it must be
      // delimited/labelled as data, not interpolated raw into instruction position.
      expect(request.prompt).toContain('FORGE_UNTRUSTED_CONTENT');
      expect(request.prompt).toContain('source="forge-adopt-survey-inventory"');
    }
  });

  it('clamps every accepted finding to confidence low|medium/status draft, even when the session self-reports "verified"', async () => {
    const projectRoot = await tempRepo();
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes('inference:convention'), {
      structured: {
        claims: [
          {
            kind: 'convention',
            statement: 'Route handlers read env vars directly, 1 of 1 checked.',
            confidence: 'verified',
            evidence: [{ kind: 'path', path: 'src/routes.ts' }],
            adherence: { matched: 1, total: 1 },
          },
        ],
      },
    });
    adapter.script(() => true, { structured: { claims: [] } });
    const ctx = createTestContext({ projectRoot, adapter });

    const result = await runInferencePhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding?.confidence).toBe('medium');
    expect(finding?.status).toBe('draft');
    expect(finding?.adherenceRatio).toBe('1 of 1');
  });

  it('rejects a fabricated claim citing evidence outside SURVEY/INVENTORY', async () => {
    const projectRoot = await tempRepo();
    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes('inference:intent'), {
      structured: {
        claims: [
          {
            kind: 'intent',
            statement: 'An invented CacheWarmer exists to pre-load hot data.',
            confidence: 'high',
            evidence: [{ kind: 'path', path: 'src/invented/cache-warmer.ts' }],
          },
        ],
      },
    });
    adapter.script(() => true, { structured: { claims: [] } });
    const ctx = createTestContext({ projectRoot, adapter });

    const result = await runInferencePhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(result.findings).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('evidence not found');
  });

  it('a session with no structured output at all contributes zero claims, not a crash', async () => {
    const projectRoot = await tempRepo();
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, { text: ['no structured output here'] });
    const ctx = createTestContext({ projectRoot, adapter });

    const result = await runInferencePhase({
      ctx,
      architect: testAgent({ id: 'architect' }),
      survey: fixtureSurvey(),
      inventory: fixtureInventory(),
    });

    expect(result.findings).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});
