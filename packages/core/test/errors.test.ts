/**
 * `ForgeError` — the error taxonomy every FORGE failure uses.
 *
 * Written from `specs/02` §2.6, which fixes the code prefixes, the required fields and the process
 * exit codes. `specs/22` M1 states the acceptance bluntly: "A `ForgeError` without a `remedy` fails
 * review." These tests enforce that mechanically rather than leaving it to a reader.
 *
 * @see specs/02 §2.6
 */
import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  ERROR_CODE_PREFIXES,
  ForgeError,
  docsUrlFor,
  errorDefinition,
  renderValue,
  exitCodeFor,
  formatForTerminal,
  isForgeError,
} from '../src/index.ts';

/**
 * A superset of every code's declared details, for the tests that iterate the whole registry.
 *
 * Deliberately a single bag rather than a per-code table: a code whose message reads a key not
 * listed here renders `<missing>`, and the exhaustive test below asserts that never happens — so
 * adding a code without adding its keys fails, which is the point.
 */
const SAMPLE_DETAILS = {
  // `RUN-082` (`PLAN-M13.md` P10): a stage id no Epic declares.
  stageId: 'mvp',
  // `VCS-010`/`BUD-003`/`RUN-085` (`PLAN-M13.md` P12): a dirty working tree; an admission refusal by a
  // budget cap (`stepId`, `cap`, `spent` are declared elsewhere in this table); a failed run's diagnosis.
  count: 2,
  files: 'run.err, run.out',
  reservation: '$3.00',
  remaining: '$1.50',
  summary: '1 step(s) failed (retro:run-retro)',
  // `CFG-053`/`RUN-079` (`PLAN-M13.md` P1): a brief/prompt reference.
  reference: 'briefs/write-vision.md',
  // `RUN-080`/`CFG-054` (`PLAN-M13.md` P5): an adapter that cannot carry a system prompt; a bad
  // `security.toolCeilingEscalations` entry.
  adapterId: 'generic',
  index: 0,
  path: '.forge/config.yaml',
  root: '/repo',
  operation: 'write',
  line: 12,
  pid: 4242,
  host: 'build-01',
  tool: 'git',
  reason: 'rate limit',
  lane: 'feat/story-014',
  artifact: 'STORY-014',
  expectedParent: 'EPIC-003',
  entry: 'KB-ARCH-0007',
  conflictsWith: 'ADR-0011',
  reviewBy: '2026-06-11',
  observed: '61%',
  threshold: '80%',
  step: 'implement',
  budget: '10m',
  cap: '$12.00',
  spent: '$12.40',
  gate: 'G-Verify',
  issue: 'bad indentation at line 3',
  issues: 'title: Required',
  section: 'Context',
  type: 'Story',
  idWidth: 3,
  test: 'AC-014-1 AC-014-2 combined validation',
  acs: 'AC-014-1, AC-014-2',
  acId: 'AC-014-2',
  stories: 'STORY-014, STORY-015',
  detail: 'unrecognised operator $appand',
  phase: 'INTAKE',
  id: 'review',
  role: 'reviewer',
  gateId: 'G-Verify',
  checkId: 'coverage.min',
  autonomy: 'supervised',
  edgeKind: 'STORY->ACCEPTANCE_CRITERION',
  subsystem: 'the event log',
  agentId: 'sap-integrator',
  missing: 'file_ownership',
  capability: 'exec',
  field: 'write',
  location: '.forge/overrides/skills/acme-standards/SKILL.md',
  level: 'L2',
  kind: 'flowchart',
  diagramId: 'DIAG-014',
  src: 'architecture/views/containers.mmd',
  generator: 'components-to-c4',
  entryId: 'KB-ARCH-0007',
  budgetTokens: 5000,
  template: 'forge/integration/{{stageId}}',
  placeholder: 'stageId',
  parseError: 'Unexpected token "&&".',
  maxDepth: 200,
  expiresAt: '2026-01-01T00:00:00.000Z',
  stepId: 'design:review',
  vcsCode: 'VCS-GIT-OPERATION-FAILED',
  vcsMessage: 'git worktree add failed: already exists',
  telemetryCode: 'TELEMETRY-EVENT-LOG-WRITE-FAILED',
  telemetryMessage: 'ENOSPC: no space left on device',
  conflict: 'both-modified',
  status: 'succeeded',
  attemptCount: 0,
  attemptNumber: 0,
  required: '20.10.0',
  actual: 'v18.17.0',
  flag: '--model-tier',
  value: 'ludicrous',
  mode: 'panel',
  feature: 'kb diff',
  got: 'FORGE_ASK',
  laneId: 'run-014-implement-a1b2c3d4',
  workflowId: 'plan-stage',
  runId: 'run-014-implement',
  installed: '1.2.0',
  requested: '1.0.0',
  question: 'How do we ship faster?',
  sessionType: 'brainstorm',
  expected: 'CONVERGE',
  techniqueId: 'scamper',
  agentCount: 7,
  moduleId: 'fm-service',
  requires: 'fm-core',
  forgeVersion: '1.4.0',
  confidence: 'high',
  ceiling: 'medium',
  source: './acme-standards',
  spec: 'git+https://example.com/acme/repo.git#v1.0.0',
  limit: 67108864,
  bundlePath: '/tmp/forge-fetch-acme-standards',
  findings: ['skills/rogue/SKILL.md: contains a secret-shaped literal: "AKIAABCDEFGH…".'],
  size: 134217728,
  requiredBy: 'fm-service, fm-mobile',
  expectedKind: 'module',
  actualKind: 'overlay',
  expectedId: 'fm-service',
  actualId: 'acme-standards',
  destination: '.forge/modules/acme-mod',
} satisfies Record<string, unknown> as never;

/**
 * Openings that read as a next action.
 *
 * A mechanical proxy for R2's "the remedy names a concrete next action", and deliberately a list
 * rather than a cleverer heuristic — when it rejects a legitimate remedy the fix is to add the verb,
 * and the assertion message says so. `Re-` prefixed forms are included because half of FORGE's
 * remedies are "do the thing again after fixing it".
 */
const IMPERATIVE_VERBS =
  /^(Run|Re-run|Set|Add|Remove|Rename|Move|Check|Install|Upgrade|Update|Configure|Choose|Delete|Edit|Pass|Reduce|Raise|Wait|Retry|Resolve|Split|Merge|Replace|Provide|Create|Restore|Approve|Waive|Stop|Free|Point|Supersede|Address|Verify|Re-verify|Write|Fix|Widen)\b/;

/** CSI introducer. Written as an escape so the source stays free of control characters. */
const ESC = '[';

describe('specs/02 §2.6 — the code taxonomy', () => {
  it.each([
    ['CFG', 'configuration and validation'],
    ['ENV', 'environment and tooling'],
    ['ADP', 'adapter and platform'],
    ['VCS', 'git'],
    ['SPEC', 'spec graph and traceability'],
    ['KB', 'knowledge body'],
    ['GATE', 'gate failure'],
    ['RUN', 'scheduler and runtime'],
    ['BUD', 'budget and cost'],
    ['USR', 'user abort or refusal'],
  ])('declares at least one %s code (%s)', (prefix) => {
    const codes = Object.keys(ERROR_CODES).filter((code) => code.startsWith(`${prefix}-`));
    expect(codes.length).toBeGreaterThan(0);
  });

  it('numbers every code with three digits, so codes sort and read consistently', () => {
    for (const code of Object.keys(ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z]{2,4}-\d{3}$/);
    }
  });

  it('gives every declared code a remedy that names a concrete next action', () => {
    for (const [code, definition] of Object.entries(ERROR_CODES)) {
      expect(definition.remedy, `${code} has no remedy`).not.toBe('');
      // A remedy that restates the failure is not a remedy. Requiring an imperative opening verb is
      // the cheapest mechanical proxy for "tells the reader what to do next".
      expect(
        definition.remedy,
        `${code}'s remedy must open with an imperative verb. If the verb is legitimate and simply ` +
          `absent from IMPERATIVE_VERBS in this file, add it there.`,
      ).toMatch(IMPERATIVE_VERBS);
      // docsUrl is derived from the code rather than stored per row, so a domain change stays a
      // one-line edit (SPEC-QUESTIONS.md Q4).
      expect(docsUrlFor(code as keyof typeof ERROR_CODES)).toMatch(
        /^https:\/\/\S+\/errors\/[A-Z]{2,4}-\d{3}$/,
      );
    }
  });

  it('exposes every declared code through errorDefinition', () => {
    for (const code of Object.keys(ERROR_CODES)) {
      expect(errorDefinition(code as keyof typeof ERROR_CODES).code).toBe(code);
    }
  });
});

describe('specs/02 §2.6 — a ForgeError carries what a reader needs', () => {
  it('exposes code, severity, remedy and docsUrl', () => {
    const error = new ForgeError('CFG-001', { path: '.forge/config.yaml', line: 12 });

    expect(error.code).toBe('CFG-001');
    expect(error.severity).toBe('fatal');
    expect(error.remedy).not.toBe('');
    expect(error.docsUrl).toContain('CFG-001');
  });

  it('states what it found, not only what it wanted', () => {
    const error = new ForgeError('GATE-102', { observed: '61%', threshold: '80%' });

    expect(error.message).toContain('61%');
    expect(error.details['observed']).toBe('61%');
  });

  it('is an Error, so it survives every catch and logger in the ecosystem', () => {
    const error = new ForgeError('RUN-033', { step: 'implement', budget: '10m' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ForgeError');
    expect(error.stack).toBeDefined();
  });

  it('preserves a cause without absorbing its text into the remedy', () => {
    const cause = new Error('EACCES: permission denied');
    const error = new ForgeError('CFG-001', { path: 'x' }, { cause });

    expect(error.cause).toBe(cause);
    expect(error.remedy).not.toContain('EACCES');
  });

  it('refuses an unknown code at runtime, not only at compile time', () => {
    expect(() => new ForgeError('NOPE-999' as 'CFG-001', SAMPLE_DETAILS)).toThrow(
      /unknown error code/i,
    );
  });

  it('freezes details, so an error cannot be edited after it is thrown', () => {
    const error = new ForgeError('VCS-007', { lane: 'feat/story-014' });

    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it('serialises without a stack, so an error can be written to the event log', () => {
    const error = new ForgeError('BUD-002', { cap: '$12.00' });
    const json = error.toJSON();

    expect(json).toMatchObject({ code: 'BUD-002', severity: 'fatal' });
    expect(Object.keys(json)).not.toContain('stack');
  });

  it('round-trips through JSON, since the event log is the only durable record', () => {
    const error = new ForgeError('VCS-007', { lane: 'feat/story-014' });
    const revived = ForgeError.fromJSON(JSON.parse(JSON.stringify(error.toJSON())) as never);

    expect(revived.code).toBe(error.code);
    expect(revived.remedy).toBe(error.remedy);
    expect(revived.details).toEqual(error.details);
  });

  it('refuses to revive a payload with an unknown code', () => {
    // No cast: `fromJSON` takes `unknown`, which is the whole point of the signature.
    expect(() => ForgeError.fromJSON({ code: 'NOPE-999', details: {} })).toThrow(
      /unknown error code/i,
    );
  });
});

describe('specs/02 §2.6 — exit codes', () => {
  it.each([
    ['GATE-102', 3],
    ['BUD-002', 4],
    ['ENV-004', 5],
    ['CFG-002', 6],
    ['USR-001', 130],
    ['CFG-001', 2],
    ['RUN-033', 1],
  ])('maps %s to exit code %i', (code, expected) => {
    expect(exitCodeFor(new ForgeError(code as 'CFG-001', SAMPLE_DETAILS))).toBe(expected);
  });

  it.each([[new Error('boom')], ['a string'], [undefined], [null]])(
    'maps the non-ForgeError throwable %s to the generic failure code',
    (value) => {
      expect(exitCodeFor(value)).toBe(1);
    },
  );
});

describe('isForgeError', () => {
  it('narrows a ForgeError', () => {
    const value: unknown = new ForgeError('KB-005', { entry: 'KB-1', conflictsWith: 'ADR-1' });
    expect(isForgeError(value)).toBe(true);
  });

  it.each([[new Error('plain')], ['string'], [null], [undefined], [{ code: 'CFG-001' }]])(
    'rejects %s',
    (value) => {
      expect(isForgeError(value)).toBe(false);
    },
  );

  it('recognises a ForgeError from another realm, where instanceof fails', () => {
    // Adapter output and worker results cross a realm boundary. An `instanceof` check would
    // silently reclassify a real ForgeError as an unknown throwable and lose its exit code.
    const original = new ForgeError('CFG-001', { path: 'x' });
    const foreign: unknown = JSON.parse(JSON.stringify(original.toJSON()));
    expect(isForgeError(ForgeError.fromJSON(foreign as never))).toBe(true);
  });
});

describe('formatForTerminal', () => {
  const error = new ForgeError('GATE-102', { observed: '61%', threshold: '80%' });

  it('leads with the code, so a user can search for it', () => {
    const firstLine = formatForTerminal(error, { color: false, ascii: true }).split('\n')[0] ?? '';
    expect(firstLine).toContain('GATE-102');
  });

  it('always includes the remedy and the docs link', () => {
    const rendered = formatForTerminal(error, { color: false, ascii: true });
    expect(rendered).toContain(error.remedy);
    expect(rendered).toContain(error.docsUrl);
  });

  it('emits no ANSI escapes when color is off', () => {
    expect(formatForTerminal(error, { color: false, ascii: true })).not.toContain(ESC);
  });

  it('emits ANSI escapes when color is on', () => {
    expect(formatForTerminal(error, { color: true, ascii: true })).toContain(ESC);
  });

  it('uses only ASCII when ascii is requested, per the specs/18 output.ascii setting', () => {
    const rendered = formatForTerminal(error, { color: false, ascii: true });
    expect(/^[\u0020-\u007E\n]*$/.test(rendered), rendered).toBe(true);
  });

  it('may use non-ASCII when ascii is not requested', () => {
    const rendered = formatForTerminal(error, { color: false, ascii: false });
    expect(/[^\u0020-\u007E\n]/.test(rendered), rendered).toBe(true);
  });

  it('renders a cause on its own line without leaking its stack', () => {
    const withCause = new ForgeError(
      'CFG-001',
      { path: 'x' },
      { cause: new Error('EACCES: permission denied') },
    );
    const rendered = formatForTerminal(withCause, { color: false, ascii: true });

    expect(rendered).toContain('EACCES: permission denied');
    expect(rendered).not.toContain('    at ');
  });

  it('renders a non-Error cause without throwing', () => {
    const withCause = new ForgeError('CFG-001', { path: 'x' }, { cause: 'a bare string' });
    expect(formatForTerminal(withCause, { color: false, ascii: true })).toContain('a bare string');
  });
});

describe('every declared code renders end to end', () => {
  // Constructing each code exercises its message template. A template that throws — a typo in a
  // detail key, a value shape it cannot render — would otherwise surface for the first time on the
  // day that failure actually occurs, which is the worst moment to discover it.
  it.each(Object.keys(ERROR_CODES) as (keyof typeof ERROR_CODES)[])(
    '%s produces a message, a remedy and a terminal block',
    (code) => {
      const error = new ForgeError(code as 'CFG-001', SAMPLE_DETAILS);

      expect(error.message).not.toBe('');
      expect(error.message).not.toContain('<missing>');
      // `SAMPLE_DETAILS` is cast to `never`, so the compiler cannot check the bag against each
      // code. Without this line a template interpolating a key the bag lacks renders the literal
      // string "undefined" and the `<missing>` assertion above passes.
      expect(error.message).not.toContain('undefined');
      expect(error.remedy).not.toBe('');
      expect(formatForTerminal(error, { color: false, ascii: true })).toContain(code);
    },
  );

  it('renders <missing> rather than undefined when a detail is absent', () => {
    // A template that prints "undefined" reads like a FORGE bug to a user who is looking at their
    // own configuration mistake.
    // `CFG-001`'s `line` is declared optional, so omitting it is legal and must still read as
    // absent rather than as the string "undefined".
    expect(new ForgeError('CFG-001', { path: 'x' }).message).toContain('<missing>');
  });
});

describe('detail values of any shape render on one line', () => {
  it.each([
    ['a number', 42, '42'],
    ['a boolean', true, 'true'],
    ['null', null, 'null'],
    ['an object', { a: 1 }, '{"a":1}'],
    ['an array', [1, 2], '[1,2]'],
  ])('renders %s', (_name, value, expected) => {
    const error = new ForgeError('GATE-102', { observed: value, threshold: '80%' });
    expect(formatForTerminal(error, { color: false, ascii: true })).toContain(expected);
  });

  it('renders a value that cannot be serialised, rather than throwing while reporting a failure', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const error = new ForgeError('GATE-102', { observed: cyclic, threshold: '80%' });

    expect(error.message).toContain('<unserialisable>');
    expect(formatForTerminal(error, { color: false, ascii: true })).toContain('<unserialisable>');
  });

  it('renders a cause that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const error = new ForgeError('CFG-001', { path: 'x' }, { cause: cyclic });

    expect(error.toJSON().cause).toBe('<unserialisable>');
  });

  it('colours a warning differently from an error, so severity reads at a glance', () => {
    const warning = formatForTerminal(
      new ForgeError('KB-010', { entry: 'KB-ARCH-0007', reviewBy: '2026-06-11' }),
      { color: true, ascii: true },
    );
    const failure = formatForTerminal(
      new ForgeError('KB-005', { entry: 'KB-1', conflictsWith: 'ADR-1' }),
      { color: true, ascii: true },
    );

    // Asserting both contain *an* escape would pass with the colour hardcoded, which is what the
    // previous version of this test did.
    expect(warning).not.toBe(failure);
    expect(warning.slice(0, 12)).not.toBe(failure.slice(0, 12));
  });
});

describe('renderValue never throws while something is already going wrong', () => {
  it.each([
    ['a string', 'plain', 'plain'],
    ['undefined', undefined, '<missing>'],
    ['null', null, 'null'],
    ['a number', 42, '42'],
    ['a boolean', false, 'false'],
    ['a bigint', 10n, '10'],
    ['an object', { a: 1 }, '{"a":1}'],
    ['an array', [1, 'x'], '[1,"x"]'],
  ])('renders %s', (_name, value, expected) => {
    expect(renderValue(value)).toBe(expected);
  });

  it('renders a symbol, which String() would throw on', () => {
    expect(renderValue(Symbol('lane'))).toBe('Symbol(lane)');
  });

  it('renders a function without invoking it', () => {
    let called = false;
    expect(
      renderValue(() => {
        called = true;
      }),
    ).toBe('<function>');
    expect(called).toBe(false);
  });

  it('renders a value whose toJSON yields nothing', () => {
    // `JSON.stringify` returns undefined here, which TypeScript's declared `string` return type
    // hides. Without the guard the caller receives the literal string "undefined".
    expect(renderValue({ toJSON: () => undefined })).toBe('<unserialisable>');
  });

  it('renders a null-prototype object', () => {
    const bare: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    bare['lane'] = 'feat/a';
    expect(renderValue(bare)).toBe('{"lane":"feat/a"}');
  });

  it('renders a cyclic object', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(renderValue(cyclic)).toBe('<unserialisable>');
  });
});

describe('the fixes from the P3 review', () => {
  it('serialises an error whose details cannot be JSON-encoded', () => {
    // Details are where a caller attaches the thing that failed — an adapter response, a Node error
    // with a self-referential cause. `JSON.stringify(error)` threw on those, so the event log could
    // not record the errors this package produces, and specs/18 §18.4 makes that log the run's only
    // durable record.
    const cyclic: Record<string, unknown> = { status: 500 };
    cyclic['self'] = cyclic;

    const error = new ForgeError('ADP-012', { reason: 'rate limit' });
    Object.defineProperty(error, 'details', { value: Object.freeze({ reason: 'x', cyclic }) });

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ code: 'ADP-012' });
  });

  it('serialises a bigint detail, which the renderer accepts but JSON rejects', () => {
    const error = new ForgeError('RUN-033', { step: 'implement', budget: 10n });

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(error.toJSON().details['budget']).toBe('10');
  });

  it('gives a structural copy of an error the right exit code, not undefined', () => {
    // `{ ...error, context }` is the ordinary way to add context in a catch block. The spread copies
    // the brand symbol but not the prototype getter, so `exitCodeFor` returned undefined — typed as
    // ExitCode — and `process.exit(undefined)` exits 0. A failed run reported success.
    /* eslint-disable-next-line @typescript-eslint/no-misused-spread --
       Spreading the instance is the defect being reproduced. The lint rule discourages it inside
       FORGE, but the same shape arrives from a duplicate copy of this module or from external code,
       where no rule of ours applies. */
    const copy = { ...new ForgeError('BUD-002', { cap: '$12.00' }), context: 'lane A' };

    expect(isForgeError(copy)).toBe(true);
    expect(exitCodeFor(copy)).toBe(4);
  });

  it('gives a branded value with an unknown code the generic failure code', () => {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- see the note above
    const copy = { ...new ForgeError('BUD-002', { cap: '$12.00' }), code: 'NOPE-999' };
    expect(exitCodeFor(copy)).toBe(1);
  });

  it.each([
    ['null', null],
    ['a string', 'truncated'],
    ['a number', 7],
    ['an object with no code', { details: {} }],
    ['an object with an unknown code', { code: 'NOPE-999', details: {} }],
    ['an object with null details', { code: 'CFG-001', details: null }],
    ['an object with string details', { code: 'CFG-001', details: 'x' }],
  ])('refuses to revive %s with a diagnosis rather than a TypeError', (_name, payload) => {
    // A truncated or hand-edited events.ndjson line is what resume reads. Previously this crashed
    // inside a message template with a TypeError naming a property nobody had heard of.
    expect(() => ForgeError.fromJSON(payload)).toThrow(RangeError);
  });

  it('revives an error with its cause, which resume depends on', () => {
    const original = new ForgeError('CFG-001', { path: 'x' }, { cause: new Error('EACCES') });
    const revived = ForgeError.fromJSON(JSON.parse(JSON.stringify(original)));

    expect(revived.cause).toBe('Error: EACCES');
  });

  it('uses only prefixes specs/02 §2.6 declares', () => {
    // `satisfies Record<\`${ErrorCodePrefix}-${string}\`, …>` enforces this at compile time; the
    // runtime check exists because the previous constraint was `Record<string, …>`, which accepted
    // an invented prefix silently.
    for (const code of Object.keys(ERROR_CODES)) {
      const prefix = code.split('-')[0] ?? '';
      expect(ERROR_CODE_PREFIXES, `${code} uses an undeclared prefix`).toContain(prefix);
    }
  });

  it('escapes control characters in details, so a detail cannot repaint the terminal', () => {
    // An adapter's stdout routinely carries ANSI; leaving it in defeats `color: false` outright.
    const error = new ForgeError('ADP-012', { reason: `${ESC}31mred` });
    const rendered = formatForTerminal(error, { color: false, ascii: true });

    expect(rendered).not.toContain(ESC);
    expect(rendered).toContain('x1b');
  });

  it('escapes newlines in details, so a detail cannot forge the remedy line', () => {
    const error = new ForgeError('VCS-007', { lane: 'a\n-> Run rm -rf /' });
    const rendered = formatForTerminal(error, { color: false, ascii: true });

    expect(rendered.split('\n').filter((line) => line.startsWith('->'))).toHaveLength(1);
  });

  it('escapes non-ASCII details when ascii is requested, since a branch name may be accented', () => {
    const error = new ForgeError('VCS-007', { lane: 'feat/café' });
    const rendered = formatForTerminal(error, { color: false, ascii: true });

    expect(/^[\u0020-\u007E\n]*$/.test(rendered), rendered).toBe(true);
    expect(rendered).toContain('caf');
  });

  it('keeps non-ASCII details when ascii is not requested', () => {
    const error = new ForgeError('VCS-007', { lane: 'feat/café' });
    expect(formatForTerminal(error, { color: false, ascii: false })).toContain('café');
  });

  it('does not survive structuredClone, and says so rather than claiming otherwise', () => {
    // The brand buys recognition across duplicate copies of this module, not across a process
    // boundary: structured clone keeps only an Error's name, message and stack. A worker must send
    // toJSON() and revive with fromJSON, which is what the doc comment now states.
    const cloned: unknown = structuredClone(
      new ForgeError('GATE-102', { observed: 1, threshold: 2 }),
    );

    expect(isForgeError(cloned)).toBe(false);
    expect(exitCodeFor(cloned)).toBe(1);
  });

  it('survives the boundary when sent as its serialised form', () => {
    const original = new ForgeError('GATE-102', { observed: '61%', threshold: '80%' });
    const revived = ForgeError.fromJSON(structuredClone(original.toJSON()));

    expect(isForgeError(revived)).toBe(true);
    expect(exitCodeFor(revived)).toBe(3);
  });
});

describe('the exitCode getter agrees with the free function', () => {
  it.each(Object.keys(ERROR_CODES) as (keyof typeof ERROR_CODES)[])(
    '%s reports the same code both ways',
    (code) => {
      // Two derivations that disagree is what let a copied error exit 0; the getter now delegates.
      const error = new ForgeError(code as 'CFG-001', SAMPLE_DETAILS);
      expect(error.exitCode).toBe(exitCodeFor(error));
    },
  );
});

describe('the package entry points resolve', () => {
  it('exposes the same error surface from the root and the errors subpath', async () => {
    // PLAN-M1 names `@forge/core/errors`, and P4 will name `@forge/core/fs`. A subpath declared in
    // package.json but missing from disk is invisible to a suite that imports by relative path.
    const root = await import('../src/index.ts');
    const subpath = await import('../src/errors/index.ts');

    for (const name of Object.keys(subpath)) {
      expect(root, `root barrel is missing ${name}`).toHaveProperty(name);
    }
  });

  it('declares every exports subpath as a file that exists', async () => {
    const manifest = (await import('../package.json', { with: { type: 'json' } })).default as {
      exports: Record<string, string>;
    };
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const packageDir = fileURLToPath(new URL('..', import.meta.url));

    for (const [subpath, target] of Object.entries(manifest.exports)) {
      expect(existsSync(new URL(target, `file://${packageDir}`)), `${subpath} -> ${target}`).toBe(
        true,
      );
    }
  });
});

describe('the verify-pass fixes', () => {
  it('renders <missing> rather than "undefined" for every template, however it interpolates', () => {
    // Templates that wrote `${d.key}` directly produced "undefined" — indistinguishable from a
    // FORGE bug — where a revived log line was missing a key. All of them go through the renderer.
    for (const code of Object.keys(ERROR_CODES) as (keyof typeof ERROR_CODES)[]) {
      const error = new ForgeError(code as 'CFG-001', {} as never);
      expect(error.message, `${code} interpolates a raw value`).not.toContain('undefined');
    }
  });

  it('refuses an array of details, which typeof reports as an object', () => {
    expect(() => ForgeError.fromJSON({ code: 'CFG-001', details: [] })).toThrow(RangeError);
  });

  it('keeps the encodable siblings of a circular detail value', () => {
    // Collapsing the whole value to a placeholder threw away the status and body a debugger wants.
    const response: Record<string, unknown> = { status: 500, body: 'quota exceeded' };
    response['self'] = response;

    const error = new ForgeError('ADP-012', { reason: 'rate limit' });
    Object.defineProperty(error, 'details', { value: Object.freeze({ response }) });
    const encoded = error.toJSON().details['response'] as Record<string, unknown>;

    expect(encoded['status']).toBe(500);
    expect(encoded['body']).toBe('quota exceeded');
    expect(encoded['self']).toBe('<circular>');
  });

  it('keeps a nested bigint, rather than losing its whole key', () => {
    const error = new ForgeError('RUN-033', { step: 's', budget: { ms: 10n, label: 'ten' } });
    const encoded = error.toJSON().details['budget'] as Record<string, unknown>;

    expect(encoded).toEqual({ ms: '10', label: 'ten' });
  });

  it.each([
    ['a C1 control, which some terminals read as an 8-bit CSI', '\u009b31m'],
    ['a line separator, which a JSON reader treats as a newline', '\u2028'],
  ])('escapes %s', (_name, injected) => {
    const rendered = formatForTerminal(new ForgeError('VCS-007', { lane: `a${injected}b` }), {
      color: false,
      ascii: false,
    });

    expect(rendered).not.toContain(injected);
  });
});
