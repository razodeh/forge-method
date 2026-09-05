/**
 * `@forge/schemas` — the domain data every other package validates against.
 *
 * `specs/02` §2.2 places this package at the bottom of the dependency graph: it may import nothing
 * else under `@forge/*`, so every schema and every piece of registry data lives here or nowhere.
 *
 * @see specs/02 §2.2
 */
export * from './artifacts/index.ts';
export * from './config/index.ts';
export * from './json-schema/index.ts';
export * from './registry/index.ts';
