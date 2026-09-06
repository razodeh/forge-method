/**
 * `parseTransclusionMarkers`/`checkTransclusion` — `08` §8.11.4's `<!-- forge:diagram ... -->` marker
 * format.
 *
 * @see specs/08 §8.11.4
 * @see PLAN-M3.md P4
 * @see SPEC-QUESTIONS.md Q47
 */
import type { TransclusionBlock } from './types.ts';

const OPEN_MARKER_LINE = /^\s*<!--\s*forge:diagram\s+(.*?)\s*-->\s*$/;
const CLOSE_MARKER_LINE = /^\s*<!--\s*\/forge:diagram\s*-->\s*$/;
const FENCE_OPEN_LINE = /^\s*```mermaid\s*$/;
const FENCE_CLOSE_LINE = /^\s*```\s*$/;

/** `lines[i]`, for an `i` every call site already bounds with its own `while`/`if` condition before
 * indexing — one place for the `noUncheckedIndexedAccess` fallback `parseTransclusionMarkers` would
 * otherwise repeat at every one of its own array accesses. */
function lineAt(lines: readonly string[], i: number): string {
  return lines[i] ?? '';
}

/** One attribute's value, whether written bare (`id=DIAG-014`, the spec's own worked example) or
 * quoted (`id="DIAG-014"`/`id='DIAG-014'`, the ordinary way anyone used to HTML-comment-shaped
 * syntax reaches for) — quotes, when present, are stripped, not treated as part of the value. */
function extractAttribute(attributeText: string, name: 'id' | 'src'): string | undefined {
  const pattern = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|(\\S+))`);
  const match = pattern.exec(attributeText);
  if (match === null) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

/** `08` §8.11.4's own two attributes, extracted independently of which order they appear in — the
 * worked example happens to write `id=` before `src=`, but nothing in the spec text makes that
 * order load-bearing, and a gauntlet critic found a first version of this parser silently matching
 * nothing at all when they were swapped. */
function parseMarkerAttributes(attributeText: string): {
  id: string | undefined;
  src: string | undefined;
} {
  return {
    id: extractAttribute(attributeText, 'id'),
    src: extractAttribute(attributeText, 'src'),
  };
}

/** A single normalised line ending everywhere, so a document saved with CRLF (the Windows default,
 * and a routine outcome of `core.autocrlf=true`) is never treated as "different content" from one
 * saved with LF — a gauntlet critic found a first version of this parser and `checkTransclusion`
 * reporting false drift purely from line-ending convention, with no real content difference at all. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/**
 * Every `<!-- forge:diagram id=... src=... --> ... <!-- /forge:diagram -->` block in `markdown`.
 * `[]` for a document with none, or for a block whose start/end markers are present but malformed —
 * never throws, matching every other boundary-input function in this milestone.
 *
 * A real line-based scan, not one large regex: a single pattern anchored to the spec's own worked
 * example's exact line layout (attribute order, no blank lines, no trailing whitespace) silently
 * matched nothing at all for entirely ordinary Markdown formatting variance — swapped attributes, a
 * blank line before the fence, trailing spaces on the marker line — found by a gauntlet critic
 * feeding it real adversarial-but-ordinary input, not a contrived one.
 */
export function parseTransclusionMarkers(markdown: string): readonly TransclusionBlock[] {
  const lines = normalizeLineEndings(markdown).split('\n');
  const blocks: TransclusionBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const openMatch = OPEN_MARKER_LINE.exec(lineAt(lines, index));
    if (openMatch === null) {
      index += 1;
      continue;
    }

    const { id, src } = parseMarkerAttributes(openMatch[1] ?? '');
    if (id === undefined || src === undefined) {
      index += 1;
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && lineAt(lines, cursor).trim() === '') cursor += 1;
    if (cursor >= lines.length || !FENCE_OPEN_LINE.test(lineAt(lines, cursor))) {
      index += 1;
      continue;
    }
    cursor += 1;

    const contentLines: string[] = [];
    while (cursor < lines.length && !FENCE_CLOSE_LINE.test(lineAt(lines, cursor))) {
      contentLines.push(lineAt(lines, cursor));
      cursor += 1;
    }
    if (cursor >= lines.length) {
      index += 1;
      continue;
    }
    cursor += 1;

    while (cursor < lines.length && lineAt(lines, cursor).trim() === '') cursor += 1;
    if (cursor >= lines.length || !CLOSE_MARKER_LINE.test(lineAt(lines, cursor))) {
      index += 1;
      continue;
    }

    blocks.push({ diagramId: id, src, fencedContent: contentLines.join('\n') });
    index = cursor + 1;
  }

  return blocks;
}

/** `08` §8.11.4's own worked example line — added at transclusion time, not part of the `.mmd` file
 * itself, so a real drift check must reconstruct it rather than compare `sourceContent` bare. */
function transclusionHeader(src: string): string {
  return `%% forge:generated-from ${src} — do not edit here`;
}

/**
 * Whether `block`'s fenced copy still matches its `.mmd` source (`sourceContent`) exactly — line
 * endings and trailing whitespace normalised on both sides, since neither is real "drift": a text
 * file's own trailing newline, or a document saved with CRLF, carries no content difference at all.
 */
export function checkTransclusion(block: TransclusionBlock, sourceContent: string): boolean {
  const expected = `${transclusionHeader(block.src)}\n${normalizeLineEndings(sourceContent).trimEnd()}`;
  return normalizeLineEndings(block.fencedContent).trimEnd() === expected;
}
