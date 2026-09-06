/**
 * `parseSkillPackage` — reads `15` §15.4.2's `SKILL.md` package layout off disk.
 *
 * @see specs/15 §15.4.2
 * @see PLAN-M2.md P4
 */
import {
  listDirEntriesSorted,
  parseFrontMatterYaml,
  pathExists,
  readTextFile,
  splitFrontMatter,
  type AbsolutePath,
} from '@forge/core';
import path from 'node:path';

import type { ParsedSkill } from './types.ts';

/**
 * A path under `dir`, an already-validated `AbsolutePath` the caller resolved (typically via
 * `ProjectPaths.resolveWithin`) before calling this module at all. `segments` are fixed, code-written
 * literals (`'SKILL.md'`, `'references'`, …) or names already listed by `listDirEntriesSorted` reading
 * `dir` itself — never unvalidated external input — so joining them can never escape `dir`'s own
 * containment.
 */
function child(dir: AbsolutePath, ...segments: string[]): AbsolutePath {
  return path.join(dir, ...segments) as AbsolutePath;
}

/** Every file name directly inside `dir`'s `subdirectory`, sorted — `[]` if it does not exist. */
async function listSubdirectoryFiles(
  dir: AbsolutePath,
  subdirectory: string,
): Promise<readonly string[]> {
  const target = child(dir, subdirectory);
  if (!(await pathExists(target))) return [];
  const entries = await listDirEntriesSorted(target);
  return entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);
}

/**
 * Reads and parses `dir`'s `SKILL.md`, plus every file directly under its `references/` and
 * `scripts/` directories (`examples/`/`assets/` are optional per `15` §15.4.2 but neither is read by
 * any of this piece's own Checks, so listing them is deferred to whichever future piece needs to).
 *
 * Only the `---`-delimited structure is parsed here — `frontMatter` comes back as plain, unvalidated
 * data. Whether it actually matches `skillFrontMatterSchema` is `validateSkill`'s own check (`15`
 * §15.4.5 lists "front matter schema" as one thing among several `forge skill validate` checks, not a
 * precondition for the others), so a schema-invalid `SKILL.md` still parses successfully here.
 *
 * @throws {ForgeError} `CFG-005`/`CFG-006`/`CFG-007` for malformed front-matter delimiters or
 * non-YAML content (`@forge/core/artifacts`'s own codes — a `SKILL.md` file uses the identical
 * `---`-delimited format) — a document this broken has nothing for any check to run against at all.
 */
export async function parseSkillPackage(dir: AbsolutePath): Promise<ParsedSkill> {
  const skillFilePath = child(dir, 'SKILL.md');
  const source = await readTextFile(skillFilePath);
  const split = splitFrontMatter(source, skillFilePath);
  const frontMatter = parseFrontMatterYaml(split.frontMatterText, skillFilePath);

  const [referenceFiles, scriptFiles] = await Promise.all([
    listSubdirectoryFiles(dir, 'references'),
    listSubdirectoryFiles(dir, 'scripts'),
  ]);

  return {
    dir,
    skillFilePath,
    frontMatter,
    body: split.body,
    referenceFiles,
    scriptFiles,
  };
}
