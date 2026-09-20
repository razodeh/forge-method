/**
 * `@forge/engine/run` — `runEngine`, the harness gluing workflow parsing, plan compilation, the
 * scheduler, and dispatch into one runnable entry point (`PLAN-M5.md` P20).
 *
 * @see PLAN-M5.md P20
 */
export { runEngine, type RunEngineContext } from './run-engine.ts';
export { resolveStepCostCeilings, type CostCeilingSource } from './cost-ceilings.ts';
export {
  MAX_RECORDED_UNFINISHED,
  describeBudgetRefusal,
  diagnoseRun,
  type BudgetRefusal,
  type RunFailureReason,
  type RunFailureRecord,
  type UnfinishedCause,
  type UnfinishedStep,
} from './failure.ts';
