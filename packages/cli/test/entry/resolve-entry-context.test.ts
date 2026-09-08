/**
 * `resolveEntryContext` — `03` §3.1's resolution logic, end to end.
 *
 * @see specs/03 §3.1
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { MIN_NODE_VERSION } from '../../src/entry/node-version.ts';
import { resolveEntryContext } from '../../src/entry/resolve-entry-context.ts';
import type { EntryEnv } from '../../src/entry/types.ts';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SUPPORTED = `v${MIN_NODE_VERSION}`;

function env(overrides: Partial<EntryEnv> = {}): EntryEnv {
  return { nodeVersion: SUPPORTED, isStdinTty: true, isStdoutTty: true, ...overrides };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createEmptyDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-entry-empty-'));
  cleanupDirs.push(dir);
  return dir;
}

describe('resolveEntryContext', () => {
  it('reports unsupported-node-version below the floor, before anything else is checked', () => {
    // An unsupported version, TTY, in the fixture dir that would otherwise resolve to dashboard —
    // proving the Node-version check really does run first, not just that it can fire in isolation.
    const result = resolveEntryContext(
      path.join(fixturesDir, 'has-forge-config'),
      [],
      env({ nodeVersion: 'v18.17.0' }),
    );
    expect(result).toEqual({
      kind: 'unsupported-node-version',
      required: MIN_NODE_VERSION,
      actual: 'v18.17.0',
    });
  });

  it('classifies an empty, non-project directory as init-wizard', async () => {
    const dir = await createEmptyDir();
    expect(resolveEntryContext(dir, [], env())).toEqual({ kind: 'init-wizard' });
  });

  it('classifies a non-project directory with existing code but no git as init-wizard', async () => {
    const dir = await createEmptyDir();
    await writeFile(path.join(dir, 'README.md'), '# hello\n');
    expect(resolveEntryContext(dir, [], env())).toEqual({ kind: 'init-wizard' });
  });

  it('classifies a bare `git init`, with no other content, as init-wizard (not adopt-or-init)', async () => {
    // A directory whose only entry is `.git` itself — the ordinary `mkdir proj && cd proj && git
    // init && npx forge-method` precondition — is "empty" for §3.1's purposes, not "existing code".
    const dir = await createEmptyDir();
    await mkdir(path.join(dir, '.git'));
    expect(resolveEntryContext(dir, [], env())).toEqual({ kind: 'init-wizard' });
  });

  it('classifies a non-project directory with existing code and git as adopt-or-init', async () => {
    // Built dynamically, not as a checked-in fixture: git categorically refuses to track anything
    // literally named `.git` (confirmed directly — `git add` on a nested `.git` path stages nothing
    // and errors on neither), so a fixture directory containing one would silently lose it on commit
    // and pass locally for the wrong reason (leftover files from this session, not tracked content).
    const dir = await createEmptyDir();
    await writeFile(path.join(dir, 'README.md'), '# hello\n');
    await mkdir(path.join(dir, '.git'));
    const result = resolveEntryContext(dir, [], env());
    expect(result).toEqual({ kind: 'adopt-or-init', defaultHighlight: 'adopt' });
  });

  it('classifies a directory with .forge/config.yaml as dashboard, at the project root', () => {
    const projectDir = path.join(fixturesDir, 'has-forge-config');
    expect(resolveEntryContext(projectDir, [], env())).toEqual({
      kind: 'dashboard',
      projectRoot: projectDir,
    });
  });

  it('finds .forge/config.yaml by walking up from a nested subdirectory', () => {
    const projectDir = path.join(fixturesDir, 'has-forge-config');
    const nested = path.join(projectDir, 'nested', 'deeper');
    expect(resolveEntryContext(nested, [], env())).toEqual({
      kind: 'dashboard',
      projectRoot: projectDir,
    });
  });

  it('stops the upward walk at a .forge-root marker, never reaching an ancestor project', () => {
    // fixtures/marker-parent/.forge/config.yaml is a real project root; fixtures/marker-parent/blocked/
    // carries a .forge-root marker and is itself not a project. Resolving from *inside* `blocked`
    // must not walk past the marker to find the ancestor's config.yaml.
    const blocked = path.join(fixturesDir, 'marker-parent', 'blocked');
    expect(resolveEntryContext(blocked, [], env())).toEqual({ kind: 'init-wizard' });
  });

  it('stops at the marker even from a subdirectory nested below it', () => {
    const nested = path.join(fixturesDir, 'marker-parent', 'blocked', 'nested');
    const result = resolveEntryContext(nested, [], env());
    expect(result.kind).not.toBe('dashboard');
  });

  it('uses the real process (Node version, TTY-ness) when no env is injected — the documented two-arg call', async () => {
    // No third argument: exercises `realEntryEnv`'s own ambient reads directly, not the injected
    // `EntryEnv` every other test in this file supplies. The real test runner's own Node satisfies
    // the floor and stdio is never a real TTY here, so this always lands on non-tty-refusal.
    const dir = await createEmptyDir();
    const result = resolveEntryContext(dir, []);
    expect(result).toEqual({ kind: 'non-tty-refusal', underlying: 'init-wizard' });
  });

  it('refuses non-TTY invocations with exit-2-shaped non-tty-refusal, carrying the real branch', () => {
    const projectDir = path.join(fixturesDir, 'has-forge-config');
    const result = resolveEntryContext(projectDir, [], env({ isStdoutTty: false }));
    expect(result).toEqual({ kind: 'non-tty-refusal', underlying: 'dashboard' });
  });

  it('refuses when only stdin is non-TTY too', () => {
    const projectDir = path.join(fixturesDir, 'has-forge-config');
    const result = resolveEntryContext(projectDir, [], env({ isStdinTty: false }));
    expect(result.kind).toBe('non-tty-refusal');
  });
});
