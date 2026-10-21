/**
 * `ADOPT_TESTS_OUTPUT_SCHEMA` vs. `proposalResponseSchema` (`specs/22` M17 P7, `adopt-agent.ts`) --
 * M17 P21's SECOND, more serious live-run defect: the JSON Schema `SessionRequest.outputSchema`
 * carries to steer a real model's structured-output request used to be ONE FLAT object with no
 * `required` array at any level and no structure reflecting the real two-branch `z.union` the
 * session's own response is validated against afterward. A real, billed live run hit this on BOTH of
 * `proposalResponseSchema`'s own branches -- the `noTestsFound` branch (a genuinely test-less fixture)
 * and the ordinary `command`/`probe`/`runnerVersion`/`reason` branch (a fixture with real, working
 * tests) -- exhausting all 3 rounds with the identical generic, field-path-less `"(root): Invalid
 * input."` every time, because the schema steering every round's own prompt never changed.
 *
 * A FIRST fix attempt here used a top-level `anyOf` of the two real branches -- structurally correct,
 * but rejected outright by the real transport (`ADOPT_TESTS_OUTPUT_SCHEMA`'s own doc comment in
 * `adopt-agent.ts` has the full story: `oneOf`/`allOf`/`anyOf` at a JSON Schema's own ROOT is refused
 * by the real API with a 400, confirmed live, independently of this file). The CURRENT
 * `ADOPT_TESTS_OUTPUT_SCHEMA` is one flat, non-union `type: 'object'` schema using top-level
 * `if`/`then`/`else` for the real conditional-requiredness signal (also confirmed live-accepted and
 * live-effective, not merely schema-valid) -- see that same doc comment. One real, disclosed
 * consequence for THIS test file: this flat design cannot reject a response that mixes fields from both
 * branches (e.g. a valid `noTestsFound: true` proposal that also includes `probe`) purely at the
 * schema level, the way the original (API-incompatible) `anyOf` design could have -- `DISCLOSED
 * DIVERGENCE #2` below is that exact case, kept in this suite rather than hidden, because
 * `parseProposalResponse`'s own real `proposalResponseSchema.safeParse` (unchanged) is still the
 * authoritative gate against it regardless of what this schema can or cannot express.
 *
 * This file has no real JSON-Schema validator to call (confirmed: no `ajv` or equivalent anywhere in
 * this monorepo's `package.json`/`pnpm-lock.yaml`; `zod-to-json-schema`, already a real dependency of
 * `@forge/schemas` and `@forge/cli`, converts a zod schema INTO JSON Schema, it does not validate an
 * arbitrary JSON Schema against a sample value) -- adding one as a test-only dependency for a single
 * schema-shape suite was judged a bigger footprint than this fix warrants. `matchesSchema` below is
 * the deliberately narrow "next-best real test" instead: a real evaluator for exactly the JSON Schema
 * keywords `ADOPT_TESTS_OUTPUT_SCHEMA` actually uses (`type`, `properties`, `required`,
 * `additionalProperties: false`, `anyOf` (nested only -- `COMMAND_JSON_SCHEMA`'s own `output` field),
 * `if`/`then`/`else`, `const`, `enum`) -- not a general JSON-Schema implementation, and it throws
 * loudly on any node shape it was not taught, rather than silently guessing.
 *
 * Every fixture below is run through BOTH the real `proposalResponseSchema.safeParse` (the actual
 * runtime validator a live session's response is checked against) and `matchesSchema` against the
 * real, exported `ADOPT_TESTS_OUTPUT_SCHEMA` -- proving the two agree (except the two disclosed,
 * explicitly-labelled divergences), rather than asserting either one's shape in isolation against a
 * hand-picked expectation that could drift from the other the exact way they already had. A fixture
 * shaped exactly like the live defect (`noTestsFound: true` with a `probe` field, but no `adrSummary`)
 * is included directly (`THE LIVE DEFECT`, below).
 */
import { describe, expect, it } from 'vitest';

import {
  ADOPT_TESTS_OUTPUT_SCHEMA,
  proposalResponseSchema,
} from '../../../../src/commands/loop/test/adopt-agent.ts';

type JsonSchemaNode = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** See this file's own top doc comment for what this is and, deliberately, is not. */
function matchesSchema(schema: JsonSchemaNode, value: unknown): boolean {
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf)) {
    return anyOf.some((branch) => isPlainObject(branch) && matchesSchema(branch, value));
  }
  // Real JSON Schema applies `properties`/`required`/`if` to an object instance whether or not a
  // sibling `type: 'object'` is also declared (the `if`/`then`/`else` sub-schemas in the real
  // `ADOPT_TESTS_OUTPUT_SCHEMA` declare none of them) -- gating on `type === 'object'` ALONE, as an
  // earlier version of this evaluator did, throws on exactly those real sub-schema nodes instead of
  // evaluating them. `const`/`enum` are checked first below specifically so a node like `{const: true}`
  // is never misread as "no object keywords, must be an object schema" just because it has none of
  // `properties`/`required`/`additionalProperties`/`if` either.
  const looksLikeObjectSchema =
    schema['type'] === 'object' ||
    'properties' in schema ||
    'required' in schema ||
    'additionalProperties' in schema ||
    'if' in schema;
  if (looksLikeObjectSchema && !('const' in schema) && !Array.isArray(schema['enum'])) {
    if (!isPlainObject(value)) return false;
    const propertiesRaw = schema['properties'];
    const properties = isPlainObject(propertiesRaw) ? propertiesRaw : {};
    const requiredRaw = schema['required'];
    const required = Array.isArray(requiredRaw) ? requiredRaw : [];
    for (const key of required) {
      if (typeof key !== 'string' || !(key in value)) return false;
    }
    if (schema['additionalProperties'] === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) return false;
      }
    }
    for (const [key, propSchemaRaw] of Object.entries(properties)) {
      if (!(key in value)) continue;
      if (!isPlainObject(propSchemaRaw)) {
        throw new Error(`matchesSchema: property schema for "${key}" is not an object node`);
      }
      if (!matchesSchema(propSchemaRaw, value[key])) return false;
    }
    // `if`/`then`/`else`: `then`/`else` are each applied as an ADDITIONAL schema, never a replacement
    // for the checks above -- mirrors the real JSON Schema semantics confirmed live (`adopt-agent.ts`'s
    // own `ADOPT_TESTS_OUTPUT_SCHEMA` doc comment). `if` is a TEST only (whether `value` matches it),
    // never itself enforced on `value`.
    const ifSchema = schema['if'];
    if (isPlainObject(ifSchema)) {
      const matchesIf = matchesSchema(ifSchema, value);
      const branch = matchesIf ? schema['then'] : schema['else'];
      if (isPlainObject(branch) && !matchesSchema(branch, value)) return false;
    }
    return true;
  }
  if ('const' in schema) return value === schema['const'];
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) return enumValues.includes(value);
  if (schema['type'] === 'string') return typeof value === 'string';
  if (schema['type'] === 'boolean') return typeof value === 'boolean';
  if (schema['type'] === 'integer') return typeof value === 'number' && Number.isInteger(value);
  throw new Error(`matchesSchema: unhandled schema node ${JSON.stringify(schema)}`);
}

/** A real, valid structured `command` (`structuredTestCommandSchema`'s own shape) -- shared across
 * fixtures below so each one varies only the field this suite is actually targeting. */
const VALID_COMMAND = {
  run: 'node --test',
  output: { source: 'stdout' },
  format: 'tap',
};

/** Asserts a sample's real-validator verdict (`proposalResponseSchema.safeParse`) and its
 * `ADOPT_TESTS_OUTPUT_SCHEMA` verdict (`matchesSchema`) AGREE, and both equal `expectAccepted` -- the
 * real property this whole suite exists to prove. */
function expectBothAgree(sample: unknown, expectAccepted: boolean): void {
  const zodVerdict = proposalResponseSchema.safeParse(sample).success;
  const jsonSchemaVerdict = matchesSchema(ADOPT_TESTS_OUTPUT_SCHEMA, sample);
  expect(zodVerdict).toBe(expectAccepted);
  expect(jsonSchemaVerdict).toBe(expectAccepted);
}

describe('ADOPT_TESTS_OUTPUT_SCHEMA agrees with the real proposalResponseSchema validator (specs/22 M17 P21)', () => {
  it('accepts a real, valid normal proposal (command + probe + runnerVersion + reason)', () => {
    expectBothAgree(
      {
        command: VALID_COMMAND,
        probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'a real proposal',
      },
      true,
    );
  });

  it('accepts a real, valid noTestsFound proposal (command + adrSummary + reason, no probe)', () => {
    expectBothAgree(
      {
        noTestsFound: true,
        command: VALID_COMMAND,
        adrSummary: 'no tests exist yet',
        reason: 'genuinely no test setup',
      },
      true,
    );
  });

  it('accepts an explicit noTestsFound:false the same as omitting it -- the "if" branch\'s own const:true check correctly falls through to "else"', () => {
    expectBothAgree(
      {
        noTestsFound: false,
        command: VALID_COMMAND,
        probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'explicit false, same as absent',
      },
      true,
    );
  });

  it('THE LIVE DEFECT: rejects noTestsFound:true with a "probe" field and no "adrSummary" -- the exact shape a model given the OLD flat schema could plausibly produce', () => {
    expectBothAgree(
      {
        noTestsFound: true,
        command: VALID_COMMAND,
        probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
        reason: 'mixed both branches -- never valid in either',
      },
      false,
    );
  });

  it('rejects a normal proposal missing "probe" and "runnerVersion" -- the ORCHESTRATOR-flagged concern that the top-level required array alone is not enough to catch', () => {
    expectBothAgree({ command: VALID_COMMAND, reason: 'missing probe and runnerVersion' }, false);
  });

  it('rejects when the nested "probe" object itself is missing a required field ("expectedName") -- proves the NESTED object is constrained too, not only the top-level branch', () => {
    expectBothAgree(
      {
        command: VALID_COMMAND,
        probe: { path: 'probe.test.js', content: 'x' },
        runnerVersion: '1.0.0',
        reason: 'probe is missing expectedName',
      },
      false,
    );
  });

  it('rejects an extra, unrecognized top-level key on an otherwise-valid normal proposal -- mirrors .strict(), not a quiet ignore', () => {
    expectBothAgree(
      {
        command: VALID_COMMAND,
        probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'has an extra key',
        bogusExtraField: 'nope',
      },
      false,
    );
  });

  it('rejects command.output claiming source: "file" with no "path" -- the nested command.output union is constrained too', () => {
    expectBothAgree(
      {
        command: { run: 'node --test', output: { source: 'file' }, format: 'tap' },
        probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'file output with no path',
      },
      false,
    );
  });

  it('rejects command.output with an extra, unrecognized key alongside a valid "source"', () => {
    expectBothAgree(
      {
        command: { run: 'node --test', output: { source: 'stdout', extra: 'nope' }, format: 'tap' },
        probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
        runnerVersion: '1.0.0',
        reason: 'output has a stray key',
      },
      false,
    );
  });

  it('DISCLOSED, DELIBERATE DIVERGENCE: a bare-string "command" (the legacy form) passes the real zod union but is refused by ADOPT_TESTS_OUTPUT_SCHEMA -- COMMAND_JSON_SCHEMA never offers the model that shape at all, see its own doc comment', () => {
    const sample = {
      command: 'pnpm test',
      probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
      runnerVersion: '1.0.0',
      reason: 'a bare string, which an agent proposal may not actually use',
    };
    // `testCommandEntrySchema` (`proposalResponseSchema`'s own `command` field) accepts the legacy
    // bare string at the outer union level -- `parseProposalResponse` is what actually refuses it,
    // with its own dedicated error, AFTER this union already accepted it.
    expect(proposalResponseSchema.safeParse(sample).success).toBe(true);
    // The schema actually shown to the model types `command` as the structured form alone
    // (`COMMAND_JSON_SCHEMA`) -- steering the model away from ever offering this shape, rather than
    // only catching it after the fact.
    expect(matchesSchema(ADOPT_TESTS_OUTPUT_SCHEMA, sample)).toBe(false);
  });

  it('DISCLOSED, DELIBERATE DIVERGENCE #2: a noTestsFound:true proposal that ALSO includes "probe" (otherwise a complete, valid branch-B shape) is refused by the real zod union (.strict(), an unrecognized key) but accepted by ADOPT_TESTS_OUTPUT_SCHEMA -- the flat, non-union design this schema was forced into (top-level anyOf/oneOf/allOf is refused by the real API, see this file\'s own top doc comment) cannot express per-branch additionalProperties, so it cannot catch this specific mixed shape at the schema level; parseProposalResponse\'s own real validator, run below, remains the authoritative gate against it', () => {
    const sample = {
      noTestsFound: true,
      command: VALID_COMMAND,
      probe: { path: 'probe.test.js', content: 'x', expectedName: 'x' },
      adrSummary: 'no tests exist yet',
      reason: 'a complete branch-B shape, PLUS a stray probe from the other branch',
    };
    // The real validator still correctly refuses this -- `probe` is not one of branch B's own
    // `.strict()` keys.
    expect(proposalResponseSchema.safeParse(sample).success).toBe(false);
    // The schema shown to the model cannot express that exclusion (no top-level anyOf is available on
    // this transport), so it accepts it -- `probe` IS a declared top-level property (needed for the
    // OTHER branch), so `additionalProperties: false` does not catch it here. Disclosed, not hidden.
    expect(matchesSchema(ADOPT_TESTS_OUTPUT_SCHEMA, sample)).toBe(true);
  });
});
