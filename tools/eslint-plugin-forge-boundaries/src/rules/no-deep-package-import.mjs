/**
 * `no-deep-package-import` — even a declared dependency must be reached through its public entry
 * point, never through its internals.
 *
 * Plain ESM with JSDoc, not TypeScript — see the note at the top of `../graph.mjs`.
 *
 * Two shapes are refused:
 *
 * - a bare specifier whose subpath reaches into `src/` or `dist/` (`@forge/core/src/errors/codes`),
 *   rather than a subpath the target package actually publishes (`@forge/core/errors`);
 * - **any** relative import that crosses into another package at all (`../../schemas/src/x`).
 *   A relative path has no notion of "public entry" to begin with — the only way to import another
 *   package's surface on purpose is its `@forge/x` specifier — so crossing a package boundary this
 *   way is refused independent of whether the target is even a declared dependency. When it is not,
 *   `no-undeclared-package-import` reports the same import a second time; that duplication is
 *   deliberate; each rule names a distinct defect and a reader should see both.
 *
 * @see specs/02 §2.2
 */
import { locateFile, locateSpecifier } from '../locate.mjs';

/** A subpath that reaches past a package's public surface into its build layout. */
const INTERNAL_SUBPATH = /(?:^|\/)(?:src|dist)(?:\/|$)/;

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
  if (current === undefined || current.root !== 'packages') return;

  const specifier = source.value;
  const target = locateSpecifier(specifier, filename);
  if (target === undefined || target.pkg === current.pkg) return;

  const node = /** @type {import('eslint').Rule.Node} */ (holder);
  const viaRelative = specifier.startsWith('.');
  if (viaRelative) {
    context.report({
      node,
      message:
        `A relative import may not cross into another package (reached packages/${target.pkg} ` +
        `from packages/${current.pkg}). Import its public entry point instead: ` +
        `\`@forge/${target.pkg}\`.`,
    });
    return;
  }

  if (target.subpath !== undefined && INTERNAL_SUBPATH.test(target.subpath)) {
    context.report({
      node,
      message:
        `\`${specifier}\` reaches past @forge/${target.pkg}'s public entry point into its build ` +
        `layout. Import a subpath the package actually publishes (its package.json "exports"), or ` +
        `\`@forge/${target.pkg}\` itself.`,
    });
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: "Forbid reaching past a workspace package's public entry point.",
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
