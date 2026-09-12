/**
 * `writeSurveyReport` — writes `17` §17.2 phase 1's own literal output path, `reports/adoption/
 * survey.json`, through `@forge/core/fs`'s atomic write gate rather than a bare `fs.writeFile`:
 * `specs/02` §2.5 requires every write to the host project to go through it, and a survey report is
 * exactly such a write (unlike the read-only walk that produces its content).
 *
 * @see specs/17 §17.2
 * @see specs/02 §2.5
 * @see PLAN-M10.md P15
 */
import { ensureDir, writeFileAtomic, type ProjectPaths } from '@forge/core/fs';

import type { SurveyResult } from './survey.ts';

export const SURVEY_REPORT_RELATIVE_PATH = 'reports/adoption/survey.json';

/**
 * @param paths a `ProjectPaths` rooted at the same directory `runSurvey` walked — passing a different
 * root would write a real report describing a different repository, so this takes the whole gate
 * rather than a bare path to make that pairing explicit at every call site.
 */
export async function writeSurveyReport(paths: ProjectPaths, result: SurveyResult): Promise<void> {
  const target = paths.resolveWithin(SURVEY_REPORT_RELATIVE_PATH);
  await ensureDir(paths.resolveWithin('reports/adoption'));
  await writeFileAtomic(target, `${JSON.stringify(result, null, 2)}\n`);
}
