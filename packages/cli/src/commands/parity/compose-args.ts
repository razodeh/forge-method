/**
 * `composeArgs` — turns a surface's `run` and one case's literal `args` into the single line that is
 * vetted and, later, run: `13` F-TEST-9's own rule, "each [argument] is appended to the surface's
 * `run` as one single-quoted word, and the composed line is what vetting judges at load and what
 * runs."
 *
 * **Why this cannot simply quote-and-hope.** Naively building `run + " '" + arg + "'"` is unsafe
 * for an argument holding its own single quote: `node x.js 'it'"'"'s' extra` is NOT a parse error a
 * caller can rely on catching downstream — an argument such as `"x' extra 'y"`, naively wrapped,
 * produces `run 'x' extra 'y'`, which a quote-aware command splitter (`splitWords`,
 * `packages/engine/src/dispatch/confined-command.ts`) reads as FOUR clean words — `x`, `extra`, `y`
 * plus whatever follows — with no unterminated quote and no shell-operator character anywhere: a
 * classic quote-breakout word injection that smuggles an extra, unquoted argument onto the line
 * without using any of `; | & \` $( or a newline`, so nothing downstream that merely greps for those
 * characters would catch it. That is why a single quote inside an argument is refused HERE, before
 * any line is even built, rather than left for the engine's own vet to catch indirectly.
 *
 * **Why the other characters are refused here too, not only downstream.** `;`, `|`, `&`, a backtick
 * and `$(` (and a literal newline) cannot appear in a composed line at all — `confined-command.ts`'s
 * own `SHELL_OPERATOR_PATTERN` is checked against the whole raw command STRING before any
 * quote-aware parsing, so any of these characters anywhere in the composed line, single-quoted or
 * not, already makes `vetStoredCommand` refuse it. Refusing them here as well gives a declaration
 * author a clear, specific reason ("this argument cannot be safely quoted") at the one place that
 * knows which case and which argument caused it, rather than a generic downstream vet refusal that
 * only names the resulting line.
 *
 * **Why `~`, `*`, a tab and a space are NOT refused here.** None breaks single-quoting UNDER A
 * POSIX SHELL (a `~` or `*` inside single quotes is literal there — the shell never expands it —
 * and a tab/space is simply part of the one quoted word), so each composes into what a POSIX shell
 * reads as one safe word; whether the RESULT is otherwise acceptable (a glob that would escape the
 * project, say) is the vet's own job, over the composed line this function returns —
 * `declaration.ts` calls `vetStoredCommand` on exactly that line, never the bare `run`.
 *
 * **KNOWN GAP, DISCLOSED, NOT FIXED HERE: this scheme is POSIX-only and is known not to survive a
 * Windows `cmd.exe` shell.** Single-quoting an argument is a POSIX-shell convention; `cmd.exe` never
 * treats `'` as a quote character at all (confirmed by reading `execa`'s and Node's own
 * `child_process` source — on `win32` without an explicit `shell` option, argument splitting follows
 * Windows' own `CommandLineToArgvW`-family rules, where a bare `'` is just a literal character, not
 * a quote). Concretely, `composeArgs('node check.js', ['a b'])` returns
 * `"node check.js 'a b'"`, intending ONE argument, `a b`; under `cmd.exe` this would arrive as
 * `node.js`, `'a`, `b'` — THREE words — silently breaking the one-argument-per-quoted-word
 * guarantee this whole module exists to give, with no error anywhere. `specs/02` §2.7 names Windows
 * as a first-class platform, and this gap was not disclosed anywhere before this module's own
 * critic round found it. This piece (`PLAN-M16.md` P2) builds pure data only and runs nothing, so
 * there is no process here to make platform-conditional; fixing this is P3's (the observation
 * engine, which actually spawns the composed line) or a documented restriction to POSIX hosts —
 * either way, an open decision for whichever piece wires in a real Windows-shaped run, not this
 * one. No wording in this file claims this scheme is safe on Windows; read every "composes safely"
 * below as "composes into a single POSIX-shell-safe word" only.
 *
 * @see specs/13 F-TEST-9 (the surfaces bullet: "Its arguments are literal words...")
 * @see specs/02 §2.7 (Windows as a first-class platform)
 */

/** A character, or two-character sequence, that cannot appear inside a single-quoted word at all —
 * either because it breaks the quoting itself (a literal `'`) or because `confined-command.ts`'s own
 * `SHELL_OPERATOR_PATTERN` refuses it anywhere in the raw line regardless of quoting. Checked in this
 * order so the reported reason is the first one a reader would notice. */
const REFUSED_CHARACTERS: readonly {
  readonly test: (arg: string) => boolean;
  readonly label: string;
}[] = [
  { test: (arg) => arg.includes("'"), label: "a single quote (')" },
  { test: (arg) => arg.includes('\n') || arg.includes('\r'), label: 'a newline' },
  { test: (arg) => arg.includes(';'), label: 'a ";"' },
  { test: (arg) => arg.includes('|'), label: 'a "|"' },
  { test: (arg) => arg.includes('&'), label: 'a "&"' },
  { test: (arg) => arg.includes('`'), label: 'a backtick (`)' },
  { test: (arg) => arg.includes('$('), label: 'a "$("' },
];

/** The first reason `arg` cannot be composed into a safe single-quoted word, or `undefined` when it
 * can. Exported so a caller (or a test) can explain a refusal without re-deriving it from
 * {@link composeArgs}'s own `invalid` string. */
export function unsafeArgumentReason(arg: string): string | undefined {
  for (const { test, label } of REFUSED_CHARACTERS) {
    if (test(arg)) return label;
  }
  return undefined;
}

/**
 * Composes `run` with `args` appended, each as its own single-quoted word, in order — or the reason
 * composition is refused, when some argument cannot be safely quoted at all.
 *
 * Pure and synchronous: this decides nothing about whether the RESULTING line may run (that is
 * `vetStoredCommand`'s job, called by `declaration.ts` on exactly the string this returns) — it only
 * decides whether a single-quoted word that a POSIX shell reads as one safe argument can be built in
 * the first place (this module's own header comment discloses, and does not fix, that the scheme
 * itself is POSIX-only). `args` empty returns `run` unchanged (no trailing space), so a case with no
 * arguments composes to its surface's bare `run`.
 *
 * @see specs/13 F-TEST-9
 */
export function composeArgs(
  run: string,
  args: readonly string[],
): string | { readonly invalid: string } {
  const words: string[] = [];
  for (const [index, arg] of args.entries()) {
    const reason = unsafeArgumentReason(arg);
    if (reason !== undefined) {
      return {
        invalid: `argument ${String(index)} (${JSON.stringify(arg)}) contains ${reason}, which cannot be safely composed into a single-quoted word.`,
      };
    }
    words.push(`'${arg}'`);
  }
  return words.length === 0 ? run : `${run} ${words.join(' ')}`;
}
