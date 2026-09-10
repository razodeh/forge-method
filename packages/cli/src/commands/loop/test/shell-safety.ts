/**
 * `containsShellChaining` — guards every place this package appends a flag to a project-authored
 * `testCommands` string by literal string concatenation (`${command} --reporter=json`, `${command}
 * --format json`, `${command} --junitxml=...`). A fresh critic round reproduced directly: a real,
 * ordinary `testCommands.lint` value like `"eslint . && echo done"` (chaining a linter with a
 * second command — a completely normal `package.json`-script pattern) silently misroutes the
 * appended flag onto whichever command ends up last in the chain, producing either a false pass or
 * a false failure depending on shell structure, with zero signal that anything went wrong.
 *
 * There is no general way to safely inject a flag into an arbitrary compound shell command — only
 * the caller who wrote it knows which sub-command the flag belongs to. Detecting the ambiguity and
 * reporting it as a real, honest `problems` entry (never silently running it and misreading the
 * result) is this function's whole job.
 *
 * @see PLAN-M8.md P3, P4
 */
const SHELL_METACHARACTERS = /&&|\|\||;|\||`|\$\(|>|</;

export function containsShellChaining(command: string): boolean {
  return SHELL_METACHARACTERS.test(command);
}
