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
  readArtifactTemplateFiles,
  readCheckFiles,
  readFrameworkFiles,
  readResolvedAgents,
  readSkillFiles,
  readWorkflowFiles,
  type ContentFile,
} from './content.ts';
import { generatedHeader } from './generated-header.ts';
import { sha256 } from './hash.ts';
import { buildManifest } from './manifest.ts';
import type { InitOptions, WrittenFile } from './types.ts';

const MANIFEST_VERSION = '1';

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

async function writeGenerated(
  target: ProjectPaths,
  destRelPath: string,
  file: ContentFile,
): Promise<WrittenFile> {
  const hash = sha256(file.content);
  const header = generatedHeader(destRelPath, MANIFEST_VERSION, hash);
  await writeFileAtomic(target.resolveWithin(destRelPath), header + file.content);
  return { path: destRelPath, generated: true };
}

async function writeGeneratedDir(
  target: ProjectPaths,
  destDir: string,
  files: readonly ContentFile[],
): Promise<readonly WrittenFile[]> {
  const written: WrittenFile[] = [];
  for (const file of files) {
    written.push(await writeGenerated(target, path.posix.join(destDir, file.relPath), file));
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

async function writeRegenerableContent(
  target: ProjectPaths,
  modulesDir: string,
): Promise<readonly WrittenFile[]> {
  const [workflows, frameworks, checks, artifacts, skills, agents] = await Promise.all([
    readWorkflowFiles(),
    readFrameworkFiles(),
    readCheckFiles(),
    readArtifactTemplateFiles(),
    readSkillFiles(),
    readResolvedAgents(modulesDir),
  ]);

  const written: WrittenFile[] = [];
  written.push(...(await writeGeneratedDir(target, '.forge/workflows', workflows)));
  written.push(...(await writeGeneratedDir(target, '.forge/frameworks', frameworks)));
  written.push(...(await writeGeneratedDir(target, '.forge/checks', checks)));
  written.push(...(await writeGeneratedDir(target, '.forge/templates', artifacts)));
  written.push(...(await writeGeneratedDir(target, '.forge/skills', skills)));
  written.push(
    ...(await writeGeneratedDir(
      target,
      '.forge/agents',
      agents.map((agent) => ({ relPath: `${agent.id}.yaml`, content: agent.yaml })),
    )),
  );
  return written;
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
