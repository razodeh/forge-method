/**
 * `checkJsonContract` — `specs/22` M6's own exit-test line: `forge --json status ... | node
 * scripts/assert-json-contract.mjs` must genuinely fail on a malformed `--json` stream, not only pass
 * on well-formed input. The real `{"v":1,...}` envelope convention is `03` §3.5's own contract
 * (`packages/cli/src/output/format-json-event.ts`'s own doc comment names it); every real `--json`
 * output this codebase already produces follows it (`DoctorReport`, `UpgradeReport`, and this piece's
 * own new `RunStatusReport`), so this checks the one real, common shape every one of them shares
 * rather than a command-specific schema no general contract checker could know in advance.
 *
 * @see specs/22 M6
 * @see specs/03 §3.5
 * @see PLAN-M6.md C9
 */

/**
 * One real problem found with a real `--json` stream — a plain string, not a class, so both the CLI
 * script and this module's own test can print/assert on it identically.
 *
 * @param {string} text
 * @returns {readonly string[]}
 */
export function checkJsonContract(text) {
  const violations = [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return [`not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`];
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return ['top-level JSON value must be a real object, not a scalar/array/null'];
  }

  if (!Object.hasOwn(parsed, 'v')) {
    violations.push('missing required "v" field');
  } else if (parsed.v !== 1) {
    violations.push(`"v" must be the literal number 1; found ${JSON.stringify(parsed.v)}`);
  }

  // "monotonic/well-formed structure": a critic round caught this originally walking only the
  // top-level object's own fields, which is exactly where none of this codebase's own real `--json`
  // envelopes keep their interesting content -- `RunStatusReport` (the actual real target of this
  // exit test) nests every real field (`runId`, `stepCounts`, ...) one level under `status`, and
  // `DoctorReport`/`UpgradeReport` both nest arrays of their own real per-item objects too. Walking
  // recursively (through real, plain objects and real arrays) is what actually reaches the content
  // every one of those real envelopes carries, rather than only ever validating `v` and top-level
  // object-shapedness. An `undefined`-valued key (JSON itself can never encode one; only a value
  // reachable through a non-JSON producer, or a bug upstream serializing `undefined` as the four-byte
  // string `"undefined"`, could produce one) or a bare `NaN`/`Infinity` literal (also not real JSON,
  // but checked defensively since `JSON.parse` never rejects a string *containing* those words inside
  // a value) signals a genuinely malformed producer, not real, well-formed output.
  walkForSerializationBugs(parsed, '$', violations);

  return violations;
}

/**
 * @param {unknown} value
 * @param {string} pointer
 * @param {string[]} violations
 */
function walkForSerializationBugs(value, pointer, violations) {
  if (value === 'undefined') {
    violations.push(
      `field ${pointer} is the literal string "undefined" -- likely a serialization bug`,
    );
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    violations.push(`field ${pointer} is not a finite real number: ${JSON.stringify(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkForSerializationBugs(entry, `${pointer}[${String(index)}]`, violations),
    );
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      walkForSerializationBugs(entry, `${pointer}.${key}`, violations);
    }
  }
}
