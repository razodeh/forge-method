Work out how this project's tests actually run, prove it, and report a configuration — never a
guess, and never a value you have not personally watched run. FORGE does not trust anything you
report: every claim below is re-checked deterministically (the translator proof, `13` F-TEST-11)
before a human ever sees it, and only a human's approval at `G-TestAdopt` lets it reach the live
configuration. Treat this as an investigation with evidence, not a form to fill in from a guess.

### Inputs

- The project's own manifests (`package.json` scripts and `devDependencies`, `pyproject.toml`,
  `setup.cfg`, `tox.ini`, `requirements*.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`,
  `*.csproj`, `Gemfile`, `composer.json`), its `Makefile`, its CI configuration
  (`.github/workflows/**`, `.gitlab-ci.yml`, and equivalents) and its own documentation
  (`README.md`, `CONTRIBUTING.md`, anything under `docs/`).
- If the project has an in-house test runner (its own script or small framework rather than a
  published one), that runner's own source: read it before guessing at its output shape.
- Whatever the deterministic detector already found, when this run was a hand-off rather than a
  fresh request — it names the ecosystem it recognised and, in its own words, why it could not
  settle the configuration on its own.
- On a retry round, the PREVIOUS round's translator-proof result: the one check that failed, by
  number, and why. Revise the actual cause, not a cosmetic change near it.

### Investigate, then run it for real

1. Identify which framework or in-house tool runs the tests, which exact command, and which layer
   (this run only ever targets `unit`). State the evidence: the script name, the CI step, the
   manifest line — never "it looks like" with nothing backing it.
2. Run the command you are about to propose, for real, in your own granted lane, and read its real
   stdout, any report file it writes, and its real exit code. Do this at least twice: once against
   the project as it stands, and once with a single, deliberately failing test you add yourself (in
   the runner's own idiom, placed at a BRAND-NEW path its own discovery will find — never appended
   to, or replacing any part of, a file that already existed) — removed again before you finish. You
   must see a real failure before you can claim your parsing of one is correct; a configuration
   proposed from only a passing run is not acceptable. Report this exact path and content as your
   final `probe` (the bullet under "Produce the configuration" below) — never a different one you
   did not personally watch run, and never the project's own pre-existing file even if editing it
   felt like the natural place for this check: FORGE replays this exact probe later, for real, in
   the real project tree, and a brand-new path is the one thing that keeps that replay from ever
   overwriting something real (see that bullet for why). When the runner's own real invocation is
   not already one of your granted patterns (point 3, and "Produce the configuration" below), you
   cannot run it directly even at this investigation stage — write the translator first, then run
   and observe THAT, since it is the real command you will ultimately propose.
3. Only the commands a real test-adoption investigation plausibly needs are available to you, live
   (see your own granted tool list) — conventional invocations across ecosystems, plus read-only
   search. This is not a narrower courtesy for investigation alone: your FINAL proposed `run` (and
   `translate`/`scope`/`filter`, whenever you give them) are re-checked against this identical list
   before FORGE ever executes them for real, unattended, on every future test run — a command
   refused live is refused in your final report too, and vice versa. When the project's real test
   command is not already one of these conventional shapes (a genuinely bespoke, in-house runner,
   most commonly), that is not a gap to disclose in `reason` and stop at — see "Produce the
   configuration" below for the one shape that lets you propose a working command for it anyway.
   Reserve disclosing a gap in `reason` for what genuinely has no such path, such as a runner that
   supports neither a single-file nor a single-test invocation at all (the `scope`/`filter` case
   below).

### Produce the configuration

Two genuinely different shapes, depending on whether the runner's own real invocation is already one
of your granted conventional patterns (`pytest`, `go test`, `npm test`, and so on — point 3, above)
or not. Telling them apart correctly matters: proposing the wrong shape for a bespoke runner cannot
ever pass, no matter how good the investigation behind it was.

Whichever shape applies, `run` and `translate` (when you give one) are each a single, plain program
invocation — never a shell pipeline, a chained sequence, or anything else built from more than one
command joined together. `;`/`&`/`|`/`` ` ``/`<`/`>`/`$(...)`/a newline anywhere in either string
refuses it outright, unconditionally, no matter what is on either side of it — FORGE checks the
literal text, not what the shell would do with it. If connecting two commands' own output feels like
the natural shape, that connection belongs INSIDE a script's own code (a real function call, not a
shell operator), never in the command text you report.

- **Conventional invocation, conventional output.** If the runner's own real invocation is already
  one of your granted patterns AND its output already fits one of FORGE's built-in formats
  (`junit-xml`, `tap`, `forge-json`, `vitest-json`, `jest-json`, `go-test-json`), propose `run` as
  that invocation directly — no translator needed.
- **Conventional invocation, unfamiliar output.** If the runner's own real invocation is already one
  of your granted patterns but its output does not fit a built-in format, propose `run` as that same
  real invocation, and write a translator script, committed to the project at exactly
  `.forge/test-translators/<layer>.<ext>` (Node by default, or the project's own language when that
  reads the output more naturally), that reads the raw output `run` produced — from stdout, or from
  the `{output}` path your proposed command names — and prints `forge-json` (`forge-test-report`) in
  its place. Propose it as a SEPARATE `translate` field alongside `run`: `run` still executes the
  real invocation first; `translate` only reformats what it produced.
- **Bespoke invocation (an in-house runner with no conventional entrypoint).** If the runner's own
  real invocation is NOT already one of your granted patterns — a hand-rolled `node runner.js`, a
  one-off shell script, and so on — you can never propose that raw invocation as `run` directly: it
  will always be refused, regardless of how well you investigated it, because FORGE never
  re-executes an unreviewed command unattended. The only move that can pass is to write a translator
  script, committed to the project at exactly `.forge/test-translators/<layer>.<ext>`, that is
  SELF-CONTAINED: it invokes the real runner itself, internally, using that script's own language's
  real process-spawning facility (Node's `child_process`, Python's `subprocess`, Ruby's `Open3`,
  PHP's `proc_open`, and so on) — a real function call made FROM INSIDE the script's own code, never
  a shell pipe in the command text you register — reads the real runner's real raw output, and
  prints `forge-json` (`forge-test-report`) in its place — on stdout, or to the `{output}` path your
  proposed command names. Propose THAT script's own path as `run` directly. Do NOT also declare a
  separate `translate` field in this case: there is no raw, conventional `run` left for it to
  post-process — the translator already is `run`, and it is the only thing that ever invokes the
  real runner.

  **Worked example.** Say `package.json` has `"scripts": { "test": "node runner.js" }`, and
  `runner.js` is a small, in-house script with no published framework behind it, printing lines such
  as `PASS src/foo.test.js::adds numbers` and `FAIL src/bar.test.js::handles empty input` to stdout.
  `node runner.js` matches none of your granted patterns, so it can never be `run`. Instead, write
  `.forge/test-translators/unit.js`, something like:

  ```js
  const { execFileSync } = require('node:child_process');
  const raw = execFileSync('node', ['runner.js'], { encoding: 'utf8' });
  // ... parse `raw` into forge-json's own report shape ...
  process.stdout.write(JSON.stringify(report));
  ```

  and then propose
  `command: { "run": "node .forge/test-translators/unit.js", "output": { "source": "stdout" }, "format": "forge-json" }`
  with `translatorPath: ".forge/test-translators/unit.js"` and no `translate` field at all. This is
  also why you cannot run the raw `node runner.js` directly even during investigation (point 2,
  above): write the wrapper first, then run and observe THAT script, the same real command you go on
  to propose.

  **What this is NOT — a real mistake, not a hypothetical one.** Do NOT propose `run` as a shell
  PIPE joining the raw invocation to the translator, however natural that may look:

  ```
  run: "node runner.js | node .forge/test-translators/unit.js"
  ```

  This is refused outright, every time, regardless of what sits on either side of the `|`: FORGE's
  own vet refuses ANY `;`/`&`/`|`/`` ` ``/`<`/`>`/`$(`/newline anywhere in the registered `run` TEXT
  ITSELF, unconditionally, before it ever asks whether either side alone would otherwise be allowed
  — a plain character check on the whole string, not a parse of what the pipe would do. "The
  translator invokes the real runner internally" means exactly that: a spawn call written INSIDE the
  translator SCRIPT's own source code (the `execFileSync` line in the worked example above) — never
  a shell operator in the command text FORGE itself re-executes. If you find yourself writing a `|`,
  `&&`, backtick, or `$(...)` anywhere in the `run` you are about to report, you have the wrong
  shape: move whatever is on the piped-from side into a real function call inside the translator
  script instead, and register only the translator's own bare path as `run`.

- Either way, the translator you write (one per round, at most) is the ONLY file you may write. Do
  not edit, move or delete anything else, and do not run `git add`, `git commit` or any command that
  is not one of your granted test/investigation invocations.
- Name `scope`/`filter` templates when the runner genuinely supports running one file or one named
  test (`{files}`/`{name}`/`{name:regex}`); state plainly, in your reason, which of the two (if any)
  the runner does not support — never invent a template the runner cannot actually honour.
- Describe the injected-failure probe you used: its exact file path, its exact content (so FORGE can
  recreate it for the deterministic proof), the exact test name the report must carry it under, and
  — only if this format attributes files at all — the exact file it must be reported under. The
  `path` you report here is a BRAND-NEW path, the same one step 2 already had you use for the live
  check itself — one that did not already exist anywhere in the project before you created it, and
  never a file that was already there (not even one you considered editing-then-reverting instead).
  Before you pick it, confirm it is actually free: you already listed the project's own files
  earlier in your investigation, or can with a granted read-only command, so check rather than
  assume. FORGE recreates this exact probe later by writing your reported `content` to your reported
  `path` directly in the real project tree, not a copy, to independently re-confirm the failure;
  writing that over a real, pre-existing file would silently destroy its real content, so FORGE
  refuses outright rather than risk it (`RUN-158`) — a real mistake, not a hypothetical one:
  reporting the project's one existing spec file as the probe, because editing it felt like the
  natural place for this check, has already happened and is refused every time, however carefully it
  was reverted afterward. A sibling file in whatever directory the runner's own discovery already
  scans (the Worked Example above shows one such layout) satisfies "somewhere its own discovery will
  find it" just as well as an existing file would, without the risk.

### When there is no test setup at all

Determine the stack (from the manifest and source files present) and propose a conventional,
zero-drama runner for it — vitest for a plain Node/TypeScript project, pytest for Python, `go test`
for Go, and so on. Report it the same way as any other proposal (a real `command`), plus a short ADR
summary: what you found (or did not find), the runner you propose, the one alternative you
considered and why it lost, and the exact dependency this would add. Never install anything
yourself, never write a lockfile change, and never write a test file of your own into the project —
this is a reviewable proposal a human adopts, not a change you make silently.

### Report back

Report your findings as the structured result this session asks for — never only as prose. Either:

- `{ "command": {...}, "probe": {...}, "translatorPath": "...", "runnerVersion": "...", "reason": "..." }`
  — `command` is the exact `run`/`output`/`format` (and `translate`/`scope`/`filter` where real) you
  propose; `translatorPath` is present only when you wrote a translator; `runnerVersion` is the real
  version you observed (e.g. from the runner's own `--version`); `reason` states the evidence for
  everything above, in your own words. `translate` is only ever present alongside a `run` that is
  itself a conventional, already-granted invocation — never alongside a `run` that is your own
  translator script (see "Produce the configuration" above).
- `{ "noTestsFound": true, "command": {...}, "adrSummary": "...", "reason": "..." }` — for a project
  with no test setup: `command` is the conventional runner you propose, `adrSummary` is the ADR body
  described above.

Register your proposal with one `HandoffRecord` entry (`from: test-architect`, `to: human`,
`step: propose → verify-proof`). The entry has no `subtype` key, so the first string in `delivered`
is `subtype: adopt-tests-proposal`, and the second names the layer.

A round whose proof fails returns here with the failing check named; revise that specific cause and
report again. After the bound, FORGE stops asking and discloses the last failure instead of looping
forever.

### Acceptance criteria

- Every claim about how the tests run is backed by something you actually read or actually ran —
  never inferred from a file's name alone.
- You have personally seen the proposed command fail (the injected probe) as well as pass.
- The `probe.path` you report is a brand-new path you created and confirmed was free beforehand —
  never a file that already existed anywhere in the project, however natural editing one might have
  felt.
- The translator, if you wrote one, lives at exactly `.forge/test-translators/<layer>.<ext>` and
  nowhere else changed.
- `scope`/`filter` are named only when the runner genuinely supports them; you said plainly when it
  does not.
- When the runner's own invocation is not already one of your granted patterns, `run` is the
  self-contained translator's own path, with no separate `translate` field alongside it.
- Neither `run` nor `translate` is ever a shell pipe or any other chained/composed command — each is
  one plain program invocation.
- A no-test-setup project gets a proposal and an ADR summary, never an installed dependency.

### Do not

- Do not propose a command you have not personally run.
- Do not claim a `scope`/`filter` template the runner cannot really honour.
- Do not write, move or delete anything outside `.forge/test-translators/<layer>.<ext>`, except the
  one brand-new probe file step 2 already has you create, observe, and remove again before you
  finish — never an edit to a file that already existed (same section).
- Do not propose `run` as the runner's raw invocation when it is not already one of your granted
  patterns, and do not pair a self-contained translator `run` with a separate `translate` field —
  neither shape can pass ("Produce the configuration" above).
- Do not propose `run` as a shell pipe, or any other use of `;`/`&`/`|`/`` ` ``/`<`/`>`/`$(...)`,
  joining the raw invocation to the translator (or anything else) — refused unconditionally,
  whatever sits on either side of the operator. Put the real runner's invocation inside the
  translator script's own code instead ("Produce the configuration" above).
- Do not install a dependency, change a lockfile, or write a test of your own into the project when
  there is no test setup — report the proposal, never apply it yourself.
