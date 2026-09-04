/**
 * Terminal rendering for a `ForgeError`.
 *
 * Colour and ASCII are parameters rather than ambient lookups because `specs/18` §18.3 makes them
 * configuration (`output.color`, `output.ascii`) and `QUALITY-BAR.md` R10 forbids reading the
 * environment outside the config layer. A renderer that sniffs `process.stdout.isTTY` also produces
 * different bytes in CI than locally, which is exactly the class of difference the golden-file tests
 * in `specs/21` §21.3 exist to catch.
 *
 * @see specs/02 §2.6
 * @see specs/18 §18.3
 */
import type { ForgeError } from './forge-error.ts';
import { renderCause } from './forge-error.ts';
import { renderValue } from './render.ts';

/** How to render: both come from resolved configuration, never from the environment. */
export interface FormatOptions {
  /** Emit ANSI colour. */
  readonly color: boolean;
  /** Restrict output to ASCII, for terminals and log sinks that mangle anything else. */
  readonly ascii: boolean;
}

const ANSI = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  red: '[31m',
  yellow: '[33m',
  cyan: '[36m',
} as const;

/** Bullets by charset. The ASCII forms exist for Windows consoles and CI log processors. */
const GLYPHS = {
  unicode: { arrow: '→', bullet: '•' },
  ascii: { arrow: '->', bullet: '*' },
} as const;

function paint(text: string, colour: string, options: FormatOptions): string {
  return options.color ? `${colour}${text}${ANSI.reset}` : text;
}

/**
 * Renders an error as the block a user sees in the terminal.
 *
 * The order is deliberate: code and message first so the failure is identifiable at a glance, then
 * the observed values, then the remedy, then the link. `specs/22` M1 requires the remedy be present
 * on every error; putting it last means it is the line still on screen when output scrolls.
 */
export function formatForTerminal(error: ForgeError, options: FormatOptions): string {
  const glyphs = options.ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const severityColour = error.severity === 'warning' ? ANSI.yellow : ANSI.red;

  // The message is sanitised too: it interpolates the same detail values, so escaping only the
  // detail lines below left the ANSI and the newlines on the very first line.
  const lines: string[] = [
    `${paint(error.code, severityColour + ANSI.bold, options)} ${sanitise(error.message, options)}`,
  ];

  for (const [key, value] of Object.entries(error.details)) {
    lines.push(`  ${glyphs.bullet} ${key}: ${sanitise(renderValue(value), options)}`);
  }

  const cause = renderCause(error.cause);
  if (cause !== undefined) {
    // Name and message only: a stack in user-facing output buries the remedy and is meaningless to
    // anyone who did not write FORGE.
    lines.push(`  ${glyphs.bullet} caused by: ${sanitise(cause, options)}`);
  }

  lines.push(`${glyphs.arrow} ${paint(error.remedy, ANSI.bold, options)}`);
  lines.push(paint(`  ${error.docsUrl}`, ANSI.dim + ANSI.cyan, options));

  return lines.join('\n');
}

/**
 * Makes a value safe to print inside the error block.
 *
 * Details are attacker-adjacent in the ordinary sense: a branch name, a file path, or an adapter's
 * stdout. Three things have to be neutralised, and none of them requires a hostile author.
 *
 * - **Control characters**, including ANSI escapes, which `ADP-012`'s `reason` carries routinely.
 *   Left in place they repaint the terminal and defeat the `color: false` setting.
 * - **Newlines**, which would let a detail forge a line that reads exactly like the remedy arrow.
 * - **Non-ASCII**, when `ascii` is set — an accented branch name is ordinary, and `specs/18` §18.3's
 *   `output.ascii` exists for sinks that mangle anything else.
 */
function sanitise(value: string, options: FormatOptions): string {
  // `Array.from` rather than a spread or `split('')`: both mishandle surrogate pairs, and a branch
  // name or an adapter's stdout may contain any code point.
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    // C1 (0x80-0x9f) as well as C0: some terminals honour the 8-bit CSI at U+009B, and U+2028/9 are
    // line terminators to a JavaScript parser reading the log back.
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return `\\x${code.toString(16).padStart(2, '0')}`;
    }
    if (options.ascii && code > 0x7f) {
      return `\\u{${code.toString(16)}}`;
    }
    return character;
  }).join('');
}
