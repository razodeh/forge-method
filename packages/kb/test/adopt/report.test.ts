/**
 * `writeSurveyReport` — the write path (through `@forge/core/fs`'s atomic gate, per `specs/02` §2.5)
 * for `17` §17.2 phase 1's own literal output path, `reports/adoption/survey.json`.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { SURVEY_REPORT_RELATIVE_PATH, writeSurveyReport } from '../../src/adopt/report.ts';
import { runSurvey, type SurveyResult } from '../../src/adopt/survey.ts';
import { nodeFixtureFiles, populateFixture, STUB_GIT_PROFILE } from './fixtures.ts';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function buildNodeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-kb-adopt-report-'));
  cleanupDirs.push(dir);
  await populateFixture(dir, nodeFixtureFiles());
  return dir;
}

async function readReport(rootDir: string): Promise<SurveyResult> {
  const text = await readFile(path.join(rootDir, SURVEY_REPORT_RELATIVE_PATH), 'utf8');
  return JSON.parse(text) as SurveyResult;
}

describe('writeSurveyReport', () => {
  it('writes the exact result to reports/adoption/survey.json, creating the directory', async () => {
    const rootDir = await buildNodeFixture();
    const result = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
    const paths = new ProjectPaths(rootDir);

    await writeSurveyReport(paths, result);

    expect(SURVEY_REPORT_RELATIVE_PATH).toBe('reports/adoption/survey.json');
    expect(await readReport(rootDir)).toEqual(result);
  });

  it('overwrites a previous report rather than merging with it', async () => {
    const rootDir = await buildNodeFixture();
    const paths = new ProjectPaths(rootDir);

    const first = await runSurvey({ rootDir, gitProfile: STUB_GIT_PROFILE });
    await writeSurveyReport(paths, first);

    const second = await runSurvey({
      rootDir,
      gitProfile: { ...STUB_GIT_PROFILE, commitCount: 99 },
    });
    await writeSurveyReport(paths, second);

    const written = await readReport(rootDir);
    expect(written.survey.gitProfile.commitCount).toBe(99);
  });
});
