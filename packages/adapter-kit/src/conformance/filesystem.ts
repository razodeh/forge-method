/**
 * C2 (cwd isolation), C3 (tool restriction), C4 (exec allowlist), C12 (concurrency), C14 (determinism
 * of reporting) — `07` §7.6's own table, verbatim. All five ultimately check the real filesystem
 * (`node:fs`), never `SessionResult.changedFiles` alone for C2/C3/C12 — C14 exists specifically to
 * check that field's own accuracy, so using it to verify the others would be circular against the one
 * thing C14 is supposed to catch if it is wrong (`SPEC-QUESTIONS.md` Q60 point 2). Each check is a
 * plain, directly-callable async function so this piece's own test file can invoke one against a
 * deliberately non-compliant stub adapter and assert it rejects.
 *
 * @see specs/07 §7.6
 * @see SPEC-QUESTIONS.md Q60
 * @see PLAN-M4.md P4
 */
import { existsSync } from 'node:fs';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../types/events.ts';
import type { ConformanceContext } from './context.ts';
import {
  CONFORMANCE_EXEC_CANARY_RELATIVE_PATH,
  CONFORMANCE_WRITE_FILE_CONTENT,
  CONFORMANCE_WRITE_FILE_RELATIVE_PATH,
} from './fixtures.ts';
import { gitStatusPaths, initGitRepo } from './git.ts';
import { collectEvents, withTimeout } from './helpers.ts';

function isToolResultEvent(event: AdapterEvent): event is Extract<AdapterEvent, { readonly type: 'tool.result' }> {
  return event.type === 'tool.result';
}

async function readMarkerFile(cwd: string): Promise<string | undefined> {
  const target = path.join(cwd, CONFORMANCE_WRITE_FILE_RELATIVE_PATH);
  if (!existsSync(target)) return undefined;
  return readFile(target, 'utf8');
}

function isRelativePathInsideDir(relative: string): boolean {
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** `existsSync`/`readFile` both follow symlinks — a marker file that is actually a symlink pointing
 * somewhere entirely outside `cwd` would satisfy `readMarkerFile`'s own existence-and-content check
 * while never having genuinely written anything inside `cwd` at all, a gauntlet critic's own repro for
 * C2 specifically. `realpath` resolves both sides (the marker file *and* `cwd` itself — a scratch
 * directory's own raw path can itself traverse a symlink, e.g. macOS's `/tmp` -> `/private/tmp`, so
 * comparing against `cwd` unresolved would produce false failures for entirely legitimate writes) before
 * checking containment. */
async function assertMarkerFileTrulyInsideCwd(cwd: string): Promise<void> {
  const target = path.join(cwd, CONFORMANCE_WRITE_FILE_RELATIVE_PATH);
  const [realTarget, realCwd] = await Promise.all([realpath(target), realpath(cwd)]);
  const relative = path.relative(realCwd, realTarget);
  expect(isRelativePathInsideDir(relative)).toBe(true);
}

/** Normalizes a reported path to a forward-slash-relative form so a comparison holds on Windows too —
 * `git status --porcelain` always reports forward slashes regardless of OS; `changedFiles` (adapter- and
 * OS-dependent) might not. Exported for direct testing only — not part of this package's public
 * `conformance` barrel. */
export function normalizeReportedPath(reported: string, cwd: string): string {
  const relative = path.isAbsolute(reported) ? path.relative(cwd, reported) : reported;
  return relative.split(path.sep).join('/');
}

export async function checkC2CwdIsolation(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  const canaryDir = await context.options.createScratchDir();

  const handle = await context
    .getAdapter()
    .startSession(context.buildRequest({ cwd, prompt: context.options.writeFilePrompt }));
  await withTimeout(collectEvents(handle), 30000, 'C2: session did not end within 30s');
  await withTimeout(handle.result(), 5000, 'C2: result() did not settle within 5s');

  const inCwd = await readMarkerFile(cwd);
  expect(inCwd).toBe(CONFORMANCE_WRITE_FILE_CONTENT);
  // Not merely "a path that resolves inside cwd exists" — its *real*, symlink-resolved location must
  // genuinely be inside cwd too (SPEC-QUESTIONS.md Q60 addendum; a gauntlet critic's own repro).
  await assertMarkerFileTrulyInsideCwd(cwd);

  const inCanary = await readMarkerFile(canaryDir);
  expect(inCanary).toBeUndefined();
}

export async function checkC3ToolRestriction(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();

  const handle = await context.getAdapter().startSession(
    context.buildRequest({
      cwd,
      prompt: context.options.writeFilePrompt,
      tools: { read: true, write: false, exec: false, network: 'none' },
    }),
  );
  const events = await withTimeout(collectEvents(handle), 30000, 'C3: session did not end within 30s');
  const result = await withTimeout(handle.result(), 5000, 'C3: result() did not settle within 5s');

  const written = await readMarkerFile(cwd);
  expect(written).toBeUndefined();

  // A refusal/error can manifest as a typed error event, a failed tool.result, or the session's own
  // result reporting ok: false — the spec names both shapes ("refusal/error") without picking one; the
  // hard, unambiguous requirement above (no file change) already carries the real assertion.
  const sawRefusalSignal =
    events.some((event) => event.type === 'error') ||
    events.some((event) => isToolResultEvent(event) && !event.ok) ||
    !result.ok;
  expect(sawRefusalSignal).toBe(true);
}

export async function checkC4ExecAllowlist(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  await writeFile(path.join(cwd, CONFORMANCE_EXEC_CANARY_RELATIVE_PATH), 'canary', 'utf8');

  const handle = await context.getAdapter().startSession(
    context.buildRequest({
      cwd,
      prompt: context.options.execPrompt,
      tools: { read: true, write: true, exec: ['echo *'], network: 'none' },
    }),
  );
  const events = await withTimeout(collectEvents(handle), 30000, 'C4: session did not end within 30s');
  await withTimeout(handle.result(), 5000, 'C4: result() did not settle within 5s');

  // "Blocks rm -rf": no field of the tool.call event names the command in a typed way
  // (SPEC-QUESTIONS.md Q60 point 3), so the canary file's continued existence is the direct proof.
  const canaryStillExists = existsSync(path.join(cwd, CONFORMANCE_EXEC_CANARY_RELATIVE_PATH));
  expect(canaryStillExists).toBe(true);

  // "Permits echo hi": at least one tool call actually succeeded — proving the allowlist isn't
  // rejecting everything. A gauntlet critic correctly named the real limit of this: because no field of
  // AdapterEvent's tool.call variant names the command in a typed way, this cannot verify *specifically*
  // that the echo attempt (rather than some unrelated successful call) is the one that succeeded — an
  // adapter that never attempts echo hi at all but happens to emit one other successful tool.result
  // would pass this half. The "blocks rm -rf" half above has no such gap (the canary file's survival is
  // a direct, unambiguous proof); this half is accepted as the strongest signal available without new
  // PlatformAdapter surface this milestone's own interface (07 §7.2, already built and reviewed) does
  // not provide — recorded here as a known trade-off, not an oversight.
  const sawSuccessfulToolCall = events.some((event) => isToolResultEvent(event) && event.ok);
  expect(sawSuccessfulToolCall).toBe(true);
}

export async function checkC12Concurrency(context: ConformanceContext): Promise<void> {
  const cwds = await Promise.all([
    context.options.createScratchDir(),
    context.options.createScratchDir(),
    context.options.createScratchDir(),
  ]);

  const results = await Promise.all(
    cwds.map(async (cwd) => {
      const handle = await context
        .getAdapter()
        .startSession(context.buildRequest({ cwd, prompt: context.options.writeFilePrompt }));
      await withTimeout(collectEvents(handle), 30000, 'C12: a session did not end within 30s');
      return withTimeout(handle.result(), 5000, 'C12: a result() did not settle within 5s');
    }),
  );

  for (const result of results) {
    expect(result.ok).toBe(true);
  }

  // Each cwd's own marker file exists with the expected content — proof this session's write landed in
  // its own cwd, not a sibling's. A full directory listing would additionally catch a stray extra file
  // bleeding in from another session, but this package has no listing helper it is allowed to use
  // (`node:fs`'s own `readdir` is unordered and this package cannot depend on `@forge/core/fs`'s
  // `listDirSorted`, `SPEC-QUESTIONS.md` Q60 point 6's identical no-`core`-edge reasoning) — existence
  // and content are the check available without one.
  for (const cwd of cwds) {
    const content = await readMarkerFile(cwd);
    expect(content).toBe(CONFORMANCE_WRITE_FILE_CONTENT);
  }
}

export async function checkC14DeterminismOfReporting(context: ConformanceContext): Promise<void> {
  const cwd = await context.options.createScratchDir();
  await initGitRepo(cwd);

  const handle = await context
    .getAdapter()
    .startSession(context.buildRequest({ cwd, prompt: context.options.writeFilePrompt }));
  await withTimeout(collectEvents(handle), 30000, 'C14: session did not end within 30s');
  const result = await withTimeout(handle.result(), 5000, 'C14: result() did not settle within 5s');

  const reportedByAdapter = [...result.changedFiles].map((reported) => normalizeReportedPath(reported, cwd)).sort();
  const reportedByGit = [...(await gitStatusPaths(cwd))].sort();

  expect(reportedByAdapter).toEqual(reportedByGit);
  expect(reportedByAdapter.length).toBeGreaterThanOrEqual(1);
}

export function registerFilesystemTests(context: ConformanceContext): void {
  describe('C2, C3, C12 — filesystem isolation', () => {
    it('C2 — cwd isolation: a file written by the session appears in the given cwd only', () =>
      checkC2CwdIsolation(context));
    it('C3 — tool restriction: write:false results in no file change and a refusal/error, not a write', () =>
      checkC3ToolRestriction(context));
    it('C12 — concurrency: 3 concurrent sessions in distinct cwds complete without cross-talk', () =>
      checkC12Concurrency(context));
  });

  describe('C4 — exec allowlist', () => {
    it('exec:["echo *"] permits echo hi, blocks rm -rf (07 §7.6\'s own worked example)', () =>
      checkC4ExecAllowlist(context));
  });

  describe('C14 — determinism of reporting', () => {
    it('changedFiles matches git status --porcelain in the worktree', () =>
      checkC14DeterminismOfReporting(context));
  });
}
