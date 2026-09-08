/**
 * `06` §6.8's own nine-member failure taxonomy, and the retry decision built on it.
 *
 * @see specs/06 §6.8
 * @see specs/21 §21.3
 * @see PLAN-M5.md P16
 */

/**
 * `06` §6.8's own classification table, verbatim: `transient`/`auth`/`budget`/`validation`/
 * `test-failure`/`tool-error`/`timeout`/`policy`/`conflict`. Four of these (`auth`/`budget`/`policy`/
 * `conflict`) never appear in a `StepNodeRetryPolicy.retryOn` list — that field is typed over
 * `RetryableFailureClass` (`@forge/engine/plan`), the table's own narrower five-value retryable subset —
 * matching the table's own "Default handling" column for each (halt, pause, fail immediately, halt).
 */
export type FailureClass =
  | 'transient'
  | 'auth'
  | 'budget'
  | 'validation'
  | 'test-failure'
  | 'tool-error'
  | 'timeout'
  | 'policy'
  | 'conflict';
