/**
 * `<HomeScreen>` — `04` §4.3 S1, "what is the state of this product, and what should I do next?" Four
 * panes verbatim: Project, Next actions, Health, Recent activity.
 *
 * None of Project (name/level/platform/stages/autonomy), Health (KB entry/stale/contradiction counts,
 * Specs epic/story/orphan/traceability counts, Build pass/coverage, per-gate status), or a candidate
 * list for Next actions exist anywhere in `RunReadModel` (P1) or in `@forge/telemetry`'s own real
 * `EventType` catalogue today -- confirmed directly (no "project info", "specs health", or "build
 * health" event exists, and the handful that plausibly relate -- `GateEvaluated`/`GateApproved`/
 * `GateRejected`/`GateWaived`, `KbContradictionDetected` -- would need real payload schemas this
 * milestone does not own to fold into `reduceRun`). Rather than inventing event payload shapes this
 * package has no authority over, this screen accepts `project`/`health`/`nextActionCandidates`/
 * `recentActivity` as explicit, caller-supplied props extending `<AppShell>`'s own `ScreenProps` --
 * the identical "a caller supplies the real, external fact this package cannot derive itself" pattern
 * `<AppShell>` (M9 P6) already established for `productName`/`stageLabel`/`budgetCapUsd`/`elapsedMs`.
 * `<AppShell>`'s own `ScreenComponent` contract is unaffected: whoever registers this screen in a real
 * `screens` map closes over the extra data in a small adapter function, exactly how a real app is
 * already expected to close over per-screen data it alone knows how to produce.
 *
 * `rankNextActions` is a pure, exported, unit-testable function, independent of rendering -- `04` §4.3's
 * own literal four-factor precedence (blocking-ness → gate readiness → cheapest-unblock → user's
 * declared goal), confirmed by a dedicated research pass to have no existing, reusable implementation
 * anywhere in this codebase: `packages/cli/src/commands/help.ts`'s own `helpRecommendNext` is a
 * fundamentally different shape (a single-decision tree returning one recommendation, never a ranked
 * list over multiple candidates) and cannot be adapted without a rewrite; `@forge/engine/scheduler`'s
 * own `orderReadyNodes` is the closest *structural* precedent (a multi-level tiebreak comparator over a
 * candidate list) but is typed to plan `StepNode`s, with no "declared goal" factor at all. Recorded in
 * `SPEC-QUESTIONS.md` Q139.
 *
 * The 8 real `RunStatus` values (`state/run-read-model.ts`) are mapped onto `04` §4.8's own 6 canonical
 * screen states for the snapshot-test matrix that Check requires: `undefined` → empty, `'planned'` →
 * loading, `'started'`/`'resumed'` → running, `'paused'` → blocked (a paused run is, in the ordinary
 * case, blocked on a human decision -- the same real-world shape §4.4's own Gate-review/Assumption modal
 * flows describe), `'failed'`/`'aborted'` → failed, `'completed'` → complete. This mapping is this
 * screen's own design decision, not dictated anywhere in `04` itself. It is rendered, not merely
 * computed for the test matrix's own sake: a real "Run:" status line in the Project pane, via
 * `<StatusGlyph>` -- S1's own purpose is literally "what is the state of this product," so a screen
 * that computed this mapping without ever showing it would have satisfied the Check's letter while
 * missing its point entirely.
 *
 * @see specs/04 §4.3 S1, §4.8
 * @see PLAN-M9.md P7
 */
import { Box, Text } from 'ink';
import type { JSX } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { KeyValue } from '../components/key-value.tsx';
import { ListPane } from '../components/list-pane.tsx';
import { Pane } from '../components/pane.tsx';
import { StatusGlyph, type StatusState } from '../components/status-glyph.tsx';
import type { RunStatus } from '../state/run-read-model.ts';

export interface ProjectInfo {
  readonly name: string;
  readonly level: string;
  readonly platform: string;
  readonly stages: readonly string[];
  readonly currentStageIndex: number;
  readonly autonomy: string;
}

export interface HealthKbRow {
  readonly entries: number;
  readonly stale: number;
  readonly contradictions: number;
}

export interface HealthSpecsRow {
  readonly epics: number;
  readonly stories: number;
  readonly orphanStories: number;
  readonly traceabilityPct: number;
}

export interface HealthBuildRow {
  readonly passing: boolean;
  readonly lastRunAgo: string;
  readonly testsPassed: number;
  readonly testsTotal: number;
  readonly coveragePct: number;
}

export interface HealthGateRow {
  readonly gateId: string;
  /** `undefined` renders as `—`: the gate has no status yet (not this stage's own concern), the one
   * real case outside `StatusGlyph`'s own fixed 8-state vocabulary -- handled here, not by extending
   * that component's own established, literal inventory. */
  readonly status: StatusState | undefined;
}

export interface HealthSummary {
  readonly kb: HealthKbRow;
  readonly specs: HealthSpecsRow;
  readonly build: HealthBuildRow;
  readonly gates: readonly HealthGateRow[];
}

export interface NextActionCandidate {
  readonly id: string;
  readonly description: string;
  readonly command: string;
  readonly isBlocking: boolean;
  readonly gateReady: boolean;
  readonly unblockCost: number;
  readonly matchesDeclaredGoal: boolean;
}

export interface ActivityEntry {
  readonly id: string;
  readonly timeLabel: string;
  readonly actor: string;
  readonly message: string;
}

/** A non-finite `unblockCost` (`NaN`, caller-computed via a formula that can divide by zero or subtract
 * infinities -- entirely plausible for a real "cheapest unblock" heuristic) is treated as the worst
 * possible cost, never compared as-is -- a fresh critic round reproduced directly that comparing two
 * `NaN`s (or a `NaN` against a normal number) via plain subtraction returns `NaN`, which
 * `Array.prototype.sort` silently treats as "no swap," breaking the comparator's own consistency
 * contract: the same *set* of candidates, given to `rankNextActions` in a different starting array
 * order, produced a genuinely different (and non-canonical) ranking, contradicting this function's own
 * "two otherwise-identical candidates never swap order between renders" guarantee. The same
 * "never trust a caller-supplied cost/amount without a finite-number guard" discipline
 * `run-read-model.ts`'s own `extractCostUsd`/`isFiniteNonNegativeNumber` already establishes in this
 * same package. */
function safeUnblockCost(cost: number): number {
  return Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}

/** `04` §4.3's own literal four-factor precedence, in order: blocking-ness, then gate readiness, then
 * cheapest-unblock (lower `unblockCost` first), then the user's declared goal -- a stable `id` compare
 * as the final tiebreak so two otherwise-identical candidates never swap order between renders. */
export function rankNextActions(
  candidates: readonly NextActionCandidate[],
): readonly NextActionCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.isBlocking !== b.isBlocking) return a.isBlocking ? -1 : 1;
    if (a.gateReady !== b.gateReady) return a.gateReady ? -1 : 1;
    const costA = safeUnblockCost(a.unblockCost);
    const costB = safeUnblockCost(b.unblockCost);
    if (costA !== costB) return costA - costB;
    if (a.matchesDeclaredGoal !== b.matchesDeclaredGoal) return a.matchesDeclaredGoal ? -1 : 1;
    // A plain ordinal compare, not `localeCompare` -- R10 forbids the latter's own implicit,
    // host-environment-dependent default locale; ids are caller-supplied identifiers, not
    // human-facing text a locale-aware sort would ever need to get right.
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export interface HomeScreenProps extends ScreenProps {
  readonly project: ProjectInfo;
  readonly health: HealthSummary;
  readonly nextActionCandidates: readonly NextActionCandidate[];
  readonly recentActivity: readonly ActivityEntry[];
}

const PANE_COUNT = 4;

function kbStatus(kb: HealthKbRow): StatusState {
  if (kb.contradictions > 0) return 'fail';
  if (kb.stale > 0) return 'warn';
  return 'pass';
}

function specsStatus(specs: HealthSpecsRow): StatusState {
  return specs.orphanStories > 0 ? 'warn' : 'pass';
}

function buildStatus(build: HealthBuildRow): StatusState {
  return build.passing ? 'pass' : 'fail';
}

export type CanonicalScreenState =
  'empty' | 'loading' | 'running' | 'blocked' | 'failed' | 'complete';

const RUN_STATE_GLYPH: Readonly<Record<CanonicalScreenState, StatusState>> = {
  empty: 'skipped',
  loading: 'waiting',
  running: 'running',
  blocked: 'blocked',
  failed: 'fail',
  complete: 'pass',
};

const RUN_STATE_LABEL: Readonly<Record<CanonicalScreenState, string>> = {
  empty: 'no active run',
  loading: 'plan created, not yet started',
  running: 'running',
  blocked: 'blocked, waiting on human input',
  failed: 'failed',
  complete: 'complete',
};

/** See this file's own top doc comment for the mapping's own rationale. */
export function canonicalStateFor(runStatus: RunStatus): CanonicalScreenState {
  switch (runStatus) {
    case undefined:
      return 'empty';
    case 'planned':
      return 'loading';
    case 'started':
    case 'resumed':
      return 'running';
    case 'paused':
      return 'blocked';
    case 'failed':
    case 'aborted':
      return 'failed';
    case 'completed':
      return 'complete';
  }
}

export function HomeScreen({
  mode,
  readModel,
  focusedPaneIndex,
  project,
  health,
  nextActionCandidates,
  recentActivity,
}: HomeScreenProps): JSX.Element {
  const focusedPane = focusedPaneIndex % PANE_COUNT;
  const rankedActions = rankNextActions(nextActionCandidates);
  const canonicalState = canonicalStateFor(readModel.runStatus);

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Project" focused={focusedPane === 0} mode={mode}>
          <KeyValue
            rows={[
              { key: project.name, value: `Level ${project.level}` },
              { key: 'Platform', value: project.platform },
              {
                key: 'Stages',
                value: project.stages
                  .map((stage, index) =>
                    index === project.currentStageIndex ? `[${stage}]` : stage,
                  )
                  .join(mode.ascii ? ' > ' : ' ▸ '),
              },
              { key: 'Autonomy', value: project.autonomy },
            ]}
          />
          <Text>
            Run <StatusGlyph state={RUN_STATE_GLYPH[canonicalState]} mode={mode} />{' '}
            {RUN_STATE_LABEL[canonicalState]}
          </Text>
        </Pane>
        <Pane title="Next actions" focused={focusedPane === 1} mode={mode}>
          <Box flexDirection="column">
            {rankedActions.map((action) => (
              <Box key={action.id} flexDirection="column">
                <Text>
                  {mode.ascii ? '>' : '▸'} {action.description}
                </Text>
                <Text dimColor> Run: {action.command}</Text>
              </Box>
            ))}
          </Box>
        </Pane>
      </Box>
      <Pane title="Health" focused={focusedPane === 2} mode={mode}>
        <Box flexDirection="column">
          <Text>
            KB <StatusGlyph state={kbStatus(health.kb)} mode={mode} /> {health.kb.entries} entries
            {health.kb.stale > 0 ? `, ${String(health.kb.stale)} stale` : ''}
            {health.kb.contradictions > 0
              ? `, ${String(health.kb.contradictions)} contradiction(s)`
              : ''}
          </Text>
          <Text>
            Specs <StatusGlyph state={specsStatus(health.specs)} mode={mode} /> {health.specs.epics}{' '}
            epics {health.specs.stories} stories
            {health.specs.orphanStories > 0
              ? `, ${String(health.specs.orphanStories)} orphan stories`
              : ''}
            , traceability {health.specs.traceabilityPct}%
          </Text>
          <Text>
            Build <StatusGlyph state={buildStatus(health.build)} mode={mode} /> (
            {health.build.lastRunAgo}) Tests {health.build.testsPassed}/{health.build.testsTotal}{' '}
            Coverage {health.build.coveragePct}%
          </Text>
          <Text>
            Gates{' '}
            {health.gates.map((gate, index) => (
              <Text key={gate.gateId}>
                {index > 0 ? '  ' : ''}
                {gate.gateId}{' '}
                {gate.status === undefined ? (
                  mode.ascii ? (
                    '-'
                  ) : (
                    '—'
                  )
                ) : (
                  <StatusGlyph state={gate.status} mode={mode} />
                )}
              </Text>
            ))}
          </Text>
        </Box>
      </Pane>
      <Pane title="Recent activity" focused={focusedPane === 3} mode={mode}>
        <ListPane
          items={recentActivity}
          getId={(entry) => entry.id}
          getFilterText={(entry) => `${entry.actor} ${entry.message}`}
          renderItem={(entry) => (
            <Text>
              {entry.timeLabel} {entry.actor} {entry.message}
            </Text>
          )}
          focused={focusedPane === 3}
          height={6}
        />
      </Pane>
    </Box>
  );
}
