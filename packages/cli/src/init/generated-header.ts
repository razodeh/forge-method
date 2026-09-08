/**
 * The regenerated-file header `03` §3.3's own idempotency rule requires on every regenerable file:
 * `<!-- forge:generated v=<ver> hash=<sha> — edits will be overwritten; use overrides/ -->`.
 *
 * The spec's own literal text is one HTML-comment-shaped string, but a YAML file (every
 * `.forge/workflows/**`/`.forge/frameworks/**`/`.forge/checks/**`/`.forge/agents/**` file this piece
 * writes) cannot parse an HTML comment as a comment at all — `<!-- ... -->` on its own line is a
 * YAML syntax error, not a no-op. The header text is preserved verbatim; only the comment delimiter
 * is adapted per file type (`#` for YAML, `<!-- -->` for Markdown), the minimum change that keeps the
 * header meaningful in every regenerable file this piece actually writes rather than only the subset
 * that happens to be Markdown. See `SPEC-QUESTIONS.md` Q103.
 */
const HEADER_TEXT = (version: string, hash: string): string =>
  `forge:generated v=${version} hash=${hash} — edits will be overwritten; use overrides/`;

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

function extensionOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot === -1 ? '' : filePath.slice(dot);
}

/** The header line(s) to prepend to `filePath`'s content, chosen by its extension. */
export function generatedHeader(filePath: string, version: string, hash: string): string {
  const text = HEADER_TEXT(version, hash);
  return YAML_EXTENSIONS.has(extensionOf(filePath)) ? `# ${text}\n` : `<!-- ${text} -->\n`;
}
