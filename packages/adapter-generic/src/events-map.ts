/**
 * `events.format: ndjson` made real: one stdout line -> a parsed raw JSON object -> (via
 * `events.map`'s own first-match-wins rule, `07` §7.5's own worked-example convention, mirrored from
 * `scripted-binary-protocol.ts`'s identical `matchScriptedEntry`) a raw candidate `AdapterEvent` object,
 * left for the caller to run through `@forge/adapter-kit/events`'s `normalizeAdapterEvent`.
 *
 * `events.format: 'text'` is a real, declared config value (`07` §7.5's own enum) this package does
 * not implement: the spec gives it exactly one line of description ("regex-based extraction (lossy)")
 * with no field-level schema anywhere in the spec pack, and no fixture in this milestone exercises it.
 * `GenericAdapter.startSession` refuses outright, with a clear, typed error, rather than silently
 * guessing at an unspecified contract — see `SPEC-QUESTIONS.md` for the full record.
 *
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import type { AdapterYamlConfig } from './config/schema.ts';
import { resolveEmitTemplate } from './templates.ts';

export type RawLine = Readonly<Record<string, unknown>>;

/** `undefined` when `line` is not valid JSON, or parses to something other than a plain object (an
 * array, a string, a number, `null`) — a real external tool's stdout can contain a stray non-JSON line
 * (P8's own `scripted-binary.ts` deliberately emits one for `07` §7.6's malformed-output need); this
 * degrades to "no line here to map," never a thrown exception. */
export function parseNdjsonLine(line: string): RawLine | undefined {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as RawLine;
}

function matchesRule(match: RawLine, rawLine: RawLine): boolean {
  return Object.entries(match).every(([key, expected]) => rawLine[key] === expected);
}

/** The first `events.map` entry (in declaration order) whose `match` every field agrees with
 * `rawLine`, resolved into a raw candidate event object -- or `undefined` if no entry matches, meaning
 * this line is not one `events.map` chose to translate into any `AdapterEvent` at all (an honest,
 * silent skip: a real external tool's own NDJSON vocabulary will always carry lines no `adapter.yaml`
 * author bothered to map, and that is not itself an error). */
export function mapLineToCandidate(
  config: Pick<AdapterYamlConfig['events'], 'map'>,
  rawLine: RawLine,
): Record<string, unknown> | undefined {
  for (const entry of config.map) {
    if (matchesRule(entry.match, rawLine)) {
      return resolveEmitTemplate(entry.emit, rawLine);
    }
  }
  return undefined;
}
