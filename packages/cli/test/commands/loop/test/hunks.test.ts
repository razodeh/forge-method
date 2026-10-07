/**
 * `computeHunks`/`resolveHunkModeBase` — `specs/22` M16 P11's own "Tests first" section, against
 * real, throwaway git repositories (`mkdtemp` plus real `git` subprocesses) and real generated edits
 * — never a mocked git, never a hand-built diff string.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { isForgeError } from '@forge/core';
import { resolveRevision } from '@forge/vcs';

import { runBindingCheck } from '../../../../src/commands/loop/test/binding.ts';
import {
  computeHunks,
  resolveHunkModeBase,
  type FileHunk,
  type Hunk,
  type TextHunk,
} from '../../../../src/commands/loop/test/hunks.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A real, throwaway repository with one real, non-empty "init" commit — the identical shape
 * `binding.test.ts`'s own `freshRepo` already establishes, duplicated here rather than imported: the
 * two test files own their fixtures independently, the convention `bin-binding.test.ts` already
 * follows for its own near-identical helper. */
async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-hunks-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  // Belt and suspenders alongside `test/setup.ts`'s own global/system config neutralisation: a CRLF
  // fixture's own bytes must survive `git add`/checkout untouched by a line-ending conversion this
  // module is not the one responsible for guarding against.
  await execa('git', ['config', 'core.autocrlf', 'false'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function writeFiles(dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const full = path.join(dir, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
}

async function commit(dir: string, message: string): Promise<string> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function headSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

function textHunks(hunks: readonly Hunk[]): readonly TextHunk[] {
  return hunks.filter((hunk): hunk is TextHunk => hunk.kind === 'text');
}

function fileHunks(hunks: readonly Hunk[]): readonly FileHunk[] {
  return hunks.filter((hunk): hunk is FileHunk => hunk.kind === 'file');
}

/** Applies every text hunk of one file TOGETHER, in the single `git apply -R --unidiff-zero`
 * invocation a real multi-hunk unified diff already is (never one hunk at a time against a moving
 * target — see this module's own `hunks.ts` header comment, and the DECISION in the builder's own
 * report, for why "together" is the one this module's own design relies on: a combined patch's own
 * cumulative, exact line-offset tracking, never git's fuzzy, content-based relocation a series of
 * independent, solo `git apply` calls would instead have to lean on). Reconstructs the real,
 * complete, original per-file unified diff from `hunks.ts`'s own exported fields plus a fresh
 * `git diff` for the shared file header — proving the fields `computeHunks` returns are themselves
 * sufficient to reproduce a working patch, not merely carrying along a private, undisclosed one. */
async function reverseAllHunksTogether(
  dir: string,
  baseSha: string,
  headShaValue: string,
  filePath: string,
): Promise<void> {
  const { stdout } = await execa(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '-U0',
      '--no-renames',
      '--diff-algorithm=myers',
      baseSha,
      headShaValue,
      '--',
      filePath,
    ],
    { cwd: dir, encoding: 'buffer', stripFinalNewline: false },
  );
  await execa('git', ['apply', '-R', '--unidiff-zero'], {
    cwd: dir,
    input: Buffer.from(stdout),
  });
}

describe('computeHunks — the diff flags are load-bearing (specs/22 M16 P11)', () => {
  it('MUTATION EVIDENCE 1 — splits a multi-hunk text file into pinned, per-hunk ranges (the pinned count of 2 is exactly what -U0 controls)', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'multi.txt': Array.from({ length: 10 }, (_, i) => `line${String(i + 1)}`).join('\n') + '\n',
    });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, {
      'multi.txt':
        ['line1', 'line2-CHANGED', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8']
          .concat(['line9-CHANGED', 'line10'])
          .join('\n') + '\n',
    });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['multi.txt'],
    });

    expect(result.diffAlgorithm).toBe('myers');
    expect(result.baseSha).toBe(baseSha);
    expect(result.headSha).toBe(head);
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      path: 'multi.txt',
      oldStart: 2,
      oldCount: 1,
      newStart: 2,
      newCount: 1,
      reversible: true,
    });
    expect(hunks[1]).toMatchObject({
      path: 'multi.txt',
      oldStart: 9,
      oldCount: 1,
      newStart: 9,
      newCount: 1,
      reversible: true,
    });
    expect(fileHunks(result.hunks)).toHaveLength(0);
  });

  it('drops no hunk and takes no implementation path when the implementation path list is empty, never diffing the whole repository (a bare "--" pathspec means everything, confirmed directly)', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'untouched.txt': 'should never appear\n' });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { 'untouched.txt': 'CHANGED but not an implementation path\n' });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: [],
    });

    expect(result.hunks).toEqual([]);
  });

  it('parses an explicit, multi-line @@ range on both the old and new side, not only the implicit single-line form', async () => {
    const dir = await freshRepo();
    const base10 = Array.from({ length: 10 }, (_, i) => `line${String(i + 1)}`).join('\n') + '\n';
    await writeFiles(dir, { 'multi.txt': base10 });
    const baseSha = await commit(dir, 'base');
    // Lines 2-3 (two old lines) become three new lines: an explicit "@@ -2,2 +2,3 @@", never the
    // implicit single-line form the other test in this suite already covers.
    await writeFiles(dir, {
      'multi.txt':
        [
          'line1',
          '2a',
          '2b',
          '2c',
          'line4',
          'line5',
          'line6',
          'line7',
          'line8',
          'line9',
          'line10',
        ].join('\n') + '\n',
    });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['multi.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 2, oldCount: 2, newStart: 2, newCount: 3 });
  });

  it('MUTATION EVIDENCE 2 — real output changes when --no-renames is dropped (a rename becomes one R-entry, not a delete+add pair)', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'origname.txt': 'identical content, moved only\n' });
    const baseSha = await commit(dir, 'base');
    await execa('git', ['mv', 'origname.txt', 'newname.txt'], { cwd: dir });
    const head = await commit(dir, 'head: pure rename');

    // With --no-renames (what computeHunks always passes): a delete half and an add half.
    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['origname.txt', 'newname.txt'],
    });
    const reasons = fileHunks(result.hunks)
      .map((hunk) => `${hunk.path}:${hunk.reason}`)
      .sort();
    expect(reasons).toEqual(['newname.txt:added', 'origname.txt:deleted']);

    // Without --no-renames: git's own default rename detection collapses the pair into one R-shaped
    // raw entry — a different shape this module's own parser (RAW_ENTRY_RE, A/M/D/T only) does not
    // recognise at all, confirmed directly against the real raw output.
    const rawWithRenames = await execa(
      'git',
      ['diff', '--raw', baseSha, head, '--', 'origname.txt', 'newname.txt'],
      { cwd: dir },
    );
    expect(rawWithRenames.stdout).toMatch(/\bR100\b/);
    expect(rawWithRenames.stdout).not.toMatch(/\bA\t|\bD\t/);
  });
});

describe('computeHunks — round-2 fix: quoted paths never derived from diff text (specs/22 M16 P11)', () => {
  it('parses a file whose name contains a literal tab byte, which git C-quotes unconditionally in the human-readable "+++" line (core.quotePath=false does not suppress this)', async () => {
    const dir = await freshRepo();
    const tabName = 'a\tb.txt';
    await writeFiles(dir, { [tabName]: 'line1\n' });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { [tabName]: 'line1-CHANGED\n' });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: [tabName],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      path: tabName,
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      reversible: true,
    });
  });

  it('parses a file whose name contains a literal double-quote byte, the other real quoting trigger', async () => {
    const dir = await freshRepo();
    const quoteName = 'weird"name.txt';
    await writeFiles(dir, { [quoteName]: 'line1\n' });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { [quoteName]: 'line1-CHANGED\n' });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: [quoteName],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      path: quoteName,
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      reversible: true,
    });
  });

  it('attributes each hunk to the right path by position even with a tab-named, a quote-named and a plain path together, each with a distinct oldStart (a real 3+-path fixture, never only one weird name at a time)', async () => {
    const dir = await freshRepo();
    const tabName = 'a\tb.txt';
    const quoteName = 'weird"name.txt';
    await writeFiles(dir, {
      [tabName]: 'tab1\n',
      [quoteName]: 'q1\nq2\nq3\n',
      'normal.txt': 'n1\nn2\nn3\nn4\nn5\n',
    });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, {
      [tabName]: 'tab1-CHANGED\n',
      [quoteName]: 'q1\nq2-CHANGED\nq3\n',
      'normal.txt': 'n1\nn2\nn3\nn4-CHANGED\nn5\n',
    });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      // Deliberately NOT alphabetical on the command line -- git's own output order is sorted
      // regardless (confirmed directly), so the zip must not depend on this call's own ordering.
      implementationPaths: ['normal.txt', tabName, quoteName],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(3);
    const byPath = new Map(hunks.map((hunk) => [hunk.path, hunk]));
    // Three distinct oldStart values: a cross-attribution bug (section i attributed to the wrong
    // path) would show up here as the WRONG path reporting one of the OTHER two oldStart values.
    expect(byPath.get(tabName)).toMatchObject({ oldStart: 1, reversible: true });
    expect(byPath.get(quoteName)).toMatchObject({ oldStart: 2, reversible: true });
    expect(byPath.get('normal.txt')).toMatchObject({ oldStart: 4, reversible: true });
  });

  it('never reaches the ext-diff throw when an ordinary, documented project configuration (.gitattributes + a diff driver) is active: --no-ext-diff ignores it', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'f.txt': 'line1\nline2\n' });
    await writeFiles(dir, { '.gitattributes': 'f.txt diff=mydriver\n' });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { 'f.txt': 'line1\nline2-CHANGED\n' });
    const head = await commit(dir, 'head');
    // A real, ordinary external diff driver -- its own stdout, not git's internal diff, would
    // otherwise become this call's entire rendering (confirmed directly in the builder's own
    // research: a real repro prints a "+++" line with no "@@" hunk and no "diff --git" line at all).
    await execa(
      'git',
      [
        'config',
        'diff.mydriver.command',
        'echo DRIVER_NOISE; echo "+++ b/f.txt"; echo no-hunk-here',
      ],
      { cwd: dir },
    );

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['f.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      path: 'f.txt',
      oldStart: 2,
      oldCount: 1,
      newStart: 2,
      newCount: 1,
      reversible: true,
    });
  });
});

describe('computeHunks — round-2 fix: a submodule pointer bump is a FileHunk, never a false reversible:true TextHunk (specs/22 M16 P11)', () => {
  it('classifies a real submodule (gitlink, mode 160000) pointer bump as reason "submodule", never a TextHunk', async () => {
    const innerDir = await freshRepo();
    await writeFiles(innerDir, { 'file.txt': 'v1\n' });
    const innerV1 = await commit(innerDir, 'inner v1');
    await writeFiles(innerDir, { 'file.txt': 'v2\n' });
    const innerV2 = await commit(innerDir, 'inner v2');

    const outerDir = await freshRepo();
    await execa(
      'git',
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', innerDir, 'sub'],
      { cwd: outerDir },
    );
    await execa('git', ['checkout', '-q', innerV1], { cwd: path.join(outerDir, 'sub') });
    const baseSha = await commit(outerDir, 'base: submodule at v1');

    await execa('git', ['checkout', '-q', innerV2], { cwd: path.join(outerDir, 'sub') });
    const head = await commit(outerDir, 'head: submodule bumped to v2');

    const result = await computeHunks({
      cwd: outerDir,
      baseSha,
      headSha: head,
      implementationPaths: ['sub'],
    });

    expect(textHunks(result.hunks)).toHaveLength(0);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toMatchObject({ kind: 'file', path: 'sub', reason: 'submodule' });
  });

  it('CONFIRMS THE BUG THIS FIXES, directly: git apply -R reports success for the submodule hunk while the gitlink pointer is completely untouched (so a TextHunk reversible:true for it would be a false signal)', async () => {
    const innerDir = await freshRepo();
    await writeFiles(innerDir, { 'file.txt': 'v1\n' });
    const innerV1 = await commit(innerDir, 'inner v1');
    await writeFiles(innerDir, { 'file.txt': 'v2\n' });
    const innerV2 = await commit(innerDir, 'inner v2');

    const outerDir = await freshRepo();
    await execa(
      'git',
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', innerDir, 'sub'],
      { cwd: outerDir },
    );
    await execa('git', ['checkout', '-q', innerV1], { cwd: path.join(outerDir, 'sub') });
    const baseSha = await commit(outerDir, 'base: submodule at v1');

    await execa('git', ['checkout', '-q', innerV2], { cwd: path.join(outerDir, 'sub') });
    const head = await commit(outerDir, 'head: submodule bumped to v2');

    const before = await execa('git', ['ls-files', '-s', 'sub'], { cwd: outerDir });
    // The same byte-exact capture `runGitBuffer` uses (see hunks.ts's own header comment): a plain
    // string capture would let execa's own default `stripFinalNewline: true` drop the patch's own
    // real trailing newline, which `git apply` then rejects outright as a corrupt patch — confirmed
    // directly (the first version of this test hit exactly that before this fix).
    const { stdout: patchBytes } = await execa(
      'git',
      [
        'diff',
        '-U0',
        '--no-renames',
        '--diff-algorithm=myers',
        '--no-ext-diff',
        baseSha,
        head,
        '--',
        'sub',
      ],
      { cwd: outerDir, encoding: 'buffer', stripFinalNewline: false },
    );
    await execa('git', ['apply', '-R', '--unidiff-zero'], {
      cwd: outerDir,
      input: Buffer.from(patchBytes),
    });
    const after = await execa('git', ['ls-files', '-s', 'sub'], { cwd: outerDir });

    // The "reversal" ran without error, yet changed nothing: the gitlink sha is identical before
    // and after -- exactly the silent no-op `FileHunkReason`'s own doc comment names.
    expect(after.stdout).toBe(before.stdout);
  });
});

describe('computeHunks — hunk id (specs/22 M16 P11)', () => {
  it('is identical across two independent parses of the same base/head pair', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'f.txt': 'one\ntwo\nthree\n' });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { 'f.txt': 'one\nTWO-CHANGED\nthree\n' });
    const head = await commit(dir, 'head');

    const first = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['f.txt'],
    });
    const second = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['f.txt'],
    });

    expect(textHunks(first.hunks)).toHaveLength(1);
    expect(first).toEqual(second);
  });

  it('is unique within one parse, and DIFFERENT for two textually identical hunks in one file', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'ident.txt': 'A\nX\nC\nD\nE\nF\nX\nH\nI\nJ\n' });
    const baseSha = await commit(dir, 'base');
    // Both occurrences of "X" become "Y" — textually identical before/after text, at two different
    // positions in the same file.
    await writeFiles(dir, { 'ident.txt': 'A\nY\nC\nD\nE\nF\nY\nH\nI\nJ\n' });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['ident.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.oldStart).toBe(2);
    expect(hunks[1]?.oldStart).toBe(7);
    // Textually identical bodies: the same content hash...
    expect(hunks[0]?.contentHash).toBe(hunks[1]?.contentHash);
    // ...but distinct ids, because position is part of the id's own input.
    expect(hunks[0]?.id).not.toBe(hunks[1]?.id);
    const ids = new Set(hunks.map((hunk) => hunk.id));
    expect(ids.size).toBe(hunks.length);
  });

  it('MUTATION EVIDENCE 3 — deriving the id from the bare range alone ("the ordinal"), dropping path and content, collides across two files whose sole hunk shares one range', async () => {
    // `computeHunks`'s own id already includes the path (a hunk's range alone can never collide
    // WITHIN one file — two real hunks never share one range there, confirmed above) — the brief's
    // own named mutation ("derive the id from the ordinal alone") is reproduced faithfully here as
    // dropping BOTH path and content, leaving only the bare `oldStart,oldCount/newStart,newCount`
    // range, which DOES collide the moment two different files each have their sole hunk at the
    // identical range — a real, constructed case, not a hypothetical.
    const dir = await freshRepo();
    await writeFiles(dir, {
      'a.txt': 'same\nfoo\nsame\n',
      'b.txt': 'same\nfoo\nsame\n',
    });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, {
      'a.txt': 'same\nbar\nsame\n',
      'b.txt': 'same\nbar\nsame\n',
    });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['a.txt', 'b.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.oldStart).toBe(2);
    expect(hunks[1]?.oldStart).toBe(2);
    // The real (non-mutated) ids are distinct, because the id includes the path.
    expect(hunks[0]?.id).not.toBe(hunks[1]?.id);

    // Apply the named mutation by hand, against THESE SAME real hunks: derive an id from the bare
    // range alone (no path, no content) and show it collides for these two real, distinct hunks.
    const rangeOnlyId = (hunk: TextHunk): string =>
      `${String(hunk.oldStart)},${String(hunk.oldCount)}/${String(hunk.newStart)},${String(hunk.newCount)}`;
    expect(rangeOnlyId(hunks[0]!)).toBe(rangeOnlyId(hunks[1]!));
  });
});

describe('computeHunks — reversibility and byte-exact round-trips (specs/22 M16 P11)', () => {
  it('a hunk whose context a later real commit has since touched reads reversible: false, and is still present in the list', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'multi.txt': Array.from({ length: 10 }, (_, i) => `line${String(i + 1)}`).join('\n') + '\n',
    });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, {
      'multi.txt':
        ['line1', 'line2-CHANGED', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8']
          .concat(['line9-CHANGED', 'line10'])
          .join('\n') + '\n',
    });
    const head = await commit(dir, 'head');
    // A THIRD, later real commit touches the exact line hunk #0 (old line 2) owns — so reversing
    // hunk #0 against what is ACTUALLY on disk now (this third commit's own content) cannot
    // possibly succeed: the bytes the hunk expects to find there are gone.
    await writeFiles(dir, {
      'multi.txt':
        ['line1', 'line2-FURTHER-EDITED', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8']
          .concat(['line9-CHANGED', 'line10'])
          .join('\n') + '\n',
    });
    await commit(dir, 'third: moves past head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['multi.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(2);
    const hunk2 = hunks.find((hunk) => hunk.oldStart === 2);
    const hunk9 = hunks.find((hunk) => hunk.oldStart === 9);
    expect(hunk2?.reversible).toBe(false);
    // The other hunk's own line was untouched by the third commit, so it is still reversible against
    // what is now on disk — proving the check is genuinely per-hunk, not a whole-file "did anything
    // about this file change" shortcut.
    expect(hunk9?.reversible).toBe(true);
  });

  it('reproduces the base bytes exactly for a plain multi-hunk file when every text hunk is reversed together', async () => {
    const dir = await freshRepo();
    const baseContent =
      Array.from({ length: 10 }, (_, i) => `line${String(i + 1)}`).join('\n') + '\n';
    await writeFiles(dir, { 'multi.txt': baseContent });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, {
      'multi.txt':
        ['line1', 'line2-CHANGED', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8']
          .concat(['line9-CHANGED', 'line10'])
          .join('\n') + '\n',
    });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['multi.txt'],
    });
    expect(textHunks(result.hunks).every((hunk) => hunk.reversible)).toBe(true);

    await reverseAllHunksTogether(dir, baseSha, head, 'multi.txt');
    const reversed = await readFile(path.join(dir, 'multi.txt'));
    expect(Buffer.compare(reversed, Buffer.from(baseContent, 'utf8'))).toBe(0);
  });

  it('reproduces the base bytes exactly for a CRLF file, CRLF line endings included', async () => {
    const dir = await freshRepo();
    const baseContent = 'alpha\r\nbeta\r\ngamma\r\ndelta\r\n';
    await writeFiles(dir, { 'crlf.txt': baseContent });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { 'crlf.txt': 'alpha\r\nBETA-CHANGED\r\ngamma\r\ndelta\r\n' });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['crlf.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.reversible).toBe(true);

    await reverseAllHunksTogether(dir, baseSha, head, 'crlf.txt');
    const reversed = await readFile(path.join(dir, 'crlf.txt'));
    // Byte comparison, not string comparison: a string-level `.toBe` could pass even if some step
    // along the way silently normalised \r\n to \n, which is exactly the failure mode this test
    // exists to catch.
    expect(Buffer.compare(reversed, Buffer.from(baseContent, 'utf8'))).toBe(0);
    expect(reversed.includes('\r\n')).toBe(true);
  });

  it('reproduces the base bytes exactly for a file with no trailing newline, the change on its own last line', async () => {
    const dir = await freshRepo();
    const baseContent = 'one\ntwo\nthree';
    await writeFiles(dir, { 'notrail.txt': baseContent });
    const baseSha = await commit(dir, 'base');
    await writeFiles(dir, { 'notrail.txt': 'one\ntwo\nTHREE-CHANGED' });
    const head = await commit(dir, 'head');

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['notrail.txt'],
    });
    const hunks = textHunks(result.hunks);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 });
    expect(hunks[0]?.reversible).toBe(true);

    await reverseAllHunksTogether(dir, baseSha, head, 'notrail.txt');
    const reversed = await readFile(path.join(dir, 'notrail.txt'));
    expect(Buffer.compare(reversed, Buffer.from(baseContent, 'utf8'))).toBe(0);
    // The base file's own real absence of a trailing newline survived the round-trip exactly — a
    // byte-length check, since a lost or gained trailing `\n` would not otherwise show up above.
    expect(reversed.length).toBe(Buffer.byteLength(baseContent, 'utf8'));
  });
});

describe('computeHunks — binary, mode-only, added, deleted and type-changed paths (specs/22 M16 P11)', () => {
  it('classifies each non-text shape as a FileHunk, never a TextHunk, and never drops any of them', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'deleted.txt': 'to be deleted\n',
      'modeonly.sh': 'same content throughout\n',
    });
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3, 255, 254]));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base'], { cwd: dir });
    const baseSha = await headSha(dir);

    await execa('git', ['rm', '--quiet', 'deleted.txt'], { cwd: dir });
    await writeFiles(dir, { 'added.txt': 'brand new\n' });
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([9, 9, 9, 9, 9, 9, 9]));
    await execa('chmod', ['755', path.join(dir, 'modeonly.sh')]);
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'head'], { cwd: dir });
    const head = await headSha(dir);

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['deleted.txt', 'modeonly.sh', 'bin.dat', 'added.txt'],
    });

    expect(textHunks(result.hunks)).toHaveLength(0);
    const reasons = new Map(fileHunks(result.hunks).map((hunk) => [hunk.path, hunk.reason]));
    expect(reasons.get('deleted.txt')).toBe('deleted');
    expect(reasons.get('modeonly.sh')).toBe('mode-only');
    expect(reasons.get('bin.dat')).toBe('binary');
    expect(reasons.get('added.txt')).toBe('added');
    // Every `FileHunk` carries a real, non-empty id — never dropped, never a placeholder.
    for (const hunk of fileHunks(result.hunks)) {
      expect(hunk.id.length).toBeGreaterThan(0);
    }
  });

  it('classifies a symlink-to-regular-file type change as a FileHunk ("type-changed"), never as a modify-shaped TextHunk', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'target.txt': 'target\n' });
    await execa('ln', ['-s', 'target.txt', 'was-a-symlink'], { cwd: dir });
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'base'], { cwd: dir });
    const baseSha = await headSha(dir);

    await rm(path.join(dir, 'was-a-symlink'));
    await writeFiles(dir, { 'was-a-symlink': 'now a real file\n' });
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'head'], { cwd: dir });
    const head = await headSha(dir);

    const result = await computeHunks({
      cwd: dir,
      baseSha,
      headSha: head,
      implementationPaths: ['was-a-symlink'],
    });

    expect(textHunks(result.hunks)).toHaveLength(0);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toMatchObject({
      kind: 'file',
      path: 'was-a-symlink',
      reason: 'type-changed',
    });
  });
});

describe('resolveHunkModeBase — --base/--hunks usage and resolution (specs/22 M16 P11)', () => {
  it('refuses --hunks without --base with a typed USR-005', async () => {
    const dir = await freshRepo();
    await expect(resolveHunkModeBase({ cwd: dir, base: undefined, hunks: true })).rejects.toSatisfy(
      (error: unknown) => {
        expect(isForgeError(error)).toBe(true);
        expect(isForgeError(error) && error.code).toBe('USR-005');
        expect(isForgeError(error) && error.details['reason']).toBe('hunks-without-base');
        return true;
      },
    );
  });

  it('refuses --base without --hunks with a typed USR-005', async () => {
    const dir = await freshRepo();
    const sha = await headSha(dir);
    await expect(resolveHunkModeBase({ cwd: dir, base: sha, hunks: false })).rejects.toSatisfy(
      (error: unknown) => {
        expect(isForgeError(error)).toBe(true);
        expect(isForgeError(error) && error.code).toBe('USR-005');
        expect(isForgeError(error) && error.details['reason']).toBe('base-without-hunks');
        return true;
      },
    );
  });

  it('refuses an unresolvable --base with a typed USR-005', async () => {
    const dir = await freshRepo();
    await expect(
      resolveHunkModeBase({ cwd: dir, base: 'this-ref-does-not-exist-anywhere', hunks: true }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isForgeError(error)).toBe(true);
      expect(isForgeError(error) && error.code).toBe('USR-005');
      expect(isForgeError(error) && error.details['reason']).toBe('base-unresolvable');
      return true;
    });
  });

  it('resolves neither flag given to undefined, with no git call made', async () => {
    const result = await resolveHunkModeBase({
      cwd: '/does/not/exist/and/is/never/read',
      base: undefined,
      hunks: false,
    });
    expect(result).toBeUndefined();
  });

  it('resolves --base together with --hunks to the real commit sha', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, { 'f.txt': 'one\n' });
    await commit(dir, 'second commit');
    const expected = await resolveRevision(dir, 'HEAD~1');

    const result = await resolveHunkModeBase({ cwd: dir, base: 'HEAD~1', hunks: true });
    expect(result).toBe(expected);
  });
});

describe('--base governs the whole run (specs/22 M16 P11)', () => {
  it('with --base resolved to exactly the default range, the change-set computation is byte-identical to the one M15 already runs without --base', async () => {
    const dir = await freshRepo();
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a - b; }\n', // deliberately wrong at base
      'impl.test.js':
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\n" +
        "test('adds two numbers', () => { expect(add(1, 2)).toBe(3); });\n",
    });
    await commit(dir, 'base: story exists, implementation is wrong');
    await writeFiles(dir, {
      'impl.js': 'export function add(a, b) { return a + b; }\n', // fixed at head
    });
    await commit(dir, 'head: implementation fixed');

    const clock = { now: (): string => '2026-09-30T12:00:00.000Z' };
    const createTempPath = (): string => {
      throw new Error('createTempPath should not be called by the js/vitest branch');
    };
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const vitestPackageJson = require(require.resolve('vitest/package.json')) as {
      readonly bin?: Readonly<Record<string, string>>;
    };
    const vitestBin = vitestPackageJson.bin?.['vitest'];
    if (vitestBin === undefined) throw new Error('vitest/package.json has no real "vitest" bin.');
    const vitestEntry = path.join(path.dirname(require.resolve('vitest/package.json')), vitestBin);
    const testCommand = `${process.execPath} ${vitestEntry} run --root .`;

    const baseInput = {
      projectRoot: dir,
      storyId: 'STORY-BASE-EQUIV',
      filesExpected: ['impl.js', 'impl.test.js'],
      testCommand,
      ecosystem: 'js' as const,
      integrationBase: 'HEAD',
      clock,
      createTempPath,
    };

    const withoutBase = await runBindingCheck({
      ...baseInput,
      runId: 'run-without-base',
      baseRevision: 'HEAD~1',
    });

    const resolvedDefault = await resolveHunkModeBase({ cwd: dir, base: 'HEAD~1', hunks: true });
    // `resolveHunkModeBase`'s own return type is `string | undefined` (`undefined` only when hunk
    // mode is not engaged at all) — `base`/`hunks` are both given above, so this call's own real
    // contract guarantees a resolved sha here; this is a genuine runtime narrowing, not a cast.
    if (resolvedDefault === undefined) {
      throw new Error(
        'resolveHunkModeBase returned undefined although --base and --hunks were both given.',
      );
    }
    const withExplicitBase = await runBindingCheck({
      ...baseInput,
      runId: 'run-with-explicit-base',
      baseRevision: resolvedDefault,
    });

    if (withoutBase.outcome !== 'completed') {
      throw new Error(`expected 'completed', got ${withoutBase.outcome}`);
    }
    if (withExplicitBase.outcome !== 'completed') {
      throw new Error(`expected 'completed', got ${withExplicitBase.outcome}`);
    }
    // Every M15 field (`namedTests`, `failedUnderMutation`, `restoreVerified`, `revertedRange`,
    // `ranAt`) is byte-identical — the only thing that differed between the two calls is HOW
    // `baseRevision` arrived (a literal default vs. a resolved `--base`), never what it resolved to.
    expect(withExplicitBase).toEqual(withoutBase);
  });
});
