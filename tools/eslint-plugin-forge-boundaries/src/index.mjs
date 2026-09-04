/**
 * The `specs/02` §2.2 boundary rules, as an ESLint plugin.
 *
 * Plain ESM, not TypeScript: `eslint.config.js` imports this directly under plain `node` when
 * ESLint starts, before any TypeScript transform exists to help it. See the note at the top of
 * `graph.mjs`.
 *
 * @see specs/02 §2.2
 */
import noDeepPackageImport from './rules/no-deep-package-import.mjs';
import noPlatformConcept from './rules/no-platform-concept.mjs';
import noUndeclaredPackageImport from './rules/no-undeclared-package-import.mjs';

export { FORGE_PACKAGES, PACKAGE_GRAPH, isDeclaredDependency, isForgePackage } from './graph.mjs';

/** The plugin object `eslint.config.js` loads under a `forge-boundaries` prefix. */
const plugin = {
  rules: {
    'no-undeclared-package-import': noUndeclaredPackageImport,
    'no-deep-package-import': noDeepPackageImport,
    'no-platform-concept': noPlatformConcept,
  },
};

export default plugin;
