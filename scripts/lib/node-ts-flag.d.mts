/**
 * Companion declaration file for `./node-ts-flag.mjs`, so a `packages/*` test file importing it
 * type-checks under that package's own, isolated `tsconfig.json` (which does not set `allowJs` the
 * way the repository ROOT `tsconfig.json` does for `scripts/**\/*.mjs` itself) without needing every
 * such package's own project config widened just to infer two plain constants' types.
 */
export declare function supportsNativeStripTypes(nodeVersion: string): boolean;
export declare const SUPPORTS_NATIVE_STRIP_TYPES: boolean;
export declare const TS_NODE_FLAG: string;
