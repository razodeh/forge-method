/**
 * `applyNormalizeRulesToLibraryValueBounded` — the wall-clock budget, enforced by a killable worker
 * thread, that `specs/22` M17 P14's own follow-up (`process/SPEC-QUESTIONS.md` Q317 Decision 8, a
 * critic finding against this piece's own first version) adds around the whole ordered
 * normalize-rule application for a `library` case's structured value — the structural counterpart to
 * `normalize-budget.test.ts`, proving the identical mechanism (a worker thread this module can
 * forcibly terminate) closes the identical class of hazard on `library`'s own path, which had no
 * bound of any kind before this.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q317 Decision 8
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyNormalizeRulesToLibraryValueBounded } from '../../../src/commands/parity/normalize-library-budget.ts';
import { DEFAULT_NORMALIZE_BUDGET_MS } from '../../../src/commands/parity/normalize-budget.ts';

const CRASHING_WORKER_URL = new URL(
  './fixtures/crashing-normalize-library-worker.ts',
  import.meta.url,
);
const CRASHING_NO_HANDLER_WORKER_URL = new URL(
  './fixtures/crashing-no-handler-library-worker.ts',
  import.meta.url,
);

describe('applyNormalizeRulesToLibraryValueBounded: the fast path (specs/22 M17 P14) -- Q317 Decision 8 follow-up', () => {
  it(
    'spawns NO worker at all when rules contains neither ignore-json-pointers nor ' +
      'redact-json-pointers (a critic’s own recommendation, closing a measured ~14,500x ' +
      'per-case overhead for the common case of a library declaration with no relevant rules)',
    () => {
      // Proven by pointing `workerUrl` at a file that does not exist: if this call ever actually
      // tried to spawn a worker, `new Worker(...)` would throw synchronously (a real, directly
      // confirmed failure mode for a bad module specifier) -- reaching the assertion below at all
      // is already the proof that no worker was spawned, not merely that one finished fast.
      const nonExistentWorkerUrl = new URL(
        './fixtures/this-file-does-not-exist.ts',
        import.meta.url,
      );
      const outcome = applyNormalizeRulesToLibraryValueBounded(
        { message: 'anything' },
        [{ rule: 'line-endings' }, { rule: 'replace', pattern: 'a', replacement: 'b' }],
        1000,
        nonExistentWorkerUrl,
      );
      expect(outcome).toEqual({ status: 'ok', ok: true, value: { message: 'anything' } });
    },
  );

  it('still spawns the real worker when a redact-json-pointers rule IS present (the fast path never shortcuts a rule that does something real)', () => {
    const outcome = applyNormalizeRulesToLibraryValueBounded(
      { message: '/real/root/a.js' },
      [
        {
          rule: 'redact-json-pointers',
          pointers: ['/message'],
          pattern: '/real/root',
          replacement: '<R>',
        },
      ],
      1000,
    );
    expect(outcome).toEqual({ status: 'ok', ok: true, value: { message: '<R>/a.js' } });
  });

  it('returns the identical outcome applyNormalizeRulesToLibraryValue itself would, for an ordinary rule list', () => {
    const outcome = applyNormalizeRulesToLibraryValueBounded(
      { kept: 1, drop: 2 },
      [{ rule: 'ignore-json-pointers', pointers: ['/drop'] }],
      1000,
    );
    expect(outcome).toEqual({ status: 'ok', ok: true, value: { kept: 1 } });
  });

  it(
    'payloadCapacityBytesFor falls back to a safe size rather than crashing the calling thread ' +
      'on a circular value (a critic’s own recommended robustness fix, QUALITY-BAR.md R2: ' +
      '"currently unreachable" is not a reason to skip this)',
    () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      const outcome = applyNormalizeRulesToLibraryValueBounded(
        circular,
        [{ rule: 'ignore-json-pointers', pointers: ['/nonexistent'] }],
        1000,
      );
      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok' || !outcome.ok) throw new Error('unreachable');
      // The circularity itself survives the real worker round trip too (`node:v8` serialize,
      // which -- unlike `JSON.stringify` -- supports it natively), a bonus confirmation alongside
      // the main point: this call never threw.
      expect((outcome.value as Record<string, unknown>)['self']).toBe(outcome.value);
    },
  );

  it('propagates the erase-everything guard unchanged', () => {
    const outcome = applyNormalizeRulesToLibraryValueBounded(
      { a: 1 },
      [{ rule: 'ignore-json-pointers', pointers: [''] }],
      1000,
    );
    expect(outcome).toEqual({ status: 'ok', ok: false, kind: 'erased' });
  });

  it('propagates a whole-field-match refusal unchanged', () => {
    const outcome = applyNormalizeRulesToLibraryValueBounded(
      { message: 'secret' },
      [{ rule: 'redact-json-pointers', pointers: ['/message'], pattern: '.*', replacement: 'X' }],
      1000,
    );
    expect(outcome).toEqual({
      status: 'ok',
      ok: false,
      kind: 'whole-field-match',
      rule: 'redact-json-pointers',
      pointer: '/message',
    });
  });

  it('reuses the identical exported default (5000ms) applyNormalizeRulesToTextBounded already uses — one shared budget, not a second number', () => {
    expect(DEFAULT_NORMALIZE_BUDGET_MS).toBe(5000);
  });

  it('a value containing NaN/Infinity survives the worker boundary exactly, never silently coerced to null (the real bug an earlier, JSON-based version of this file had)', () => {
    // `node:v8`'s `serialize`/`deserialize`, not `JSON.stringify`/`JSON.parse`, is what makes this
    // true — `normalize-library-worker-protocol.ts`'s own doc comment has the full, confirmed
    // account of the regression this fixes.
    const outcome = applyNormalizeRulesToLibraryValueBounded(
      { a: Number.NaN, b: Number.POSITIVE_INFINITY, c: Number.NEGATIVE_INFINITY },
      [],
      1000,
    );
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok' || !outcome.ok) throw new Error('unreachable');
    const value = outcome.value as { a: number; b: number; c: number };
    expect(Number.isNaN(value.a)).toBe(true);
    expect(value.b).toBe(Number.POSITIVE_INFINITY);
    expect(value.c).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe(
  'applyNormalizeRulesToLibraryValueBounded (specs/22 M17 P14) -- Q317 Decision 8 follow-up: a ' +
    'catastrophic redact-json-pointers pattern is refused by TIME, not hung',
  () => {
    it(
      'a flat-adjacent-unbounded-groups pattern that defeats replace-lint.ts’s own static shape ' +
        'lint (no nested quantifier at all -- that lint’s own disclosed gap) times out within the ' +
        'stated budget, never hanging the calling thread -- the EXACT shape a critic measured real ' +
        'exponential blowup from directly against applyReplace, with nothing on this path able to ' +
        'stop it before this mechanism existed',
      () => {
        const pattern = `${'(a*)'.repeat(20)}b`;
        const budgetMs = 200;

        const started = Date.now();
        const outcome = applyNormalizeRulesToLibraryValueBounded(
          { message: 'a'.repeat(33) },
          [{ rule: 'redact-json-pointers', pointers: ['/message'], pattern, replacement: 'X' }],
          budgetMs,
        );
        const elapsedMs = Date.now() - started;

        expect(outcome).toEqual({ status: 'timed-out' });
        expect(elapsedMs).toBeLessThan(budgetMs + 3000);
      },
    );

    it('a second, independent catastrophic shape (nested quantifier, the kind CFG-511 DOES catch) also times out, not hangs', () => {
      const budgetMs = 200;
      const started = Date.now();
      const outcome = applyNormalizeRulesToLibraryValueBounded(
        { message: `${'a'.repeat(40)}!` },
        [
          {
            rule: 'redact-json-pointers',
            pointers: ['/message'],
            pattern: '(a+)+$',
            replacement: 'X',
          },
        ],
        budgetMs,
      );
      const elapsedMs = Date.now() - started;
      expect(outcome).toEqual({ status: 'timed-out' });
      expect(elapsedMs).toBeLessThan(budgetMs + 3000);
    });
  },
);

describe(
  'applyNormalizeRulesToLibraryValueBounded (specs/22 M17 P14) -- Q317 Decision 8 follow-up: a ' +
    'worker crash is a typed refusal, never a process crash',
  () => {
    it(
      'a worker that crashes WITH the real uncaughtException-signalling contract reports ' +
        '{status: "crashed"} promptly -- not a hang out to the full budget, and not a process crash',
      () => {
        const budgetMs = 5000;
        const started = Date.now();
        const outcome = applyNormalizeRulesToLibraryValueBounded(
          { a: 1 },
          [{ rule: 'ignore-json-pointers', pointers: ['/a'] }],
          budgetMs,
          CRASHING_WORKER_URL,
        );
        const elapsedMs = Date.now() - started;
        expect(outcome).toEqual({
          status: 'crashed',
          detail: 'the normalize-library worker thread terminated before it could report a result',
        });
        expect(elapsedMs).toBeLessThan(1000);
      },
    );

    it(
      'a worker that crashes with NO handler of any kind still cannot crash the calling process ' +
        '-- it is reported as a bounded timeout instead, since nothing signals the crash promptly ' +
        'without the real worker’s own handler',
      () => {
        const budgetMs = 300;
        const started = Date.now();
        const outcome = applyNormalizeRulesToLibraryValueBounded(
          { a: 1 },
          [{ rule: 'ignore-json-pointers', pointers: ['/a'] }],
          budgetMs,
          CRASHING_NO_HANDLER_WORKER_URL,
        );
        const elapsedMs = Date.now() - started;
        expect(outcome).toEqual({ status: 'timed-out' });
        expect(elapsedMs).toBeGreaterThanOrEqual(budgetMs);
        expect(elapsedMs).toBeLessThan(budgetMs + 3000);
      },
    );

    it('the two fixture files really exist on disk at the paths used above (the premise, not assumed)', async () => {
      const { access } = await import('node:fs/promises');
      await expect(
        access(path.join(import.meta.dirname, 'fixtures/crashing-normalize-library-worker.ts')),
      ).resolves.toBeUndefined();
      await expect(
        access(path.join(import.meta.dirname, 'fixtures/crashing-no-handler-library-worker.ts')),
      ).resolves.toBeUndefined();
    });
  },
);
