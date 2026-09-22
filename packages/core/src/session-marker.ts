/**
 * The FORGE run/step/agent marker — three environment-variable names every engine-spawned adapter
 * session and every run-spawned shell command carries, naming which run, step and (where one exists)
 * agent produced it (`SPEC-QUESTIONS.md` Q232 decision 9, `PLAN-M14.md` P4).
 *
 * This file exports names only, never a value: every call site composes the marker from fields
 * already on `ExecuteStepContext`/`StepNode`/`RunEngineContext` (the run's own `runId`, a step's own
 * `id`, an assembled session's own resolved `AgentDefinition.id`) — never from `process.env` (R10).
 *
 * **What this is not.** A security boundary. `env -u FORGE_RUN_ID` (or any hostile override) defeats
 * it trivially, and real OS-level session confinement is deferred (`20` §20.5, §20.10 S6). What it
 * *is*: a fence for an honest session — the one, cheap signal `forge gate approve`/`waive` (`10` §10.3
 * rule 6, amended in P15) needs to tell "a shell the engine itself spawned" from "a person's own
 * shell," since a real human's own terminal never carries it. `forge debug`'s own REPRODUCE/PROVE
 * children are deliberately never given it (`rca/shell.ts`'s own scrubbed environment) — a model
 * proposing a shell command during RCA must not see, and cannot forge, the marker of the very loop
 * that is about to judge its proposal.
 *
 * @see specs/07 §7.2
 * @see specs/20 §20.5
 * @see specs/20 §20.10
 * @see SPEC-QUESTIONS.md Q232
 * @see PLAN-M14.md P4
 */

/** The run id of the engine run (or `forge debug` loop) that spawned this session/command. */
export const FORGE_RUN_ID = 'FORGE_RUN_ID';

/** The id of the step (a workflow step, or a synthetic one such as a participant session or a debug
 * phase) that spawned this session/command. */
export const FORGE_STEP_ID = 'FORGE_STEP_ID';

/** The id of the agent that spawned this session, when one exists. A run-spawned `command` step
 * carries no agent id, so it never sets this key. */
export const FORGE_AGENT_ID = 'FORGE_AGENT_ID';
