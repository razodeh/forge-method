/**
 * The one place in this repo that imports `@forge/schemas`'s TypeScript source directly from plain
 * `node` — always invoked as a child process with `--experimental-strip-types` by
 * `runEmitSchemas` in `schema-drift.mjs`, never run or imported directly. Writes the emitted schemas
 * to stdout as `JSON.stringify([...map.entries()])`, for the parent process to read back.
 *
 * @see scripts/lib/schema-drift.mjs
 */
import { emitJsonSchemas } from '../../packages/schemas/src/json-schema/emit.ts';

const schemas = emitJsonSchemas();
process.stdout.write(JSON.stringify([...schemas.entries()]));
