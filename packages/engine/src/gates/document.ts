/**
 * `validateGateDocument` / `parseGateDocument` — a `<id>.gate.yaml` document (`10` §10.3's worked example) read
 * STRICTLY into a {@link GateDefinition}.
 *
 * The loader this replaces (`PLAN-M13.md` P41, the P35 finding) read only the keys it knew and defaulted the
 * rest, so a gate whose `checks:` was misspelled (`chekcs:`, `check:`, `deterministic` as `determinstic`) became
 * an empty gate, and an empty gate passes: `evaluateGate` is `checks.every(...)`, vacuously true. That is a gate
 * that cannot fail, written by a typo, and nothing said so. Two rules close it:
 *
 *  1. **Unknown keys are errors**, at every level of the document, with a "did you mean" when the key is one or
 *     two edits from a known one. The known keys are exactly the ones `10` §10.3 shows (`id`, `name`, `phase`,
 *     `autonomyOverride`, `checks`, `openQuestionsPolicy`, `approval`, `evidence`, `onReject`), plus the
 *     documentary `name`/`description`/`remedy` a check may carry (`19` §19.6).
 *  2. **A gate with no deterministic check is an error** (`15` §15.10 I4: "a gate cannot be defined with zero
 *     deterministic checks"). The spec defines no check-less gate, and every shipped gate has at least four.
 *     Advisory-only is not enough either: advisory checks never fail a gate (`10` §10.3 rule 2).
 *
 * Advisory checks' own `agent`/`brief` content is `forge workflow validate --all`'s (`gateValidateAll`), which
 * resolves them against the project's agents and briefs; this reports the shape problems that make a definition
 * unreadable (a wrong type, an unknown key, a missing `id`) and flags them `advisoryShape` so the validator that
 * already reports those does not say it twice.
 *
 * Pure: no file access. The caller names the file when it turns a problem into an error.
 *
 * @see specs/10 §10.3
 * @see specs/15 §15.10 (I4)
 * @see PLAN-M13.md P41
 */
import { ForgeError } from '@forge/core/errors';

import { parseExpression } from '../expr/index.ts';
import { SUPPORTED_PARSERS } from './evaluate.ts';
import type {
  AdvisoryCheck,
  DeterministicCheck,
  GateApprovalPolicy,
  GateDefinition,
  GateEvidenceRef,
} from './types.ts';

export type GateDocumentProblemCode =
  'unknown-key' | 'invalid-value' | 'no-deterministic-checks' | 'duplicate-check-id';

/** One thing wrong with a gate document. `key` is the dotted path to it (`checks.deterministic[1].failOn`). */
export interface GateDocumentProblem {
  readonly code: GateDocumentProblemCode;
  readonly key: string;
  readonly message: string;
  /** True for a problem in the advisory checks' own structure, which `gateValidateAll` already reports with its
   * own codes; a caller that runs both skips these rather than say each twice. */
  readonly advisoryShape?: true;
}

export interface GateDocumentResult {
  /** Present only when the document has no problem at all. */
  readonly definition?: GateDefinition;
  readonly problems: readonly GateDocumentProblem[];
}

const TOP_KEYS = [
  'id',
  'name',
  'phase',
  'autonomyOverride',
  'checks',
  'openQuestionsPolicy',
  'approval',
  'evidence',
  'onReject',
] as const;
const CHECKS_KEYS = ['deterministic', 'advisory'] as const;
const DETERMINISTIC_KEYS = [
  'id',
  'run',
  'parser',
  'failOn',
  'remedy',
  'name',
  'description',
] as const;
const ADVISORY_KEYS = ['id', 'agent', 'brief'] as const;
const APPROVAL_KEYS = ['required', 'roles', 'quorum'] as const;
const EVIDENCE_KEYS = ['artifact'] as const;
const ON_REJECT_KEYS = ['action', 'target'] as const;
const AUTONOMY_OVERRIDES = new Set(['alwaysHuman', 'supervised', 'guided', 'autonomous']);

/** `15` §15.7's "Custom gate checks" shape (`19` §19.1's own `checks/*.check.yaml` module layout row). */
const CHECK_TOP_KEYS = [
  'id',
  'name',
  'description',
  'run',
  'parser',
  'failOn',
  'remedy',
  'appliesTo',
  'severity',
] as const;
const APPLIES_TO_KEYS = ['gates'] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a mapping' : `a ${typeof value}`;
}

/** Edit distance, bounded: a "did you mean" only needs to know whether two short keys are 1-2 edits apart. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 4;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 4;
}

/** The known key `key` is most likely a misspelling of: a case-only difference, or within two edits (one for a
 * short key, so `id` is not "a typo of" `in`). */
export function suggestKey(key: string, known: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const exact = known.find((candidate) => candidate.toLowerCase() === lower);
  if (exact !== undefined) return exact;
  const limit = key.length <= 3 ? 1 : 2;
  let best: { readonly candidate: string; readonly distance: number } | undefined;
  for (const candidate of known) {
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance <= limit && (best === undefined || distance < best.distance)) {
      best = { candidate, distance };
    }
  }
  return best?.candidate;
}

class Collector {
  readonly problems: GateDocumentProblem[] = [];

  add(code: GateDocumentProblemCode, key: string, message: string, advisoryShape?: true): void {
    this.problems.push({
      code,
      key,
      message,
      ...(advisoryShape === undefined ? {} : { advisoryShape }),
    });
  }

  /** Reports every key of `record` that is not in `known`; returns whether there were none. */
  strictKeys(
    record: Readonly<Record<string, unknown>>,
    known: readonly string[],
    path: string,
    advisoryShape?: true,
  ): void {
    for (const key of Object.keys(record)) {
      if (known.includes(key)) continue;
      const at = path === '' ? key : `${path}.${key}`;
      const suggestion = suggestKey(key, known);
      this.add(
        'unknown-key',
        at,
        `unknown key "${key}"${
          suggestion === undefined ? '' : ` (did you mean "${suggestion}"?)`
        }; the keys here are ${known.map((name) => `"${name}"`).join(', ')}`,
        advisoryShape,
      );
    }
  }
}

function readApproval(raw: unknown, out: Collector): GateApprovalPolicy | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    out.add('invalid-value', 'approval', `must be a mapping, found ${describe(raw)}`);
    return undefined;
  }
  out.strictKeys(raw, APPROVAL_KEYS, 'approval');
  const required = raw['required'] ?? true;
  if (typeof required !== 'boolean') {
    out.add(
      'invalid-value',
      'approval.required',
      `must be true or false, found ${describe(required)}`,
    );
  }
  const roles = raw['roles'] ?? ['human'];
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every(isNonBlankString)) {
    out.add(
      'invalid-value',
      'approval.roles',
      'must be a non-empty list of role names (`human` or an agent role)',
    );
  }
  const quorum = raw['quorum'] ?? 1;
  if (typeof quorum !== 'number' || !Number.isInteger(quorum) || quorum < 1) {
    out.add('invalid-value', 'approval.quorum', 'must be a whole number of at least 1');
  }
  return {
    required: required === true,
    roles: Array.isArray(roles) ? roles.filter(isNonBlankString) : [],
    quorum: typeof quorum === 'number' ? quorum : 1,
  };
}

function readDeterministic(raw: unknown, out: Collector): readonly DeterministicCheck[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    out.add('invalid-value', 'checks.deterministic', `must be a list, found ${describe(raw)}`);
    return [];
  }
  const checks: DeterministicCheck[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const at = `checks.deterministic[${String(index)}]`;
    if (!isRecord(entry)) {
      out.add('invalid-value', at, `must be a mapping, found ${describe(entry)}`);
      return;
    }
    out.strictKeys(entry, DETERMINISTIC_KEYS, at);
    for (const field of ['id', 'run', 'failOn'] as const) {
      if (!isNonBlankString(entry[field])) {
        out.add(
          'invalid-value',
          `${at}.${field}`,
          `must be a non-blank string, found ${describe(entry[field])}`,
        );
      }
    }
    const failOn = entry['failOn'];
    if (isNonBlankString(failOn)) {
      const parsedFailOn = parseExpression(failOn);
      if (!parsedFailOn.success) {
        out.add(
          'invalid-value',
          `${at}.failOn`,
          `is not a valid expression (${parsedFailOn.error.message}), so the check could never pass`,
        );
      }
    }
    const parser = entry['parser'];
    if (isNonBlankString(parser) && !SUPPORTED_PARSERS.has(parser)) {
      out.add(
        'invalid-value',
        `${at}.parser`,
        `names an unsupported parser "${parser}"; the supported ones are ${[...SUPPORTED_PARSERS].map((name) => `"${name}"`).join(', ')}`,
      );
    }
    if (parser !== undefined && !isNonBlankString(parser)) {
      out.add(
        'invalid-value',
        `${at}.parser`,
        `must be a non-blank string, found ${describe(parser)}`,
      );
    }
    const id = entry['id'];
    if (isNonBlankString(id)) {
      if (seen.has(id)) {
        out.add('duplicate-check-id', `${at}.id`, `check id "${id}" is declared more than once`);
      }
      seen.add(id);
    }
    if (
      isNonBlankString(id) &&
      isNonBlankString(entry['run']) &&
      isNonBlankString(entry['failOn'])
    ) {
      checks.push({
        id,
        run: entry['run'],
        ...(isNonBlankString(parser) ? { parser } : {}),
        failOn: entry['failOn'],
      });
    }
  });
  return checks;
}

function readAdvisory(raw: unknown, out: Collector): readonly AdvisoryCheck[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    out.add('invalid-value', 'checks.advisory', `must be a list, found ${describe(raw)}`, true);
    return [];
  }
  const checks: AdvisoryCheck[] = [];
  raw.forEach((entry: unknown, index) => {
    const at = `checks.advisory[${String(index)}]`;
    if (!isRecord(entry)) {
      out.add('invalid-value', at, `must be a mapping, found ${describe(entry)}`, true);
      return;
    }
    out.strictKeys(entry, ADVISORY_KEYS, at, true);
    if (!isNonBlankString(entry['id'])) {
      out.add(
        'invalid-value',
        `${at}.id`,
        `must be a non-blank string, found ${describe(entry['id'])}`,
        true,
      );
      return;
    }
    for (const field of ['agent', 'brief'] as const) {
      const value = entry[field];
      if (value !== undefined && typeof value !== 'string') {
        out.add(
          'invalid-value',
          `${at}.${field}`,
          `must be a string, found ${describe(value)}`,
          true,
        );
      }
    }
    checks.push({
      id: entry['id'],
      agent: typeof entry['agent'] === 'string' ? entry['agent'] : '',
      brief: typeof entry['brief'] === 'string' ? entry['brief'] : '',
    });
  });
  return checks;
}

/** `evidence:` entries actually kept, in document order — one `GateEvidenceRef` per well-shaped entry
 * (a mapping with only the known `artifact` key, and a non-blank `artifact` string; `PLAN-M14.md` P19 is
 * this array's first real reader, `approve.ts`'s own `agentProducedEvidenceForGate`-shaped callers). An
 * entry that is not a mapping, names an unknown key, or has a blank/missing `artifact` contributes no
 * `GateEvidenceRef` (its own problem is still reported, exactly as a malformed `checks.deterministic`
 * entry is by `readDeterministic` above) rather than silently carrying a garbage reference through into a
 * definition later code trusts. */
function readEvidence(raw: unknown, out: Collector): readonly GateEvidenceRef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    out.add('invalid-value', 'evidence', `must be a list, found ${describe(raw)}`);
    return [];
  }
  const refs: GateEvidenceRef[] = [];
  raw.forEach((entry: unknown, index) => {
    const at = `evidence[${String(index)}]`;
    if (!isRecord(entry)) {
      out.add('invalid-value', at, `must be a mapping, found ${describe(entry)}`);
      return;
    }
    out.strictKeys(entry, EVIDENCE_KEYS, at);
    const artifact = entry['artifact'];
    if (!isNonBlankString(artifact)) {
      out.add(
        'invalid-value',
        `${at}.artifact`,
        `must be a non-blank string, found ${describe(artifact)}`,
      );
      return;
    }
    refs.push({ artifact });
  });
  return refs;
}

function validateEvidenceAndReject(
  record: Readonly<Record<string, unknown>>,
  out: Collector,
): readonly GateEvidenceRef[] {
  const evidence = readEvidence(record['evidence'], out);
  const onReject = record['onReject'];
  if (onReject !== undefined && onReject !== null) {
    if (!isRecord(onReject)) {
      out.add('invalid-value', 'onReject', `must be a mapping, found ${describe(onReject)}`);
    } else {
      out.strictKeys(onReject, ON_REJECT_KEYS, 'onReject');
    }
  }
  return evidence;
}

/** Reads a parsed gate document (the result of `YAML.parse`, untrusted) into a definition, or says everything
 * that is wrong with it. Never throws. */
export function validateGateDocument(raw: unknown): GateDocumentResult {
  const out = new Collector();
  if (!isRecord(raw)) {
    out.add(
      'invalid-value',
      '(document)',
      `must be a mapping of gate fields, found ${describe(raw)}`,
    );
    return { problems: out.problems };
  }
  out.strictKeys(raw, TOP_KEYS, '');

  const id = raw['id'];
  if (!isNonBlankString(id)) {
    out.add('invalid-value', 'id', `must be a non-blank string, found ${describe(id)}`);
  }

  const policy = raw['openQuestionsPolicy'];
  if (policy !== undefined && policy !== 'block' && policy !== 'warn') {
    out.add('invalid-value', 'openQuestionsPolicy', 'must be "block" or "warn"');
  }

  const autonomy = raw['autonomyOverride'];
  if (
    autonomy !== undefined &&
    autonomy !== null &&
    !(typeof autonomy === 'string' && AUTONOMY_OVERRIDES.has(autonomy))
  ) {
    out.add(
      'invalid-value',
      'autonomyOverride',
      'must be null or one of "alwaysHuman", "supervised", "guided", "autonomous"',
    );
  }

  const approval = readApproval(raw['approval'], out);
  const evidence = validateEvidenceAndReject(raw, out);

  const checks = raw['checks'];
  let deterministic: readonly DeterministicCheck[] = [];
  let advisory: readonly AdvisoryCheck[] = [];
  if (checks === undefined || checks === null) {
    out.add(
      'no-deterministic-checks',
      'checks',
      'the gate has no "checks" mapping, so it has no deterministic check and would pass vacuously (15 §15.10 I4)',
    );
  } else if (!isRecord(checks)) {
    out.add('invalid-value', 'checks', `must be a mapping, found ${describe(checks)}`, true);
  } else {
    out.strictKeys(checks, CHECKS_KEYS, 'checks');
    deterministic = readDeterministic(checks['deterministic'], out);
    advisory = readAdvisory(checks['advisory'], out);
    const deterministicIds = new Set(deterministic.map((check) => check.id));
    advisory.forEach((check, index) => {
      if (deterministicIds.has(check.id)) {
        out.add(
          'duplicate-check-id',
          `checks.advisory[${String(index)}].id`,
          `check id "${check.id}" is also a deterministic check of this gate`,
        );
      }
    });
    const listed = checks['deterministic'];
    // Entries that exist but are malformed were each reported above; "no deterministic check" is for a gate that
    // declares none at all (absent, `null`, or an empty list).
    if (listed === undefined || listed === null || (Array.isArray(listed) && listed.length === 0)) {
      out.add(
        'no-deterministic-checks',
        'checks.deterministic',
        'the gate has no deterministic check, so it would pass vacuously; declare at least one (15 §15.10 I4: "a gate cannot be defined with zero deterministic checks")',
      );
    }
  }

  if (out.problems.length > 0 || !isNonBlankString(id)) return { problems: out.problems };
  const definition: GateDefinition = {
    id,
    checks: { deterministic, advisory },
    openQuestionsPolicy: policy === 'block' ? 'block' : 'warn',
    ...(approval === undefined ? {} : { approval }),
    ...(typeof autonomy === 'string' ? { autonomyOverride: autonomy } : {}),
    ...(evidence.length === 0 ? {} : { evidence }),
  };
  return { definition, problems: out.problems };
}

/** `validateGateDocument`, throwing `GATE-506` (naming `file` and the first offending key) when the document has
 * any problem. */
export function parseGateDocument(raw: unknown, file: string): GateDefinition {
  const { definition, problems } = validateGateDocument(raw);
  const first = problems[0];
  if (definition === undefined || first !== undefined) {
    throw new ForgeError('GATE-506', {
      file,
      key: first?.key ?? '(document)',
      detail: first?.message ?? 'the document could not be read',
      more: Math.max(0, problems.length - 1),
    });
  }
  return definition;
}

export type CheckDocumentProblemCode = 'unknown-key' | 'invalid-value';

/** One thing wrong with a `*.check.yaml` document. `key` is the dotted path to it (`appliesTo.gates`). */
export interface CheckDocumentProblem {
  readonly code: CheckDocumentProblemCode;
  readonly key: string;
  readonly message: string;
}

export interface CheckDocumentResult {
  /** Present only when the document has no problem at all. */
  readonly document?: CheckDocument;
  readonly problems: readonly CheckDocumentProblem[];
}

/** `15` §15.7's "Custom gate checks" shape (`19` §19.1's own `checks/*.check.yaml` module layout row): a
 * standalone check that names, via `appliesTo.gates`, every gate it attaches to — rather than being
 * declared inline inside a `*.gate.yaml`'s own `checks:` block. `packages/cli/src/commands/run/gates.ts`'
 * `loadGateRegistry` (`PLAN-M14.md` P20) is the one real reader that turns this into an attached
 * `DeterministicCheck` of every gate it names — `severity: error` joins `checks.deterministic` (the same
 * array `evaluateGate`'s pass rule already reads, unmodified), `severity: warn` joins `checks.warnings`
 * (evaluated the identical way but landing in `GateEvaluationResult.warnings`, `evaluate.ts`, and never
 * `passed`). This module only reads the document's own shape, exactly as `validateGateDocument` does for
 * a `*.gate.yaml` — never a project, a registry, or which gates actually exist. */
export interface CheckDocument {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly run: string;
  readonly parser?: string;
  readonly failOn: string;
  readonly remedy: string;
  readonly appliesTo: { readonly gates: readonly string[] };
  readonly severity: 'error' | 'warn';
}

/** `Collector.problems` is typed for the wider {@link GateDocumentProblemCode} (`no-deterministic-checks`,
 * `duplicate-check-id`, an `advisoryShape` flag — none of which a check document's own validation below
 * ever adds) so both validators can share one collector implementation; this narrows the codes back down
 * for `CheckDocumentResult`'s own, smaller union, and drops the always-absent `advisoryShape`. */
function asCheckProblems(
  problems: readonly GateDocumentProblem[],
): readonly CheckDocumentProblem[] {
  return problems.map(({ code, key, message }) => ({
    code: code as CheckDocumentProblemCode,
    key,
    message,
  }));
}

/** Reads a parsed `*.check.yaml` document (`YAML.parse`'s own result, untrusted) into a
 * {@link CheckDocument}, or says everything wrong with it — the identical "strict, itemised, never
 * throws" shape {@link validateGateDocument} already establishes for a `*.gate.yaml`: a typo'd
 * `appliesTo`/`severity` names the exact key rather than silently failing to attach anywhere, or (worse)
 * attaching with a fabricated default. `appliesTo.gates` is checked here only for being a non-empty list
 * of non-blank strings — whether each one actually names a real gate ("known", `15` §15.7) is a registry
 * question this pure, file-less function cannot answer; `loadGateRegistry`/`gateValidateAll` check that
 * once they have one. */
export function validateCheckDocument(raw: unknown): CheckDocumentResult {
  const out = new Collector();
  if (!isRecord(raw)) {
    out.add(
      'invalid-value',
      '(document)',
      `must be a mapping of check fields, found ${describe(raw)}`,
    );
    return { problems: asCheckProblems(out.problems) };
  }
  out.strictKeys(raw, CHECK_TOP_KEYS, '');

  const id = raw['id'];
  if (!isNonBlankString(id)) {
    out.add('invalid-value', 'id', `must be a non-blank string, found ${describe(id)}`);
  }
  const run = raw['run'];
  if (!isNonBlankString(run)) {
    out.add('invalid-value', 'run', `must be a non-blank string, found ${describe(run)}`);
  }
  // `19` §19.6: "For each check: a remedy string. A failing check without a remedy is a dead end."
  const remedy = raw['remedy'];
  if (!isNonBlankString(remedy)) {
    out.add('invalid-value', 'remedy', `must be a non-blank string, found ${describe(remedy)}`);
  }

  const failOn = raw['failOn'];
  if (!isNonBlankString(failOn)) {
    out.add('invalid-value', 'failOn', `must be a non-blank string, found ${describe(failOn)}`);
  } else {
    const parsedFailOn = parseExpression(failOn);
    if (!parsedFailOn.success) {
      out.add(
        'invalid-value',
        'failOn',
        `is not a valid expression (${parsedFailOn.error.message}), so the check could never pass`,
      );
    }
  }

  const parser = raw['parser'];
  if (parser !== undefined && !isNonBlankString(parser)) {
    out.add('invalid-value', 'parser', `must be a non-blank string, found ${describe(parser)}`);
  } else if (isNonBlankString(parser) && !SUPPORTED_PARSERS.has(parser)) {
    out.add(
      'invalid-value',
      'parser',
      `names an unsupported parser "${parser}"; the supported ones are ${[...SUPPORTED_PARSERS].map((name) => `"${name}"`).join(', ')}`,
    );
  }

  for (const field of ['name', 'description'] as const) {
    const value = raw[field];
    if (value !== undefined && typeof value !== 'string') {
      out.add('invalid-value', field, `must be a string, found ${describe(value)}`);
    }
  }

  const severity = raw['severity'];
  if (severity !== 'error' && severity !== 'warn') {
    out.add('invalid-value', 'severity', 'must be "error" or "warn"');
  }

  const appliesToRaw = raw['appliesTo'];
  let gates: readonly string[] = [];
  if (!isRecord(appliesToRaw)) {
    out.add('invalid-value', 'appliesTo', `must be a mapping, found ${describe(appliesToRaw)}`);
  } else {
    out.strictKeys(appliesToRaw, APPLIES_TO_KEYS, 'appliesTo');
    const gatesRaw = appliesToRaw['gates'];
    if (!Array.isArray(gatesRaw) || gatesRaw.length === 0 || !gatesRaw.every(isNonBlankString)) {
      out.add('invalid-value', 'appliesTo.gates', 'must be a non-empty list of gate ids');
    } else {
      gates = gatesRaw;
    }
  }

  if (out.problems.length > 0) return { problems: asCheckProblems(out.problems) };
  const document: CheckDocument = {
    id: id as string,
    ...(typeof raw['name'] === 'string' ? { name: raw['name'] } : {}),
    ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    run: run as string,
    ...(isNonBlankString(parser) ? { parser } : {}),
    failOn: failOn as string,
    remedy: remedy as string,
    appliesTo: { gates },
    severity: severity as 'error' | 'warn',
  };
  return { document, problems: [] };
}

/** `validateCheckDocument`, throwing `GATE-506` — the identical code a malformed `*.gate.yaml` itself
 * throws, since both are "a gate-adjacent file this project ships is structurally broken" (naming `file`
 * and the first offending key) — when the document has any problem. */
export function parseCheckDocument(raw: unknown, file: string): CheckDocument {
  const { document, problems } = validateCheckDocument(raw);
  const first = problems[0];
  if (document === undefined || first !== undefined) {
    throw new ForgeError('GATE-506', {
      file,
      key: first?.key ?? '(document)',
      detail: first?.message ?? 'the document could not be read',
      more: Math.max(0, problems.length - 1),
    });
  }
  return document;
}
