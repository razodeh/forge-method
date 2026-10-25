/**
 * Companion declaration file for `./node-version.mjs`, so a `packages/*` test or source file
 * importing it type-checks under that package's own, isolated `tsconfig.json` without needing every
 * such package's own project config widened just to infer two plain values' types.
 */
export declare function supportsNativeStripTypes(nodeVersion: string): boolean;
export declare const SUPPORTS_NATIVE_STRIP_TYPES: boolean;
