/**
 * The real `--import` entry point a `worker_threads.Worker`'s own `execArgv` loads, to register
 * `./worker-ts-strip-hooks.mjs`'s own `load` hook. Kept as a separate file from the hooks module
 * itself (matching Node's own documented customization-hooks pattern) rather than having the hooks
 * module call `module.register()` on itself: the hook functions run inside a SEPARATE, internal
 * loader thread Node spins up, which re-evaluates whatever module `register()` points at in its own
 * context — a self-referential `register(import.meta.url, import.meta.url)` call would re-trigger
 * from inside that very re-evaluation, an untested, unneeded risk this two-file split avoids
 * entirely.
 *
 * @see scripts/lib/worker-ts-strip-hooks.mjs
 */
import { register } from 'node:module';

register(new URL('./worker-ts-strip-hooks.mjs', import.meta.url), import.meta.url);
