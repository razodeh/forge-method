/**
 * `runInit` — `03` §3.3's greenfield wizard, driven end to end via `--yes` plus flags, against a
 * real temp directory: real files written, a real `git init`, a real preset applied.
 *
 * @see specs/03 §3.3
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { configSchema } from '@forge/schemas/config';
import { FakePlatformAdapter } from '@forge/testkit';

import { ForgeError } from '@forge/core/errors';

import { runInit } from '../../src/init/run-init.ts';
import type { InitOptions, RunInitDeps } from '../../src/init/types.ts';

const fixtureModulesDir = fileURLToPath(new URL('./fixtures/modules/', import.meta.url));

const BASE: InitOptions = { name: 'Acme Billing', yes: true };

function deps(): RunInitDeps {
  return {
    candidateAdapters: [new FakePlatformAdapter()],
    env: {},
    modulesDir: fixtureModulesDir,
  };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-init-'));
  cleanupDirs.push(dir);
  return dir;
}

describe('runInit', () => {
  it('refuses to run at all without --yes', async () => {
    const dir = await tempDir();
    await expect(runInit(dir, { ...BASE, yes: false }, deps())).rejects.toBeInstanceOf(ForgeError);
  });

  it('writes the real, documented top-level file tree into an empty directory', async () => {
    const dir = await tempDir();
    const result = await runInit(dir, BASE, deps());
    expect(result.kind).toBe('initialized');

    for (const relPath of [
      '.forge/config.yaml',
      '.forge/config.local.yaml',
      '.forge/manifest.yaml',
      '.gitignore',
      'FORGE.md',
    ]) {
      expect(existsSync(path.join(dir, relPath)), relPath).toBe(true);
    }
  });

  it('writes a config.yaml that validates against the real configSchema, with the wizard answers applied', async () => {
    const dir = await tempDir();
    await runInit(dir, { ...BASE, level: 'L2', autonomy: 'autonomous' }, deps());
    const raw = readFileSync(path.join(dir, '.forge/config.yaml'), 'utf8');
    const parsed = configSchema.parse(YAML.parse(raw));
    expect(parsed.project.name).toBe('Acme Billing');
    expect(parsed.project.level).toBe('L2');
    expect(parsed.execution.autonomy).toBe('autonomous');
  });

  it('copies real @forge/templates content into .forge/workflows, each carrying a real generated header', async () => {
    const dir = await tempDir();
    await runInit(dir, BASE, deps());
    const workflowsDir = path.join(dir, '.forge/workflows');
    expect(existsSync(workflowsDir)).toBe(true);
    const oneFile = readFileSync(path.join(workflowsDir, 'intake.workflow.yaml'), 'utf8');
    expect(oneFile.startsWith('# forge:generated v=')).toBe(true);
    expect(oneFile).toContain('hash=');
  });

  it('writes the fixture module’s one resolved agent into .forge/agents', async () => {
    const dir = await tempDir();
    await runInit(dir, BASE, deps());
    const agentPath = path.join(dir, '.forge/agents/tester.yaml');
    expect(existsSync(agentPath)).toBe(true);
    expect(readFileSync(agentPath, 'utf8')).toContain('id: tester');
  });

  it('runs a real `git init` when none exists and --git-init is not explicitly disabled', async () => {
    const dir = await tempDir();
    await runInit(dir, BASE, deps());
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
  });

  it('does not run `git init` again over an existing repo', async () => {
    const dir = await tempDir();
    await execa('git', ['init'], { cwd: dir });
    const marker = path.join(dir, '.git', 'this-is-the-real-one');
    await writeFile(marker, 'x');
    await runInit(dir, BASE, deps());
    expect(existsSync(marker)).toBe(true);
  });

  it('applies the real preset (default startup-lean) into .forge/overrides/', async () => {
    const dir = await tempDir();
    const result = await runInit(dir, BASE, deps());
    if (result.kind !== 'initialized') throw new Error('expected initialized');
    const presetFiles = result.files.filter((file) => file.path.startsWith('.forge/overrides/'));
    expect(presetFiles.length).toBeGreaterThan(0);
    for (const file of presetFiles) {
      expect(existsSync(path.join(dir, file.path))).toBe(true);
    }
  });

  it('detects an existing project and switches to already-initialized rather than re-writing it', async () => {
    const dir = await tempDir();
    await runInit(dir, BASE, deps());
    const configPath = path.join(dir, '.forge/config.yaml');
    const before = readFileSync(configPath, 'utf8');

    const result = await runInit(dir, { ...BASE, name: 'A Different Name' }, deps());
    expect(result).toEqual({ kind: 'already-initialized', projectRoot: path.resolve(dir) });
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('returns the resolved level and its reasoning', async () => {
    const dir = await tempDir();
    const result = await runInit(dir, { ...BASE, level: 'L1' }, deps());
    if (result.kind !== 'initialized') throw new Error('expected initialized');
    expect(result.level).toBe('L1');
    expect(result.levelReasoning.length).toBeGreaterThan(0);
  });

  it('propagates a real ENV-004 when no candidate platform is usable', async () => {
    const dir = await tempDir();
    const brokenAdapter: RunInitDeps['candidateAdapters'][number] = {
      id: 'broken',
      displayName: 'Broken',
      capabilities: () => {
        throw new Error('not used');
      },
      preflight: () => Promise.resolve({ ok: false, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () => {
        throw new Error('not used');
      },
      resumeSession: () => {
        throw new Error('not used');
      },
    };
    await expect(
      runInit(dir, BASE, {
        candidateAdapters: [brokenAdapter],
        env: {},
        modulesDir: fixtureModulesDir,
      }),
    ).rejects.toMatchObject({ code: 'ENV-004' });
  });

  it('refuses --overlay rather than silently dropping it (no real overlay-bundle installer exists yet)', async () => {
    const dir = await tempDir();
    await expect(
      runInit(dir, { ...BASE, overlay: ['npm:@acme/forge-standards'] }, deps()),
    ).rejects.toMatchObject({ code: 'USR-002' });
    // Refused before any write — a retry without --overlay must not see a half-initialized project.
    expect(existsSync(path.join(dir, '.forge'))).toBe(false);
  });

  it('reads --idea-file’s real content and copies it into the project, relative to the real cwd', async () => {
    const dir = await tempDir();
    const ideaPath = path.join(dir, '..', 'idea-source.md');
    await writeFile(ideaPath, '# The Big Idea\n\nSomething genuinely new.\n');
    cleanupDirs.push(ideaPath);
    const relativeIdeaPath = path.relative(process.cwd(), ideaPath);

    const result = await runInit(dir, { ...BASE, ideaFile: relativeIdeaPath }, deps());
    if (result.kind !== 'initialized') throw new Error('expected initialized');

    const copied = result.files.find((file) => file.path.endsWith('idea.md'));
    expect(copied).toBeDefined();
    const content = readFileSync(path.join(dir, copied?.path ?? ''), 'utf8');
    expect(content).toContain('Something genuinely new.');

    const forgeMd = readFileSync(path.join(dir, 'FORGE.md'), 'utf8');
    expect(forgeMd).toContain(copied?.path ?? '');
  });

  it('throws a real, remediable error for a missing --idea-file rather than silently skipping it', async () => {
    const dir = await tempDir();
    await expect(
      runInit(dir, { ...BASE, ideaFile: './this-file-does-not-exist.md' }, deps()),
    ).rejects.toMatchObject({ code: 'ENV-004' });
  });

  it('writes .forge/config.yaml last, so a failure partway through never leaves a false already-initialized marker', async () => {
    const dir = await tempDir();
    // A module directory that exists but is not a real, loadable agent roster — makes
    // writeRegenerableContent's own readResolvedAgents throw partway through the real write sequence,
    // well after several other real files would already exist on disk.
    const brokenModulesParent = await mkdtemp(
      path.join(tmpdir(), 'forge-cli-init-broken-modules-'),
    );
    cleanupDirs.push(brokenModulesParent);
    const notADirectory = path.join(brokenModulesParent, 'modules-is-actually-a-file');
    await writeFile(notADirectory, 'x');

    const brokenDeps: RunInitDeps = {
      candidateAdapters: [new FakePlatformAdapter()],
      env: {},
      modulesDir: notADirectory,
    };

    await expect(runInit(dir, BASE, brokenDeps)).rejects.toBeTruthy();
    expect(existsSync(path.join(dir, '.forge', 'config.yaml'))).toBe(false);

    // A retry with working deps must genuinely initialize, not report already-initialized.
    const result = await runInit(dir, BASE, deps());
    expect(result.kind).toBe('initialized');
  });

  it('normalizes an absolute InstalledAsset.path to project-relative, matching every other WrittenFile', async () => {
    const dir = await tempDir();
    const adapterWithAssets: RunInitDeps['candidateAdapters'][number] = {
      id: 'asset-adapter',
      displayName: 'Asset Adapter',
      capabilities: () => {
        throw new Error('not used');
      },
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () => {
        throw new Error('not used');
      },
      resumeSession: () => {
        throw new Error('not used');
      },
      installAssets: (ctx) =>
        Promise.resolve([
          {
            path: path.join(ctx.projectRoot, '.claude', 'agents', 'forge-tester.md'),
            kind: 'agent',
          },
        ]),
    };
    const result = await runInit(dir, BASE, {
      candidateAdapters: [adapterWithAssets],
      env: {},
      modulesDir: fixtureModulesDir,
    });
    if (result.kind !== 'initialized') throw new Error('expected initialized');
    const asset = result.files.find((file) => file.path.includes('forge-tester.md'));
    expect(asset?.path).toBe(path.join('.claude', 'agents', 'forge-tester.md'));
  });

  it('leaves an already-relative InstalledAsset.path untouched', async () => {
    const dir = await tempDir();
    const adapterWithAssets: RunInitDeps['candidateAdapters'][number] = {
      id: 'asset-adapter-relative',
      displayName: 'Asset Adapter',
      capabilities: () => {
        throw new Error('not used');
      },
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
      listModels: () => Promise.resolve([]),
      startSession: () => {
        throw new Error('not used');
      },
      resumeSession: () => {
        throw new Error('not used');
      },
      installAssets: () =>
        Promise.resolve([{ path: '.claude/commands/forge-run.md', kind: 'command' }]),
    };
    const result = await runInit(dir, BASE, {
      candidateAdapters: [adapterWithAssets],
      env: {},
      modulesDir: fixtureModulesDir,
    });
    if (result.kind !== 'initialized') throw new Error('expected initialized');
    const asset = result.files.find((file) => file.path.includes('forge-run.md'));
    expect(asset?.path).toBe('.claude/commands/forge-run.md');
  });

  it('appends no new .gitignore block when every FORGE entry is already present', async () => {
    const dir = await tempDir();
    const gitignorePath = path.join(dir, '.gitignore');
    const preexisting =
      'node_modules/\n' +
      '.forge/config.local.yaml\n' +
      '.forge/overrides.local/\n' +
      '.forge/secrets.local.yaml\n' +
      '.forge/state/\n';
    await writeFile(gitignorePath, preexisting);

    await runInit(dir, BASE, deps());
    expect(readFileSync(gitignorePath, 'utf8')).toBe(preexisting);
  });

  it('adds a newline separator before appending to a .gitignore that does not already end in one', async () => {
    const dir = await tempDir();
    const gitignorePath = path.join(dir, '.gitignore');
    await writeFile(gitignorePath, 'node_modules/');

    await runInit(dir, BASE, deps());
    const content = readFileSync(gitignorePath, 'utf8');
    expect(content.startsWith('node_modules/\n')).toBe(true);
    expect(content).toContain('.forge/config.local.yaml');
  });
});
