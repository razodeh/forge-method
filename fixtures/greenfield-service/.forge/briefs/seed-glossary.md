<!-- forge:generated v=0.0.0 hash=512085ba3f3f1d76f8394d88d941f17c8012a8e8e7cd5d3411ba210aa0dba8b0 — edits will be overwritten; use overrides/ -->
Seed the project glossary with the domain terms the idea and constraints already use, so every later
artifact starts from one shared vocabulary. This is a seed: define only what the inputs support, and
record every meaning you had to infer as an assumption.

### Inputs

- The `elicit-idea` answers (`ideaSummary`, `greenfield`) and the confirmed level from
  `confirm-level`.
- The `level-proposal` handoff from `propose-level`, for its signals and open questions.
- The KB constraints (`constraints/**`) and, if it already exists, the current `glossary.md`.

### What to produce

- The glossary at `docs/forge/kb/glossary.md`, a KB entry (`type: glossary`, `section: glossary`).
  Extend an existing file in place and keep its existing definitions. Its body follows the KB entry
  format (`## Statement`, `## Rationale`, `## Implications`), and the terms are a bullet list, one
  line per term: `- **Term** — definition (source)`. The entry's `sources` list is required; each
  item is `kind: human` with a `ref` naming the elicitation answer or constraint file the terms came
  from.
- One `Assumption` entry (in `kb/assumptions.md`) for each definition that you inferred instead of
  reading. Each carries `text`, `confidence` (low, medium or high) and `validate_by`, stating who or
  what can confirm the meaning.

### How to choose terms

- Take every domain noun and verb in `ideaSummary` and in the constraints that a newcomer could
  reasonably misread: roles ("user", "customer", "admin"), the core object being managed, states,
  and any word used with a special meaning.
- Where the inputs use two words for one concept, pick one canonical term, define it, and list the
  other under "also called" on the same line. Later specs should use the canonical term.
- Where one word could mean two things, define it narrowly and record the ambiguity as an
  assumption.
- Skip general programming and business vocabulary. A term earns an entry only if two agents could
  plausibly use it differently.

### Acceptance criteria

- Every term is written in bold exactly once. The KB linter reads the bold spans in `glossary.md` to
  decide which backticked terms in later specs are defined, so a term that is not bold here will be
  reported as drift.
- Every definition is one or two sentences, does not use its own term, and states its source: the
  idea summary, a named constraint file, or `assumption ASM-###`.
- Every term you inferred has a matching `Assumption` entry.
- Existing definitions are unchanged.

### Do not

- Do not define terms for capabilities, components or technologies that nobody has proposed yet.
- Do not copy dictionary definitions. A definition states what the word means in this project.
- Do not include personas, requirements or design decisions. Those belong to discovery and later
  phases.
