/**
 * `@forge/adapter-kit/grants` — `07` §7.2's own fail-closed `ToolGrant` mapping helpers.
 *
 * @see specs/07 §7.2
 * @see PLAN-M4.md P2
 */
export { describeGrant } from './describe.ts';
export { isHardDenylisted } from './denylist.ts';
export { isExecAllowed, SHELL_OPERATOR_PATTERN } from './exec.ts';
export { isHostAllowed } from './network.ts';
