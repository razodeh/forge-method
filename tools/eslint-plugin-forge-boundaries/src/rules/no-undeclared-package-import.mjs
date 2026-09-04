/**
 * `no-undeclared-package-import` — an import of `@forge/x` from package `y` is an error unless
 * `x` is declared as one of `y`'s dependencies in `PACKAGE_GRAPH` (`specs/02` §2.2).
 *
 * Plain ESM with JSDoc, not TypeScript — see the note at the top of `../graph.mjs`.
 *
 * Applies to a relative import that resolves into a different package exactly as it applies to a
 * bare `@forge/x` specifier: the boundary is about which package's code you reach, not which syntax
 * you reach it with. A rule that only inspected `@forge/*` specifiers would be defeated by writing
 * `../../engine/src/x` instead.
 *
 * @see specs/02 §2.2
 */
import { isDeclaredDependency, isForgePackage } from '../graph.mjs';
import { locateFile, locateSpecifier } from '../locate.mjs';

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @param {{ source?: unknown } & import('estree').Node} holder
 * @returns {void}
 */
function checkSource(context, holder) {
  // Loosely typed on purpose: `source` varies across ImportDeclaration, ExportNamedDeclaration,
  // ExportAllDeclaration and ImportExpression (nullable, optional, or a general Expression), and
  // narrowing it to a precise estree union here bought nothing but false positives against checkJs.
  // Runtime narrowing to "is this a string literal" is both correct and sufficient.
  const source = /** @type {{ type?: unknown, value?: unknown } | null | undefined} */ (
    holder.source
  );
  if (source == null || source.type !== 'Literal' || typeof source.value !== 'string') return;

  const filename = context.filename;
  const current = locateFile(filename);
  // Governs packages/* only: specs/02 §2.2 is silent on tools/ and modules/, and a file that could
  // not be located at all (a fixture path in a test, an in-memory buffer) has nothing to check.
  if (current === undefined || current.root !== 'packages') return;

  const target = locateSpecifier(source.value, filename);
  if (target === undefined || target.pkg === current.pkg) return;

  if (!isForgePackage(current.pkg)) {
    // A `packages/*` folder specs/02 §2.2 does not name at all. Nothing it imports can be "declared"
    // for it, so every forge import from here is a violation — reported once it actually imports
    // something, rather than the moment the folder is created, so an empty scaffold stays quiet.
    context.report({
      node: /** @type {import('eslint').Rule.Node} */ (holder),
      message:
        `packages/${current.pkg} is not a package specs/02 §2.2 declares. Add it to FORGE_PACKAGES ` +
        `and PACKAGE_GRAPH in tools/eslint-plugin-forge-boundaries/src/graph.mjs before it imports ` +
        `another package.`,
    });
    return;
  }

  if (isForgePackage(target.pkg) && isDeclaredDependency(current.pkg, target.pkg)) return;

  const reverseHolds = isForgePackage(target.pkg) && isDeclaredDependency(target.pkg, current.pkg);
  const message = reverseHolds
    ? `packages/${current.pkg} may not import packages/${target.pkg}: ${target.pkg} depends on ` +
      `${current.pkg} per specs/02 §2.2, so this would create a cycle. If the dependency should run ` +
      `the other way, move the shared code down into a package both may depend on.`
    : `packages/${current.pkg} may not import packages/${target.pkg}: not declared as a dependency ` +
      `of ${current.pkg} in the specs/02 §2.2 graph. Add the edge there if it belongs, or depend on ` +
      `a package that already may reach it.`;

  context.report({ node: /** @type {import('eslint').Rule.Node} */ (holder), message });
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid importing a workspace package not declared as a dependency in the specs/02 §2.2 graph.',
    },
    schema: [],
    messages: {},
  },
  create(context) {
    return {
      ImportDeclaration: (node) => {
        checkSource(context, node);
      },
      ExportNamedDeclaration: (node) => {
        checkSource(context, node);
      },
      ExportAllDeclaration: (node) => {
        checkSource(context, node);
      },
      ImportExpression: (node) => {
        checkSource(context, node);
      },
      // `type X = import('@forge/engine').Y` — the inline type-import form, which parses to its own
      // node type rather than an ImportDeclaration. Missing this let an upward or deep type-only
      // import through untouched; ordinary code reaches for this form specifically to avoid a full
      // value import, so it is not an edge case. Untyped by checkJs (the TSImportType node type is
      // TypeScript-parser-specific, not part of the plain estree this file is otherwise typed
      // against), narrowed the same way `holder` is inside checkSource.
      TSImportType: (/** @type {{ source?: unknown } & import('estree').Node} */ node) => {
        checkSource(context, node);
      },
    };
  },
};

export default rule;
