/**
 * Where a command module writes. `bin.ts` is the one file allowed to print (`no-console`), so a command that has
 * output to produce takes this port and `bin.ts` passes `console`.
 */
/** The two streams a command writes to, injected so only `bin.ts` touches `console`. */
export interface OutputPort {
  log(text: string): void;
  error(text: string): void;
}

/** Text that came from a project file reaches the terminal in the human forms of the gate rule commands, so
 * control and format characters (bidi overrides, zero-width) are replaced first. JSON output is escaped by `JSON.stringify` and needs none. */
export function printable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '?');
}

/** Why a gate rule could not run at all (an invalid `.forge/config.yaml`, a corrupt document it had to read), as text
 * a violation can carry. A gate reads the rule's envelope and ignores the exit code, and a refusal printed by the
 * top-level handler has no `errors` or `failed` field, which a gate reads as "not failing". So every gate rule command
 * catches whatever stops it and turns it into one failing verdict instead of letting it escape.
 *
 * `ForgeError` (and the other coded errors) carry a `remedy`; anything else gets the generic one. */
export function describeRefusal(error: unknown): {
  readonly message: string;
  readonly remedy: string;
} {
  const coded = error as { readonly message?: unknown; readonly remedy?: unknown } | null;
  const message =
    typeof coded?.message === 'string' && coded.message !== '' ? coded.message : String(error);
  const remedy =
    typeof coded?.remedy === 'string' && coded.remedy !== ''
      ? coded.remedy
      : 'Fix what the message names, then run the check again.';
  return { message: printable(message), remedy: printable(remedy) };
}

/** Like `printable`, for the multi-line output of a command (a failing test's stderr): line breaks and tabs are kept,
 * every other control or format character is replaced. Used only where the text is a block the reader expects to
 * be several lines, never for a one-line message that names a project file. */
export function printableBlock(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === '\n' || char === '\t' ? char : '?'));
}
