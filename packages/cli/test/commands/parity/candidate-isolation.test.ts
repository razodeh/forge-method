/**
 * `withParityDirHidden` — makes `.forge/parity/` absent for the duration of a callback, closing the
 * self-reverting-tamper gap `specs/22` M16 P7 / `SPEC-QUESTIONS.md` Q294 Decision 7 disclosed rather
 * than closed (`specs/22` M17 P14).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import {
  recoverOrphanedParityDir,
  withParityDirHidden,
} from '../../../src/commands/parity/candidate-isolation.ts';

const SIGNAL_HARNESS_PATH = path.join(import.meta.dirname, 'fixtures/isolation-signal-harness.ts');

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p14-isolation-'));
  dirs.push(dir);
  return dir;
}

describe('withParityDirHidden: the ordinary case -- hide, run, restore (specs/22 M17 P14)', () => {
  it('makes .forge/parity/ genuinely absent for the duration of fn, then restores it byte-for-byte', async () => {
    const root = await freshRoot();
    await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
    await writeFile(
      path.join(root, '.forge', 'parity', 'sample.parity.yaml'),
      'original: true\n',
      'utf8',
    );

    let sawItAbsentDuringFn = false;
    const result = await withParityDirHidden(root, async () => {
      sawItAbsentDuringFn = !(await pathExists(path.join(root, '.forge', 'parity')));
      return 'fn-result';
    });

    expect(sawItAbsentDuringFn).toBe(true);
    expect(result).toBe('fn-result');
    const restored = await readFile(
      path.join(root, '.forge', 'parity', 'sample.parity.yaml'),
      'utf8',
    );
    expect(restored).toBe('original: true\n');
  });

  it('a command that READS the now-absent directory gets ENOENT, exactly what closes the tamper gap', async () => {
    const root = await freshRoot();
    await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
    await writeFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'x', 'utf8');

    await expect(
      withParityDirHidden(root, async () => {
        await readFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'utf8');
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    // Restored anyway -- fn's own failure never leaves the directory permanently hidden.
    const restored = await readFile(
      path.join(root, '.forge', 'parity', 'sample.parity.yaml'),
      'utf8',
    );
    expect(restored).toBe('x');
  });

  it('is a genuine no-op (no hide, no restore, no error) when the project has no .forge/parity/ at all', async () => {
    const root = await freshRoot();
    const result = await withParityDirHidden(root, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(await pathExists(path.join(root, '.forge', 'parity'))).toBe(false);
  });

  it('works even when .forge/state/ does not exist yet (the rename target’s own parent must be created)', async () => {
    const root = await freshRoot();
    await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
    await writeFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'x', 'utf8');
    // No `.forge/state/` created here at all -- the real bug this test pins (found via a real
    // end-to-end test run, not invented): `rename`'s own target needs its parent directory to exist.
    const result = await withParityDirHidden(root, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(await readFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'utf8')).toBe(
      'x',
    );
  });
});

describe(
  'withParityDirHidden (specs/22 M17 P14): fn’s own thrown error always wins over this module’s ' +
    'own bookkeeping',
  () => {
    it('propagates a non-ForgeError thrown by fn unchanged, after still restoring the directory', async () => {
      const root = await freshRoot();
      await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
      await writeFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'x', 'utf8');

      await expect(
        withParityDirHidden(root, () => Promise.reject(new Error('fn’s own real failure'))),
      ).rejects.toThrow('fn’s own real failure');

      expect(await pathExists(path.join(root, '.forge', 'parity'))).toBe(true);
    });
  },
);

describe(
  'withParityDirHidden (specs/22 M17 P14): a command that RE-CREATES .forge/parity/ while it is ' +
    'supposed to be absent is refused, never silently restored over',
  () => {
    it('throws a typed ForgeError RUN-153 when fn succeeds but leaves a NEW .forge/parity/ behind', async () => {
      const root = await freshRoot();
      await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
      await writeFile(
        path.join(root, '.forge', 'parity', 'sample.parity.yaml'),
        'original',
        'utf8',
      );

      let caught: unknown;
      try {
        await withParityDirHidden(root, async () => {
          // Recreates the directory from scratch, as a misbehaving command's own `mkdir -p` might.
          await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
          await writeFile(path.join(root, '.forge', 'parity', 'new-file.yaml'), 'new', 'utf8');
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForgeError);
      expect((caught as ForgeError).code).toBe('RUN-153');

      // Neither side's content was clobbered: the ORIGINAL directory (hidden, not deleted) and the
      // command's own re-created one both still exist on disk somewhere under `.forge/`.
      expect(
        await readFile(
          path.join(root, '.forge', 'state', 'parity-isolated', 'sample.parity.yaml'),
          'utf8',
        ),
      ).toBe('original');
      expect(await readFile(path.join(root, '.forge', 'parity', 'new-file.yaml'), 'utf8')).toBe(
        'new',
      );
    });

    it('also throws RUN-153 when .forge/parity/ did not exist beforehand, and fn creates one anyway', async () => {
      const root = await freshRoot();
      let caught: unknown;
      try {
        await withParityDirHidden(root, async () => {
          await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ForgeError);
      expect((caught as ForgeError).code).toBe('RUN-153');
    });

    it(
      'specs/22 M17 P14: RUN-153 fires even when fn BOTH recreates the directory AND throws its ' +
        'own error -- a real gap a gauntlet round found: the original catch branch checked for ' +
        'recreation only on the success path, so a command that tampered and then failed slipped ' +
        'past undetected, with its own unrelated error masking the real signal',
      async () => {
        const root = await freshRoot();
        await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
        await writeFile(
          path.join(root, '.forge', 'parity', 'sample.parity.yaml'),
          'original',
          'utf8',
        );

        let caught: unknown;
        try {
          await withParityDirHidden(root, async () => {
            await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
            await writeFile(path.join(root, '.forge', 'parity', 'new-file.yaml'), 'new', 'utf8');
            throw new Error('the command’s own unrelated failure, after also recreating the dir');
          });
        } catch (error) {
          caught = error;
        }
        // RUN-153 wins over fn's own thrown error -- not the other way around (see
        // `withParityDirHidden`'s own doc comment for why this one case is a deliberate exception
        // to "a real failure always wins").
        expect(caught).toBeInstanceOf(ForgeError);
        expect((caught as ForgeError).code).toBe('RUN-153');
        expect(
          await readFile(
            path.join(root, '.forge', 'state', 'parity-isolated', 'sample.parity.yaml'),
            'utf8',
          ),
        ).toBe('original');
      },
    );
  },
);

describe(
  'withParityDirHidden (specs/22 M17 P14): an ordinary interrupt restores the directory, never ' +
    'leaving it permanently hidden',
  () => {
    it(
      'a real SIGINT delivered mid-observation (an ordinary Ctrl+C, not an adversarial scenario) ' +
        'restores .forge/parity/ before the process exits, with the shell’s own conventional 130 ' +
        'exit code',
      async () => {
        const root = await freshRoot();
        await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
        await writeFile(
          path.join(root, '.forge', 'parity', 'sample.parity.yaml'),
          'original',
          'utf8',
        );

        const child = execa(
          'node',
          ['--experimental-strip-types', '--no-warnings', SIGNAL_HARNESS_PATH, root],
          { reject: false },
        );
        // Waits for the child's own real proof that the window is open (never a fixed sleep guessing
        // at timing): it prints `HIDDEN` the instant `withParityDirHidden`'s callback starts.
        await new Promise<void>((resolve, reject) => {
          child.stdout.on('data', (chunk: Buffer) => {
            if (chunk.toString('utf8').includes('HIDDEN')) resolve();
          });
          child.catch(reject);
        });
        expect(await pathExists(path.join(root, '.forge', 'parity'))).toBe(false);

        child.kill('SIGINT');
        const result = await child;
        expect(result.exitCode).toBe(130);
        expect(
          await readFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'utf8'),
        ).toBe('original');
      },
      15_000,
    );
  },
);

describe(
  'recoverOrphanedParityDir (specs/22 M17 P14): a leftover from a prior, now-dead (SIGKILL’d) ' +
    'invocation is detected and restored on the next command’s own startup',
  () => {
    it('restores a hidden directory left behind with no corresponding .forge/parity/ present', async () => {
      const root = await freshRoot();
      // Simulates exactly what a `SIGKILL`'d predecessor leaves behind: the hidden copy present,
      // the real path absent -- never produced by calling `withParityDirHidden` itself here (that
      // function always restores on every path it can take), simulating the one path it cannot:
      // a signal no handler can ever catch.
      await mkdir(path.join(root, '.forge', 'state', 'parity-isolated'), { recursive: true });
      await writeFile(
        path.join(root, '.forge', 'state', 'parity-isolated', 'sample.parity.yaml'),
        'orphaned',
        'utf8',
      );

      await recoverOrphanedParityDir(root);

      expect(
        await readFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'utf8'),
      ).toBe('orphaned');
      expect(await pathExists(path.join(root, '.forge', 'state', 'parity-isolated'))).toBe(false);
    });

    it('is a no-op when there is nothing orphaned to recover', async () => {
      const root = await freshRoot();
      await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
      await writeFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'normal', 'utf8');
      await recoverOrphanedParityDir(root);
      expect(
        await readFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'utf8'),
      ).toBe('normal');
    });

    it(
      'is a no-op (never guesses which is "real") when BOTH the real and the hidden directory ' +
        'exist at once -- a shape this module’s own invariants do not predict',
      async () => {
        const root = await freshRoot();
        await mkdir(path.join(root, '.forge', 'parity'), { recursive: true });
        await writeFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'live', 'utf8');
        await mkdir(path.join(root, '.forge', 'state', 'parity-isolated'), { recursive: true });
        await writeFile(
          path.join(root, '.forge', 'state', 'parity-isolated', 'sample.parity.yaml'),
          'orphaned',
          'utf8',
        );

        await recoverOrphanedParityDir(root);

        expect(
          await readFile(path.join(root, '.forge', 'parity', 'sample.parity.yaml'), 'utf8'),
        ).toBe('live');
        expect(
          await readFile(
            path.join(root, '.forge', 'state', 'parity-isolated', 'sample.parity.yaml'),
            'utf8',
          ),
        ).toBe('orphaned');
      },
    );
  },
);

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await readFile(absolutePath);
    return true;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause) {
      if (cause.code === 'ENOENT') return false;
      if (cause.code === 'EISDIR') return true; // it exists, it is just a directory, not a file
    }
    throw cause;
  }
}
