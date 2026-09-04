/**
 * `no-platform-concept` — the strings `claude`, `subagent`, and current model names must not appear
 * outside `packages/adapter-*`.
 *
 * Plain ESM with JSDoc, not TypeScript — see the note at the top of `../graph.mjs`.
 *
 * `mcp` is deliberately not in the banned set: `SPEC-QUESTIONS.md` Q2 carves it out because the MCP
 * server registry lives in `@forge/extensions`, above `adapter-kit`, and names servers generically
 * without knowing what Claude is.
 *
 * Scans identifiers and string/template literals — the places a platform concept becomes *behaviour*
 * — and deliberately does not scan comments. A doc comment explaining why a config field is a bare
 * `string` rather than a closed enum ("so a value like 'claude-code' can be registered without a
 * schema change") is the kind of *why* comment R8 asks for, and it would trip on the very word it is
 * explaining. `SPEC-QUESTIONS.md` Q16 records the design choice this rule leans on: platform and
 * model identifiers are opaque configuration values below `adapter-kit`, never enum members or
 * branches, so the tokens should not need to appear in behavioural code there at all.
 *
 * **This deliberately also fires on a static import of an adapter package's name from outside
 * `adapter-*`** — e.g. `import { ClaudeCodeAdapter } from '@forge/adapter-claude-code'` written in
 * `packages/cli`, even though `PACKAGE_GRAPH.cli` includes `adapter-claude-code` per `specs/02`
 * §2.2's "cli ← everything". That edge is not permission to name the adapter in source: it exists so
 * a consumer can *package* it (a dependency the installer sets up) or *load it dynamically* through
 * `adapter-kit`'s registry (a specifier built from configuration, never a literal), which is the
 * whole reason `adapter-kit` exists as the boundary in the first place. A static, literal import of
 * an adapter package by name outside `adapter-*` is exactly a platform concept leaking into code that
 * is supposed to be generic — the failure this rule exists to catch, not an exemption from it.
 *
 * @see specs/README §2 principle 8
 * @see CLAUDE.md
 */
import { locateFile } from '../locate.mjs';

/**
 * Tokens forbidden outside `packages/adapter-*`.
 *
 * Necessarily incomplete: a model released after this list was last updated will not be caught.
 * `SPEC-QUESTIONS.md` Q16 records that limitation rather than leaving it implicit.
 */
const PLATFORM_TOKENS = new Set(['claude', 'subagent', 'opus', 'sonnet', 'haiku', 'fable']);

/**
 * Splits an identifier into its constituent words, for whole-word matching against the ban list.
 * @param {string} name
 * @returns {string[]}
 */
function identifierWords(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/**
 * The single banned token `words` contains as a whole word, if any.
 * @param {readonly string[]} words
 * @returns {string | undefined}
 */
function findToken(words) {
  return words.find((word) => PLATFORM_TOKENS.has(word));
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid platform-specific names outside packages/adapter-*.',
    },
    schema: [],
    messages: {},
  },
  create(context) {
    const location = locateFile(context.filename);
    // Governs packages/* only, and only outside the adapter packages themselves — an adapter's own
    // source is exactly where these names are supposed to live.
    if (location === undefined || location.root !== 'packages') return {};
    if (location.pkg.startsWith('adapter-')) return {};

    return {
      Identifier(node) {
        const token = findToken(identifierWords(node.name));
        if (token === undefined) return;
        context.report({
          node,
          message:
            `'${node.name}' names the platform concept '${token}'. specs/README §2 principle 8: ` +
            `no platform-specific concept may leak past @forge/adapter-kit. Move this behind an ` +
            `adapter, or generalise the name.`,
        });
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const token = findToken(identifierWords(node.value));
        if (token === undefined) return;
        context.report({
          node,
          message:
            `This string names the platform concept '${token}'. specs/README §2 principle 8: no ` +
            `platform-specific concept may leak past @forge/adapter-kit. If this is an opaque ` +
            `configuration value (a platform id an adapter registers), type the field as a plain ` +
            `string rather than embedding the literal here.`,
        });
      },
      TemplateElement(node) {
        const token = findToken(identifierWords(node.value.raw));
        if (token === undefined) return;
        context.report({
          node,
          message: `This template text names the platform concept '${token}'. See the Literal rule.`,
        });
      },
    };
  },
};

export default rule;
