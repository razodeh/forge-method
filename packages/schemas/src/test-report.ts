/**
 * `forge-test-report` v1 — `09` §9.5's own canonical, versioned JSON test-result shape (post-v1.0,
 * `specs/22` M17). FORGE normalises every other format a project's test command can produce — JUnit
 * XML, TAP, a runner's own native JSON, or a hand- or agent-written translator's output — INTO this
 * one shape before any FORGE command reads a result (`13` F-TEST-7 point 2, F-TEST-11).
 *
 * Only `name` and `status` are required on each entry; every other field is optional, and a consumer
 * that needs a field the project's own test command did not supply degrades to a stated, typed
 * outcome rather than guessing (`09` §9.5). `kind` is additive and applies only when `status` is
 * `'fail'` — enforced here with a cross-field refinement, since a producer that sets it on a pass or
 * a skip is not a conforming `forge-test-report` writer, not a merely-unusual one.
 *
 * `message` (Q346, post-v1.0, `specs/22` M17 P21) is free-text detail about why a test did not pass —
 * the one thing v1 had no field for at all, confirmed live by a real translator that had this text on
 * hand and nowhere to put it. Deliberately NOT restricted to `'fail'` the way `kind` is: a `'skip'`
 * commonly carries its own real reason text a producer already has (JUnit's `<skipped
 * message="...">`, pytest's `skip(reason=...)`, a Jest/Vitest deliberate-skip annotation) — this
 * is a real, different thing from `kind`, which has no "kind of pass" or "kind of skip" to classify,
 * only a "kind of failure." `message` is therefore valid on `'fail'` or `'skip'`, refused only on
 * `'pass'` (enforced below) — a passing test has nothing to explain. Optional throughout: not every
 * translator can recover this text from its underlying format at all (TAP13's YAML diagnostic block
 * conventionally carries its own `message:` key, but no built-in `tap` parser in
 * `packages/cli/src/commands/loop/test/parsers/` reads that block today, still deferred). Of the
 * other built-in parsers there: `junit-xml.ts` reads this from `<failure>`/`<error>`/`<skipped>`'s
 * own `message` attribute or text content (round-3 critic: delivery was proven end to end, so this
 * capture -- the data was already sitting right there, unread -- was wired through rather than left
 * deferred); `vitest-json.ts` carries the hook's own already-computed message onto every entry its
 * top-level hook-throw reclassification touches (`parseVitestJson`'s own doc comment; round-2
 * critic). Jest's per-assertion `failureMessages` is still never read, and both Jest's and Vitest's
 * parsers still fold a captured file-level message into a synthetic entry's `name` instead, for an
 * unrelated, pre-existing reason (a whole file that failed to load) -- left as-is, real but smaller
 * gaps than the two just closed. The field exists and validates regardless of which producer
 * populates it; a future translator (hand-written, or `forge test adopt` agent-authored) populates
 * it directly, the same way `forge-json` already passes any entry through unchanged, and
 * `reporter.ts`'s own `outcomeFromReportEntry` already carries it as far as `TestOutcome` for both
 * real call sites (`runTranslator`, `PARSERS[format]`) -- a human/agent-facing consumer reads it via
 * `packages/cli/src/commands/story.ts`'s own `namedOutcome`, for a `'fail'` AND, as of round 3, a
 * `'skip'` outcome too (its own "every test skipped?" message).
 *
 * @see specs/09 §9.5
 * @see specs/22 M17 P3, M17 P21 (Q346)
 */
import { z } from 'zod';

/** `09` §9.5's own three outcomes. */
export const TEST_REPORT_STATUSES = ['pass', 'fail', 'skip'] as const;

/** `09` §9.5's own four failure kinds — meaningful only when `status: 'fail'`. `'assertion'` is the
 * conservative default a consumer reads when the source format carries no finer signal than
 * pass/fail (TAP, for one); this schema never fills that default in itself — an absent `kind` on a
 * `'fail'` entry is a valid, honest "this format did not say," left to each consumer (`13` F-TEST-10)
 * to read as `'assertion'` on its own. */
export const TEST_REPORT_FAILURE_KINDS = ['assertion', 'load', 'timeout', 'crash'] as const;

const forgeTestReportEntrySchema = z
  .object({
    name: z.string().min(1),
    file: z.string().min(1).optional(),
    status: z.enum(TEST_REPORT_STATUSES),
    kind: z.enum(TEST_REPORT_FAILURE_KINDS).optional(),
    durationMs: z.number().nonnegative().optional(),
    acId: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.kind !== undefined && entry.status !== 'fail') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: `"kind" (${entry.kind}) is only meaningful when "status" is "fail" (09 §9.5); this entry's status is "${entry.status}".`,
      });
    }
    if (entry.message !== undefined && entry.status === 'pass') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: `"message" is not meaningful on a "pass" (09 §9.5, Q346): a passing test has nothing to explain.`,
      });
    }
  });

/** One `forge-test-report` v1 entry. */
export type ForgeTestReportEntry = z.infer<typeof forgeTestReportEntrySchema>;

/** `09` §9.5's own top-level shape: `{forgeTestReport: 1, tests: [...]}`. The version number is a
 * literal, not a range — a future v2 is a new, explicitly-versioned schema, not a silently
 * compatible extension of this one. */
export const forgeTestReportSchema = z
  .object({
    forgeTestReport: z.literal(1),
    tests: z.array(forgeTestReportEntrySchema),
  })
  .strict();

/** A validated `forge-test-report` v1 document. */
export type ForgeTestReport = z.infer<typeof forgeTestReportSchema>;

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Parses `raw` as a `forge-test-report` v1 document.
 *
 * Never throws: malformed JSON, a wrong top-level shape, and a schema-invalid entry are each a real,
 * diagnosable `{ok: false, message}` — the same "never guess, never crash on untrusted tool output"
 * contract every other reader of adapter/tool output in this codebase already follows. Emptiness
 * (`tests: []`) is deliberately NOT treated as a failure here: a project's own zero-tests guard
 * (`loop/test/run.ts`) is a separate, higher-level concern than "did this parse."
 */
export function parseForgeTestReport(
  raw: string,
):
  | { readonly ok: true; readonly report: ForgeTestReport }
  | { readonly ok: false; readonly message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { ok: false, message: `not valid JSON: ${describeCause(cause)}` };
  }
  const result = forgeTestReportSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      message: `does not match the forge-test-report v1 shape (09 §9.5): ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
    };
  }
  return { ok: true, report: result.data };
}
