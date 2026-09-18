# Build process records

This directory is FORGE's own build history, not user-facing documentation — see [`docs/`](../docs/)
for that. It exists because this codebase was built using the discipline it describes, and the
record of that process is kept rather than discarded once the code landed.

| File                                       | What it is                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`BUILD-PROMPT.md`](BUILD-PROMPT.md)       | The "gauntlet loop" process itself: how a piece of this codebase is built, reviewed by a fresh critic, judged, and looped until it wins.                                                             |
| [`QUALITY-BAR.md`](QUALITY-BAR.md)         | The rubric every piece is judged against — named exemplars, binary criteria, the floor checks.                                                                                                       |
| [`plans/PLAN-M1.md`–`PLAN-M12.md`](plans/) | The milestone-by-milestone cut of work: every piece, its spec sections, its surface, its acceptance checks, in build order.                                                                          |
| [`GAUNTLET-LOG.md`](GAUNTLET-LOG.md)       | The append-only record of every piece as it was built: what the critic found each round, how it was judged, and the outcome. Large — it's the full history, not a summary.                           |
| [`SPEC-QUESTIONS.md`](SPEC-QUESTIONS.md)   | Every real spec-vs-implementation decision made along the way: a spec silence, an ambiguity, or a deliberate divergence, each recorded with its reasoning rather than left as an undocumented drift. |
| [`BLOCKED-P1b.md`](BLOCKED-P1b.md)         | A real, resolved escalation record — kept as an example of what "stuck after three rounds, escalate rather than guess" actually looks like in this project's own history.                            |

If you're contributing, [`../CONTRIBUTING.md`](../CONTRIBUTING.md) is the entry point; it tells you
when and how to consult these.
