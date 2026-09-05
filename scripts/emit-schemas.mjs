/**
 * `pnpm emit-schemas` — writes `packages/schemas/json/*.schema.json`.
 *
 * A thin CLI: the actual emission and comparison logic lives in `scripts/lib/schema-drift.mjs`.
 *
 * @see specs/02 §2.1
 * @see PLAN-M1.md P9
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEmitSchemas } from './lib/schema-drift.mjs';

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'schemas',
  'json',
);

function main() {
  mkdirSync(outDir, { recursive: true });
  const schemas = runEmitSchemas();
  for (const [filename, content] of schemas) {
    writeFileSync(path.join(outDir, filename), content);
  }
  console.log(`Emitted ${String(schemas.size)} schema files to ${outDir}.`);
  return 0;
}

process.exitCode = main();
