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

/** Whether `content` itself opens with a real, `18` §18.6-shaped front-matter block — recognized by
 * its own literal `---` opening line, independent of `filePath`'s extension. */
function startsWithFrontMatter(content: string): boolean {
  return content.startsWith('---\n') || content.startsWith('---\r\n');
}

/**
 * Combines `content` with its own real generated-content header, placed where it stays meaningful
 * *and* leaves `content`'s own real structure parseable.
 *
 * `generatedHeader`'s own plain prepend is correct for ordinary content, but a critic round caught it
 * silently corrupting the one real shape this piece also writes: a Markdown file that itself carries
 * real YAML front matter (`.forge/skills/<id>/SKILL.md`, `.forge/templates/<Type>.md` — both real,
 * already-shipped regenerable content). `generatedHeader` picks the HTML-comment form for any `.md`
 * file, and prepending `<!-- ... -->` *before* a `---` line moves the real front-matter delimiter off
 * line one, which every real front-matter parser in this codebase (`@forge/core/artifacts`'
 * `ArtifactDocument.parse`, `@forge/extensions/skills`' `parseSkillPackage`) requires literally as the
 * document's own first line — a document that used to parse now throws `CFG-005`, "no front matter
 * found," for a file that genuinely has some.
 *
 * When `content` itself opens with `---`, the header is inserted as a real YAML `#`-comment line
 * *inside* that front-matter block (right after the opening `---`), regardless of `filePath`'s own
 * extension — a real YAML comment is valid there, an HTML comment never is. Every other regenerable
 * file keeps `generatedHeader`'s own existing, already-tested prepend behavior unchanged.
 */
export function withGeneratedHeader(
  content: string,
  filePath: string,
  version: string,
  hash: string,
): string {
  if (!startsWithFrontMatter(content)) {
    return generatedHeader(filePath, version, hash) + content;
  }
  const firstLineEnd = content.indexOf('\n') + 1;
  return (
    content.slice(0, firstLineEnd) +
    `# ${HEADER_TEXT(version, hash)}\n` +
    content.slice(firstLineEnd)
  );
}
