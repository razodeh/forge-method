/**
 * `writeInitTree` — `03` §3.3's own "Files written by `init`" section, the real writes.
 *
 * @see specs/03 §3.3
 */
import path from 'node:path';

import { pathExists, type ProjectPaths, readTextFile, writeFileAtomic } from '@forge/core';
import { applyPreset } from '@forge/extensions/presets';
import type { ForgeConfig } from '@forge/schemas/config';
import type { PlatformAdapter } from '@forge/adapter-kit/types';
import * as YAML from 'yaml';

import {
  type ConflictHandlingOptions,
  extractGeneratedHeader,
  hasGeneratedFileDrifted,
  resolveGeneratedConflict,
} from '../generated-header.ts';
import {
  readArtifactTemplateFiles,
  readBriefFiles,
  readCheckFiles,
  readFrameworkFiles,
  readPromptFiles,
  readResolvedAgents,
  readSkillFiles,
  readTechniqueFiles,
  readWorkflowFiles,
  type ContentFile,
} from './content.ts';
import { withGeneratedHeader } from './generated-header.ts';
import { sha256 } from './hash.ts';
import { buildManifest } from './manifest.ts';
import { readPackageVersion } from './package-root.ts';
import type { InitOptions, WrittenFile } from './types.ts';

export interface WriteTreeInput {
  readonly target: ProjectPaths;
  readonly modulesDir: string;
  readonly options: InitOptions;
  readonly config: ForgeConfig;
  readonly primary: PlatformAdapter;
  /** `--idea-file`'s own real content, already read by `runInit` (relative to the real invocation
   * cwd, which this function has no access to and should not need). `undefined` when not given. */
  readonly ideaContent: string | undefined;
}

/**
 * Writes one regenerable file, real header/hash stamped, honoring `03` §3.3's own "a modified hash is
 * never silently overwritten" rule when a real, drifted file already exists at `destRelPath` — the
 * one real place both `runInit`'s re-init path and `runUpgrade`'s regeneration step actually go
 * through, so neither can silently clobber a human's local edit to a generated file.
 *
 * A file that does not exist yet (ordinary first-time `init`) or exists but has not drifted (its
 * recorded hash still matches its real current body) is written/overwritten unconditionally, exactly
 * as before this piece — the conflict-resolution path only ever runs for a real, detected drift.
 */
async function writeGenerated(
  target: ProjectPaths,
  destRelPath: string,
  file: ContentFile,
  version: string,
  conflictOptions: ConflictHandlingOptions | undefined,
): Promise<WrittenFile> {
  const hash = sha256(file.content);
  const newContent = withGeneratedHeader(file.content, destRelPath, version, hash);
  const resolvedPath = target.resolveWithin(destRelPath);

  if (await pathExists(resolvedPath)) {
    const diskContent = await readTextFile(resolvedPath);
    if (hasGeneratedFileDrifted(diskContent)) {
      const resolution = await resolveGeneratedConflict(
        { path: destRelPath, diskContent, newContent },
        conflictOptions ?? {},
      );
      if (resolution.mode === 'keep-mine') {
        return { path: destRelPath, generated: true, conflict: resolution.mode };
      }
      // `resolution.writePath` is `destRelPath` itself for `take-theirs`, or a real
      // `${destRelPath}${MERGE_SIDECAR_SUFFIX}` sidecar for `merge` — see `resolveGeneratedConflict`'s
      // own doc comment for why a true three-way merge is not feasible here.
      await writeFileAtomic(
        target.resolveWithin(resolution.writePath ?? destRelPath),
        resolution.content ?? newContent,
      );
      return { path: destRelPath, generated: true, conflict: resolution.mode };
    }
  }

  await writeFileAtomic(resolvedPath, newContent);
  return { path: destRelPath, generated: true };
}

async function writeGeneratedDir(
  target: ProjectPaths,
  destDir: string,
  files: readonly ContentFile[],
  version: string,
  conflictOptions: ConflictHandlingOptions | undefined,
): Promise<readonly WrittenFile[]> {
  const written: WrittenFile[] = [];
  for (const file of files) {
    written.push(
      await writeGenerated(
        target,
        path.posix.join(destDir, file.relPath),
        file,
        version,
        conflictOptions,
      ),
    );
  }
  return written;
}

/** Everything under `.forge/` except `config.yaml` itself — see `writeInitTree`'s own doc comment for
 * why `config.yaml` is written separately, last. */
async function writeConfigLocalAndManifest(
  target: ProjectPaths,
  modulesDir: string,
  options: InitOptions,
): Promise<readonly WrittenFile[]> {
  await writeFileAtomic(
    target.resolveWithin('.forge/config.local.yaml'),
    '# Personal overrides for this project — gitignored, never committed.\n',
  );
  const manifest = await buildManifest(modulesDir, options.modules ?? []);
  await writeFileAtomic(target.resolveWithin('.forge/manifest.yaml'), YAML.stringify(manifest));
  return [
    { path: '.forge/config.local.yaml', generated: false },
    { path: '.forge/manifest.yaml', generated: false },
  ];
}

async function writeConfigYaml(target: ProjectPaths, config: ForgeConfig): Promise<WrittenFile> {
  await writeFileAtomic(target.resolveWithin('.forge/config.yaml'), YAML.stringify(config));
  return { path: '.forge/config.yaml', generated: false };
}

/** One real category of regenerable content, materialised under `destDir` — the writer's own real
 * traversal order below, factored out so `writeRegenerableContent` (write) and `planRegenerableContent`
 * (read-only classify, `PLAN-M14.md` P43) call the identical content readers in the identical order and
 * can never independently drift on *which* files either one touches: one real list, not two
 * hand-written copies of it. */
interface RegenerableGroup {
  readonly destDir: string;
  readonly files: readonly ContentFile[];
}

async function collectRegenerableGroups(modulesDir: string): Promise<readonly RegenerableGroup[]> {
  const [workflows, frameworks, checks, artifacts, skills, agents, briefs, prompts, techniques] =
    await Promise.all([
      readWorkflowFiles(),
      readFrameworkFiles(),
      readCheckFiles(),
      readArtifactTemplateFiles(),
      readSkillFiles(),
      readResolvedAgents(modulesDir),
      readBriefFiles(),
      readPromptFiles(),
      readTechniqueFiles(modulesDir),
    ]);
  return [
    { destDir: '.forge/workflows', files: workflows },
    { destDir: '.forge/frameworks', files: frameworks },
    { destDir: '.forge/checks', files: checks },
    { destDir: '.forge/templates', files: artifacts },
    { destDir: '.forge/skills', files: skills },
    {
      destDir: '.forge/agents',
      files: agents.map((agent) => ({ relPath: `${agent.id}.yaml`, content: agent.yaml })),
    },
    // `PLAN-M13.md` P1's own two new regenerable content kinds — real workflow/gate step brief text and
    // real agent prompt text, indexed exactly like the five above (`BRIEF_INDEX`/`PROMPT_INDEX`,
    // `@forge/templates`; real content since `PLAN-M13.md` P2/P3, `SPEC-QUESTIONS.md` Q197) — the
    // identical `writeGeneratedDir`'s own hash-drift/conflict-resolution treatment (and
    // `planRegenerableContent`'s own classification) as every other category here.
    { destDir: '.forge/briefs', files: briefs },
    { destDir: '.forge/prompts', files: prompts },
    // `PLAN-M14.md` P29: `16` §16.4's technique library, materialised the identical regenerable-directory
    // way every content kind above already is -- `.forge/techniques/<id>.technique.yaml`, one file per
    // real technique, read back by `@forge/sessions`' own flat-directory loader
    // (`loadTechniqueFromDir`/`listTechniquesInDir`), never the `modules/*/techniques` source tree a
    // real project does not have.
    { destDir: '.forge/techniques', files: techniques },
  ];
}

/**
 * Exported for `@forge/cli/upgrade` (C7, `03` §3.4 step 5: "regenerate the regenerable directories,
 * reusing C2's own file-writing logic, not a duplicate") — idempotent, safe to call again on an
 * existing project (see `writeInitTree`'s own doc comment for why `.forge/config.yaml` alone is
 * excluded from this set). Every file this writes goes through `writeGenerated`'s own real
 * hash-drift check: unchanged since it was last generated, it is overwritten unconditionally exactly
 * as before; a real, detected local edit runs `03` §3.3's own `keep-mine`/`take-theirs`/`merge`/
 * `show-diff` conflict resolution instead of a silent overwrite (`conflictOptions`, defaulting to a
 * real interactive prompt when omitted — see `resolveGeneratedConflict`'s own doc comment).
 *
 * The header's own `v=<ver>` is this installation's real, currently-running `@forge/agents` package
 * version (`readPackageVersion`) — not a hardcoded schema constant. A critic-round-worthy bug in the
 * version this function shipped before this piece: every file was stamped `v=1` literally, forever,
 * regardless of which real FORGE version actually wrote it — useless for a human deciding "was this
 * generated by an old version" from the header alone, the one thing `03` §3.3's own header format
 * exists to let them do without reading `.forge/manifest.yaml` separately.
 */
export async function writeRegenerableContent(
  target: ProjectPaths,
  modulesDir: string,
  conflictOptions?: ConflictHandlingOptions,
): Promise<readonly WrittenFile[]> {
  const groups = await collectRegenerableGroups(modulesDir);
  const version = readPackageVersion('@forge/agents');

  const written: WrittenFile[] = [];
  for (const group of groups) {
    written.push(
      ...(await writeGeneratedDir(target, group.destDir, group.files, version, conflictOptions)),
    );
  }
  return written;
}

export type RegenerableFileStatus = 'current' | 'stale' | 'edited' | 'missing';

export interface RegenerableFilePlanEntry {
  readonly path: string;
  readonly status: RegenerableFileStatus;
}

/**
 * Classifies one real regenerable file (materialised or not, at `destRelPath`) against
 * `shippedContent` — the identical body `writeGenerated` (above) would stamp a fresh header onto were
 * it writing this file right now — into exactly the four states `03` §3.3/§3.4 distinguish:
 *
 * - `missing`: nothing real on disk at `destRelPath` yet.
 * - `edited` (the conflict path): a real, detected local edit (`hasGeneratedFileDrifted`) — the on-disk
 *   body's own hash no longer matches its own recorded header, so a real run goes through `03` §3.3's
 *   own `keep-mine`/`take-theirs`/`merge`/`show-diff` resolution, never a silent overwrite.
 * - `current`: not drifted, and the header's own recorded `hash=` already equals
 *   `sha256(shippedContent)` — the real *body* a fresh write would produce again is byte for byte what
 *   is already on disk (a fresh write may still re-stamp the header's own `v=` field to today's
 *   running version — see `writeRegenerableContent`'s own doc comment on the old, fixed `v=1` bug —
 *   so "current" is a real claim about the body only, never a promise the whole file is untouched).
 * - `stale`: not drifted (a human never touched it), but the shipped content has itself changed since
 *   this copy was generated — `writeGenerated` never treats an undrifted file as a conflict, whatever
 *   its header's own recorded hash is, so a real run overwrites it silently, exactly like `missing`.
 */
async function classifyRegenerableFile(
  target: ProjectPaths,
  destRelPath: string,
  shippedContent: string,
): Promise<RegenerableFilePlanEntry> {
  const resolvedPath = target.resolveWithin(destRelPath);
  if (!(await pathExists(resolvedPath))) {
    return { path: destRelPath, status: 'missing' };
  }
  const diskContent = await readTextFile(resolvedPath);
  if (hasGeneratedFileDrifted(diskContent)) {
    return { path: destRelPath, status: 'edited' };
  }
  // `hasGeneratedFileDrifted` returning `false` guarantees a real header was found (its own
  // `undefined` case above is itself treated as drifted) whose own recorded body hash already matches
  // the disk content — `extractGeneratedHeader` here re-reads that same real header only for its
  // `hash` field, to compare against the shipped content's own hash.
  const header = extractGeneratedHeader(diskContent);
  const status: RegenerableFileStatus =
    header?.hash === sha256(shippedContent) ? 'current' : 'stale';
  return { path: destRelPath, status };
}

/**
 * Read-only: `03` §3.4 step 5's own real plan, computed *before* `writeRegenerableContent` (or a real
 * `--dry-run`) ever touches the filesystem — every real file `writeRegenerableContent` would touch,
 * classified `current`/`stale`/`edited`/`missing` (see `classifyRegenerableFile`), in the writer's own
 * real order (`collectRegenerableGroups`, shared verbatim with the writer above). Writes nothing at
 * all, ever: every real read here goes through the identical `pathExists`/`readTextFile` pair
 * `writeGenerated` itself already uses before ever deciding whether to write.
 *
 * @see PLAN-M14.md P43
 */
export async function planRegenerableContent(
  target: ProjectPaths,
  modulesDir: string,
): Promise<readonly RegenerableFilePlanEntry[]> {
  const groups = await collectRegenerableGroups(modulesDir);
  const plan: RegenerableFilePlanEntry[] = [];
  for (const group of groups) {
    for (const file of group.files) {
      const destRelPath = path.posix.join(group.destDir, file.relPath);
      plan.push(await classifyRegenerableFile(target, destRelPath, file.content));
    }
  }
  return plan;
}

async function writeDocsSkeleton(
  target: ProjectPaths,
  config: ForgeConfig,
): Promise<readonly WrittenFile[]> {
  const written: WrittenFile[] = [];
  const sections: readonly [string, string][] = [
    [config.paths.kb, 'Knowledge base'],
    [config.paths.specs, 'Specs'],
    [config.paths.plans, 'Plans'],
    [config.paths.sessions, 'Sessions'],
    [config.paths.reports, 'Reports'],
  ];
  for (const [dir, title] of sections) {
    const relPath = path.posix.join(dir, 'README.md');
    await writeFileAtomic(target.resolveWithin(relPath), `# ${title}\n`);
    written.push({ path: relPath, generated: false });
  }
  return written;
}

const GITIGNORE_ENTRIES = [
  '.forge/config.local.yaml',
  '.forge/overrides.local/',
  '.forge/secrets.local.yaml',
  '.forge/state/',
];

async function appendGitignore(target: ProjectPaths): Promise<WrittenFile> {
  const relPath = '.gitignore';
  const resolved = target.resolveWithin(relPath);
  const existing = (await pathExists(resolved)) ? await readTextFile(resolved) : '';
  const missing = GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry));
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = missing.length > 0 ? `${separator}\n# FORGE\n${missing.join('\n')}\n` : '';
  await writeFileAtomic(resolved, existing + block);
  return { path: relPath, generated: false };
}

function forgeMd(config: ForgeConfig, ideaPath: string | undefined): string {
  return [
    `# ${config.project.name}`,
    '',
    `Run with FORGE (${config.project.level}, ${config.project.mode} mode).`,
    '',
    '## For humans',
    '',
    '- Project config: `.forge/config.yaml`',
    '- Knowledge base: `' + config.paths.kb + '`',
    '- Your own customizations: `.forge/overrides/`',
    '',
    '## For agents',
    '',
    '- Roster: `.forge/agents/`',
    '- Workflows: `.forge/workflows/`',
    ideaPath !== undefined ? `- Product idea: \`${ideaPath}\`` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

/** `03` §3.3 step 2's own "idea capture": `--idea-file`'s real content, copied into the project
 * itself (`<kb>/idea.md`) rather than left as a dangling reference to a path outside the project that
 * may not exist by the time anything reads `FORGE.md` again. */
async function writeIdeaFile(
  target: ProjectPaths,
  config: ForgeConfig,
  ideaContent: string,
): Promise<WrittenFile> {
  const relPath = path.posix.join(config.paths.kb, 'idea.md');
  await writeFileAtomic(target.resolveWithin(relPath), ideaContent);
  return { path: relPath, generated: false };
}

/** `installAssets`' own `InstalledAsset.path` carries no documented relative-vs-absolute contract
 * (`@forge/adapter-kit/types/assets.ts` gives it none) — every other `WrittenFile.path` in this
 * piece's own `InitResult` is project-root-relative, so an absolute path is normalized to match
 * rather than left to silently look inconsistent beside every other entry. */
function normalizeAssetPath(target: ProjectPaths, assetPath: string): string {
  return path.isAbsolute(assetPath)
    ? path.relative(target.resolveWithin('.'), assetPath)
    : assetPath;
}

/**
 * `.forge/config.yaml` is written *last*, deliberately: `runInit`'s own idempotency check
 * (`isAlreadyInitialized`) tests for exactly this one file, so writing it first — the way an
 * apparently-natural top-to-bottom pass through `03` §3.3's own file tree would — means any later
 * step throwing (a bad `extends` chain, a preset failing validation, a platform's own
 * `installAssets` throwing) leaves a half-written project that every subsequent `runInit` call then
 * silently treats as fully, successfully initialized. Every other file this function writes is
 * safe to write more than once (`writeFileAtomic` overwrites unconditionally), so a caller that
 * retries after a failure here safely resumes rather than colliding with the previous attempt's
 * partial output.
 */
export async function writeInitTree(input: WriteTreeInput): Promise<readonly WrittenFile[]> {
  const { target, modulesDir, options, config, ideaContent } = input;
  const written: WrittenFile[] = [];

  written.push(...(await writeConfigLocalAndManifest(target, modulesDir, options)));
  written.push(...(await writeRegenerableContent(target, modulesDir)));
  written.push(...(await writeDocsSkeleton(target, config)));
  written.push(await appendGitignore(target));

  let ideaPath: string | undefined;
  if (ideaContent !== undefined) {
    const ideaFile = await writeIdeaFile(target, config, ideaContent);
    written.push(ideaFile);
    ideaPath = ideaFile.path;
  }

  await writeFileAtomic(target.resolveWithin('FORGE.md'), `${forgeMd(config, ideaPath)}\n`);
  written.push({ path: 'FORGE.md', generated: false });

  const preset = await applyPreset(config.roster.preset, target);
  for (const file of preset.files) {
    written.push({ path: file.path, generated: false });
  }

  if (input.primary.installAssets !== undefined) {
    const resolvedAgents = await readResolvedAgents(modulesDir);
    const installed = await input.primary.installAssets({
      projectRoot: target.resolveWithin('.'),
      agents: resolvedAgents.map((agent) => ({ id: agent.id, displayName: agent.displayName })),
    });
    for (const asset of installed) {
      written.push({ path: normalizeAssetPath(target, asset.path), generated: true });
    }
  }

  written.push(await writeConfigYaml(target, config));

  return written;
}
