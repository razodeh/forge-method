/**
 * `pnpm forge --json status ... | node scripts/assert-json-contract.mjs` — `specs/22` M6's own literal
 * exit-test line.
 *
 * A thin CLI: read stdin in full, check it, report, set the exit code. The decision logic lives in
 * `scripts/lib/json-contract.mjs`, covered by its own real test (`scripts/json-contract.test.ts`),
 * following the same split `scripts/check-boundaries.mjs`/`scripts/assert-schema-drift.mjs` already
 * use, for the same reason: a check nobody has exercised is indistinguishable from one that always
 * passes.
 *
 * @see specs/22 M6
 * @see PLAN-M6.md C9
 */
import { Buffer } from 'node:buffer';

import { checkJsonContract } from './lib/json-contract.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const text = await readStdin();
const violations = checkJsonContract(text);

if (violations.length === 0) {
  console.log('Real, well-formed {"v":1,...} JSON contract. No violations.');
  process.exitCode = 0;
} else {
  console.error(
    `JSON contract check failed (specs/22 M6 exit test): ${String(violations.length)} ` +
      `${violations.length === 1 ? 'violation' : 'violations'}.\n`,
  );
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
}
