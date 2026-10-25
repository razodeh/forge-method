/**
 * The real `load` hook `worker-ts-strip-loader.mjs` registers — strips TypeScript types via the
 * real TypeScript compiler (`ts.transpileModule`, syntax-only erasure, never type-checking: the
 * identical semantics Node's own `--experimental-strip-types` and `tsx` both provide, just a
 * different engine).
 *
 * Exists ONLY because `tsx` (this repo's own general Node-20 stand-in for
 * `--experimental-strip-types`, `./node-ts-flag.mjs`) does not work for a `worker_threads.Worker`'s
 * own module loading — confirmed live, empirically, not assumed (`Q340`): `tsx`'s own hooks module
 * silently installs nothing when loaded via `--import` through a `Worker`'s own `execArgv` (no
 * error, no transform — the `.ts` load just fails downstream with `ERR_UNKNOWN_FILE_EXTENSION`,
 * exactly as if no loader were registered at all), and throws its own explicit, actionable error
 * ("tsx must be loaded with --import instead of --loader") when registered the modern,
 * `module.register()` way instead — a real, specific `tsx` limitation around worker threads, not a
 * Node limitation: this hand-written, generic hook (register "a load hook that gates on file
 * extension and delegates everything else to `nextLoad`") DOES get invoked correctly for a
 * `Worker`'s own module resolution via `execArgv`, confirmed directly against a real Node 20.19.6
 * binary with this exact file.
 *
 * @see scripts/lib/worker-ts-strip-loader.mjs
 * @see packages/cli/src/commands/parity/normalize-budget.ts
 * @see SPEC-QUESTIONS.md Q340
 */
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const TS_EXTENSIONS = ['.ts', '.mts', '.cts'];

/**
 * @param {string} url
 * @param {{format?: string}} context
 * @param {(url: string, context: unknown) => Promise<{source: string | ArrayBuffer | Uint8Array}>} nextLoad
 */
export async function load(url, context, nextLoad) {
  if (!TS_EXTENSIONS.some((ext) => url.endsWith(ext))) {
    return nextLoad(url, context);
  }
  const result = await nextLoad(url, { ...context, format: 'module' });
  const rawSource = result.source;
  const source =
    typeof rawSource === 'string'
      ? rawSource
      : Buffer.from(
          rawSource instanceof ArrayBuffer ? new Uint8Array(rawSource) : rawSource,
        ).toString('utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      sourceMap: false,
    },
    fileName: url,
  });
  return { source: outputText, format: 'module', shortCircuit: true };
}
