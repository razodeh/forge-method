/**
 * `@forge/core` — the domain model shared by everything above it.
 *
 * `specs/02` §2.2 places this package below the engine, the adapters and the TUI, and above only
 * `@forge/schemas`. Nothing here may import from a package that depends on it.
 *
 * @see specs/02 §2.2
 */
export { DOCS_BASE_URL } from './constants.ts';
export * from './artifacts/index.ts';
export * from './errors/index.ts';
export * from './fs/index.ts';
