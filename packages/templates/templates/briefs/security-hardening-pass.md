# Security hardening pass

Review what this stage actually built against the threats the project said it must resist, and file
every gap as a defect. You are the adversary here: for each finding state the exploit path, not just
the risk category. A later step fixes what you file, and `G-Stable` will not pass while a Sev1 or
Sev2 defect is open.

## Inputs

This step declares no inputs. Read the `ThreatModel` (under `security/` in the KB), the architecture
spec's component boundaries and trust zones, the data model (what is sensitive), the stage's
security NFRs, the constraints in the KB, the code and configuration the stage added or changed, and
the dependency manifests and lockfiles.

## Method

Take each threat in the threat model and each component boundary the stage touched, and check the
code against it rather than against a generic list. Cover, where they apply to this stage:

- authentication and authorisation on every entry point, including object-level access checks, not
  only the presence of a login;
- validation and encoding of every input that crosses a trust boundary, and injection paths (query,
  command, template, path, deserialisation);
- secrets: none in code, config, logs, fixtures or error messages, and each referenced by name;
- data protection: sensitive data encrypted where the threat model requires, excluded from logs, and
  retained only as the data-lifecycle decisions allow;
- supply chain: dependency versions, known advisories, unpinned or unreviewed additions, and build
  steps that fetch code at build time;
- error handling that leaks internals, and failure modes that fail open instead of closed.

For each threat class say what you checked and how. A class with no finding needs one line in your
final summary saying what was examined, so absence of a defect is distinguishable from absence of a
review. A class you could not examine (no access to run or read what is needed) is recorded as an
`OpenQuestion` with status `open` naming what is missing, so the stage cannot pass on an unexamined
threat; raise it with `FORGE_ASK:` if you cannot write that register.

## Produce

`Defect` records, one per distinct finding (many, possibly none), in the standard front matter with
`status: open` (the gate counts only that literal value as open, so a finding must start there):

- `observed` is what the code does and `expected` is what the threat model or NFR requires;
- `evidence` names the file and line, the command or request that shows it (given as a command for
  someone to run if you cannot run it yourself), and the threat it relates to;
- `first_seen`, `frequency` and `environment`: the date, whether the issue is always present, and
  where it applies;
- `affected` lists the stories or capabilities;
- `severity` reflects real exploitability and impact; no spec fixes the scale, so follow any
  severity policy in the KB's `constraints/**` first and treat the guidance here as a heuristic.
  Sev1 and Sev2 block `G-Stable`, so use them for findings you can show are exploitable or expose or
  corrupt sensitive data, and for a missing mitigation the threat model marks as required. Use Sev3
  and Sev4 for hardening gaps you could not exploit. Do not inflate to get attention or deflate to
  get past the gate, and give the reason for each.

## Do not

- Do not fix anything, and do not change code, configuration or tests.
- Do not report a finding you cannot point to in the code or configuration, and do not report
  generic advice unrelated to what was built.
- Do not include a working exploit payload beyond what is needed to show the issue, and never write
  a real secret value into a Defect.
