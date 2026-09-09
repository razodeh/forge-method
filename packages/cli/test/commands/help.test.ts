/**
 * `forge help` with no args — a real, small decision tree over real project state.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { ProjectPaths } from '@forge/core/fs';

import { helpRecommendNext } from '../../src/commands/help.ts';
import { acquireRunLock } from '../../src/commands/run/lock.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

const SPECS_ROOT = 'docs/forge/specs';

describe('helpRecommendNext', () => {
  it('recommends init for a real, never-initialized directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-help-'));
    try {
      const paths = new ProjectPaths(dir);
      const recommendation = await helpRecommendNext({ paths, specsRoot: SPECS_ROOT });
      expect(recommendation.command).toBe('forge init');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recommends doctor for a real, initialized project with no run in progress', async () => {
    const project = await createTestProject();
    const recommendation = await helpRecommendNext({
      paths: project.paths,
      specsRoot: project.config.paths.specs,
    });
    expect(recommendation.command).toBe('forge doctor');
  });

  it('recommends resume for a real project with a stale lock naming a real, genuinely dead pid', async () => {
    const project = await createTestProject();
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child process failed to spawn (no pid)');
    await new Promise((resolve) => child.on('exit', resolve));

    await acquireRunLock(project.paths, {
      pid: deadPid,
      host: 'h',
      runId: 'run-1',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const recommendation = await helpRecommendNext({
      paths: project.paths,
      specsRoot: project.config.paths.specs,
    });
    expect(recommendation.command).toBe('forge resume');
  });

  it('recommends status for a real project with a run genuinely still in progress', async () => {
    const project = await createTestProject();
    await acquireRunLock(project.paths, {
      pid: process.pid,
      host: 'h',
      runId: 'run-1',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const recommendation = await helpRecommendNext({
      paths: project.paths,
      specsRoot: project.config.paths.specs,
    });
    expect(recommendation.command).toBe('forge status');
  });

  it('recommends a real spec scaffold for a real, initialized project with no spec tree yet', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, project.config.paths.specs), { recursive: true, force: true });
    const recommendation = await helpRecommendNext({
      paths: project.paths,
      specsRoot: project.config.paths.specs,
    });
    expect(recommendation.command).toBe('forge spec new Vision');
  });
});
