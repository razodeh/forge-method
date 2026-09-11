/**
 * `<RunBoard>` — `04` §4.3 S2, "the core screen": a two-pane lane list/detail view, five detail
 * sub-tabs, the interject flow, and the scheduler footer. Composes `<ListPane>` (P3), `<StreamView>`/
 * `<DiffView>` (P4), `<Modal>`/`<QuestionForm>` (P5), `<Pane>`/`<StatusGlyph>` (P2) — the first screen
 * in this milestone to need a real modal (the interject flow), not yet wired into `<AppShell>`'s own
 * screen map (a later integration piece, matching `HomeScreen`'s (P7) identical unwired state).
 *
 * Real design decisions, recorded fully in `SPEC-QUESTIONS.md` Q140:
 *
 * 1. No `RunReadModel` field carries per-lane label/status/transcript/diff/files/checks/prompt, or the
 *    scheduler footer's own aggregate counts, or whether the underlying adapter supports live interject
 *    delivery — none of that has an event-sourced projection anywhere in this codebase yet. All of it is
 *    accepted as explicit, caller-supplied props extending `ScreenProps`, the same pattern `<HomeScreen>`
 *    (P7) already established for its own Project/Health/NextActions facts.
 * 2. `EngineCommand` (`../state/engine-command.ts`) is a fresh, shared type this piece introduces —
 *    every lane key with a real engine-side effect (`f`/`i`/`s`/`R`/`m`/`o`) emits exactly one. `Enter`
 *    (select/inspect) and `d` (jump straight to the Diff tab) are deliberately **not** commands: both
 *    are pure, local view concerns with no real engine-side effect to name, the identical role `v`
 *    (cycling sub-tabs) already, uncontroversially, plays.
 * 3. Lane action keys (`f`/`i`/`s`/`R`/`m`/`o`) and the tab-navigation keys (`v`/`d`) are active only
 *    while the **detail** pane is focused, never the list pane — avoiding the exact Ink
 *    no-exclusive-routing hazard `<AppShell>`'s own `q`-binding saga (P6) already surfaced once:
 *    `<ListPane>`'s own `/` filter-editing mode captures arbitrary free text (including every one of
 *    this screen's own lane-key letters) while the list pane is focused, and Ink's `useInput` has no
 *    concept of "only the topmost/focused consumer sees this key" — every active hook receives the
 *    identical keystroke regardless. Gating this screen's own handler to the detail pane's own focus
 *    closes that collision structurally, without needing to reach into `<ListPane>`'s private filter
 *    state at all.
 * 4. The interject flow re-uses `<QuestionForm>` (P5): pressing `i` opens a single-question `text`
 *    modal; submitting it emits `lane.interject` and closes the modal; `Esc` closes without emitting
 *    anything. Whether the underlying adapter honours live delivery is read from `interjectSupported` (a
 *    caller-supplied fact — `AdapterCapabilities.interject`, `@forge/adapter-kit`, M4 — since
 *    `RunReadModel` carries no adapter-capability field at all); `false` renders an explicit "queued as
 *    an addendum" caveat inside the modal, matching `04` §4.3's own literal "the TUI says so explicitly."
 * 5. `f` is a real, disclosed double-binding while the Transcript tab is shown: `<StreamView>` (P4) owns
 *    its own local `f` (toggling whether its own viewport stays scroll-locked to the newest line), and
 *    this screen's `f` (emitting `lane.follow`) is simultaneously active whenever the detail pane is
 *    focused — both fire from the same keystroke. Deliberately left as-is, not a collision to close:
 *    the two `f`s mean the same real-world thing ("keep showing me the latest") at two different
 *    layers (a local viewport concern vs. a request to the engine), and `<StreamView>`'s own state
 *    change is never itself an `EngineCommand`, so this never violates "exactly one command per lane
 *    key." On every other tab `<StreamView>` isn't mounted at all, so only the command fires.
 * 6. `selectedLaneId` (local state, set by `Enter`) is never trusted directly — `activeLaneId` re-derives
 *    it every render, falling back to `lanes[0]?.id` whenever the stored id no longer names a real lane
 *    in the current `lanes` prop. This closes two real staleness gaps a bare `useState` initializer
 *    cannot self-correct for on its own: a live `lanes` update that prunes the previously-selected lane
 *    (an ordinary "the lane finished and was pruned" read-model transition), and the screen's own first
 *    render happening before any lanes exist yet (`lanes: []`), whose lazy initializer runs once, at
 *    mount, and can never retroactively pick up a lane that appears later. A round-1 critic caught both.
 * 7. The interject `<Modal>` is local `useState`, not pushed through `<AppShell>`'s own real modal
 *    stack (`useAppModalStack`/`ModalEntry.capturesTextInput`, P6) — this screen isn't wired into
 *    `<AppShell>` yet (see point 1), so that stack doesn't exist for it to push onto. Instead, every
 *    `useInput` consumer THIS FILE MOUNTS while the modal can be open is gated `&& !interjectOpen`
 *    directly: `<ListPane>`'s own `focused` prop, this screen's own lane-action hook, and (a round-2
 *    critic's own finding) `<LaneDetailBody>`'s `focused` prop too — the last of which gates whether
 *    `<StreamView>` (P4) keeps its own independent `f`/`j`/`k`/arrow `useInput` live. A round-1 critic
 *    first reproduced the `<ListPane>` half of this (a real double-fire — `Enter`/`j`/`k`/`/` reaching
 *    both `<ListPane>` and the open `<QuestionForm>` — via a future `Tab` changing focus while the
 *    modal stayed open); a round-2 critic, verifying that fix, reproduced the *same class* of leak a
 *    second, more ordinary way: with the fix only covering `<ListPane>`, opening the interject modal
 *    on the Transcript tab left `<StreamView>` still mounted with `focused: true`, so simply typing an
 *    "f", "j", or "k" into the interject message (an entirely ordinary message, no `Tab` required at
 *    all) silently toggled `<StreamView>`'s own scroll-follow state underneath the still-open modal.
 *    Gating every one of this file's own `focused`/`isActive` props on `interjectOpen` directly closes
 *    all three, without depending on `<AppShell>` integration at all. A later integration piece that
 *    wires this screen into `<AppShell>`'s real screen map should still switch this to
 *    `useAppModalStack` with `capturesTextInput: true`, for the same reasons P6's own doc comment
 *    gives — this local workaround is correct standalone but not a substitute for the real stack once
 *    one exists. A round-3 critic, dispatched specifically to check whether a fourth variant of this
 *    same "ungated descendant `useInput`" class was still lurking, exhaustively enumerated every
 *    `useInput` reachable from this screen's own render tree (five real ones: this file's own hook,
 *    `<ListPane>`, `<Modal>`, `<QuestionForm>`, `<StreamView>`; `<DiffView>`/`<Pane>`/`<StatusGlyph>`
 *    have none) and confirmed that class is now genuinely closed — no fourth instance found.
 * 8. That same round-3 critic instead found a real bug in a *different* class: `handleInterjectAnswer`
 *    used to read the live, every-render-re-derived `activeLaneId` at submit time, rather than the lane
 *    the modal was actually opened for. Since the interject flow defers a user's own action (typing a
 *    message) across an arbitrary number of renders before submission, a live `lanes` prop update that
 *    prunes the originally-selected lane *while the modal stays open* silently retargeted an
 *    already-typed message at whichever lane `activeLaneId` had freshly fallen back to — delivering it
 *    to a lane the user never selected it for, with no UI indication the target had changed. **Fixed**:
 *    `interjectLaneId` is a separate, local piece of state, pinned once, at the moment `i` opens the
 *    modal (never re-derived like `activeLaneId`); `handleInterjectAnswer` reads that pinned id, and
 *    additionally no-ops the submit entirely if that specific lane has since vanished from `lanes` —
 *    matching every other lane-action key's own existing `undefined`-lane guard, rather than silently
 *    delivering to a lane never asked for.
 *
 * @see specs/04 §4.3 S2
 * @see PLAN-M9.md P8
 * @see SPEC-QUESTIONS.md Q140
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { DiffView } from '../components/diff-view.tsx';
import { defaultListItemLabel, ListPane } from '../components/list-pane.tsx';
import { Modal } from '../components/modal.tsx';
import { Pane } from '../components/pane.tsx';
import { type Answer, QuestionForm } from '../components/question-form.tsx';
import { StatusGlyph, type StatusState } from '../components/status-glyph.tsx';
import { StreamView } from '../components/stream-view.tsx';
import type { RenderMode } from '../env.ts';
import type { EngineCommand } from '../state/engine-command.ts';

export type LaneBoardStatus = 'running' | 'waiting' | 'merged' | 'failed' | 'blocked' | 'idle';

export interface LaneSummary {
  readonly id: string;
  readonly label: string;
  readonly status: LaneBoardStatus;
}

export type LaneDetailTab = 'transcript' | 'diff' | 'files' | 'checks' | 'prompt';

export interface LaneFileEntry {
  readonly path: string;
  readonly changeSummary: string;
}

export interface LaneCheckEntry {
  readonly name: string;
  readonly status: StatusState;
  readonly detail?: string;
}

export interface LaneDetail {
  readonly id: string;
  readonly headline: string;
  readonly transcript: readonly string[];
  readonly diffPatch: string;
  readonly files: readonly LaneFileEntry[];
  readonly checks: readonly LaneCheckEntry[];
  readonly prompt: string;
}

export interface SchedulerFooter {
  readonly ready: number;
  readonly running: number;
  readonly runningCap: number;
  readonly blocked: number;
  readonly blockedReason?: string;
  readonly mergeQueue: number;
  readonly spentUsd: number;
  readonly budgetCapUsd: number;
}

export interface RunBoardScreenProps extends ScreenProps {
  readonly lanes: readonly LaneSummary[];
  readonly laneDetails: ReadonlyMap<string, LaneDetail>;
  readonly scheduler: SchedulerFooter;
  readonly interjectSupported: boolean;
  readonly onCommand: (command: EngineCommand) => void;
}

const PANE_COUNT = 2;
const LIST_PANE_INDEX = 0;
const DETAIL_PANE_INDEX = 1;
const LIST_HEIGHT = 8;
const TAB_ORDER: readonly LaneDetailTab[] = ['transcript', 'diff', 'files', 'checks', 'prompt'];
const TAB_LABEL: Readonly<Record<LaneDetailTab, string>> = {
  transcript: 'Transcript',
  diff: 'Diff',
  files: 'Files',
  checks: 'Checks',
  prompt: 'Prompt',
};

const LANE_STATUS_GLYPH: Readonly<Record<LaneBoardStatus, StatusState>> = {
  running: 'running',
  waiting: 'waiting',
  merged: 'pass',
  failed: 'fail',
  blocked: 'blocked',
  idle: 'skipped',
};

function nextTab(current: LaneDetailTab): LaneDetailTab {
  const index = TAB_ORDER.indexOf(current);
  return TAB_ORDER[(index + 1) % TAB_ORDER.length] ?? 'transcript';
}

export function formatSchedulerLine(
  scheduler: SchedulerFooter,
  mode: Pick<RenderMode, 'ascii'>,
): string {
  const blockedSuffix = scheduler.blockedReason ? ` (${scheduler.blockedReason})` : '';
  // `04` §4.7's own degradation-mode pass (`PLAN-M9.md` P15) found this function unconditionally used
  // a real Unicode middle dot (`·`) as its own field separator, regardless of `RenderMode.ascii` -- a
  // real, genuine gap this function's own exported, directly-tested status should have caught earlier.
  const sep = mode.ascii ? ' | ' : ' · ';
  return (
    `ready ${String(scheduler.ready)}${sep}` +
    `running ${String(scheduler.running)}/${String(scheduler.runningCap)}${sep}` +
    `blocked ${String(scheduler.blocked)}${blockedSuffix}${sep}` +
    `merge queue ${String(scheduler.mergeQueue)}${sep}` +
    `budget $${scheduler.spentUsd.toFixed(2)}/$${scheduler.budgetCapUsd.toFixed(2)}`
  );
}

function LaneDetailBody({
  detail,
  tab,
  mode,
  focused,
}: {
  readonly detail: LaneDetail | undefined;
  readonly tab: LaneDetailTab;
  readonly mode: ScreenProps['mode'];
  readonly focused: boolean;
}): JSX.Element {
  if (!detail) return <Text dimColor>No lane selected.</Text>;

  if (tab === 'transcript') {
    return <StreamView source={detail.transcript} height={LIST_HEIGHT} focused={focused} />;
  }
  if (tab === 'diff') {
    return <DiffView patch={detail.diffPatch} mode={mode} />;
  }
  if (tab === 'files') {
    return (
      <Box flexDirection="column">
        {detail.files.map((file) => (
          <Text key={file.path}>
            {file.path} {file.changeSummary}
          </Text>
        ))}
      </Box>
    );
  }
  if (tab === 'checks') {
    return (
      <Box flexDirection="column">
        {detail.checks.map((check) => (
          <Text key={check.name}>
            <StatusGlyph state={check.status} mode={mode} /> {check.name}
            {check.detail ? ` ${mode.ascii ? '-' : '—'} ${check.detail}` : ''}
          </Text>
        ))}
      </Box>
    );
  }
  return <Text>{detail.prompt}</Text>;
}

export function RunBoard({
  mode,
  focusedPaneIndex,
  lanes,
  laneDetails,
  scheduler,
  interjectSupported,
  onCommand,
}: RunBoardScreenProps): JSX.Element {
  const focusedPane = focusedPaneIndex % PANE_COUNT;
  const [selectedLaneId, setSelectedLaneId] = useState<string | undefined>(lanes[0]?.id);
  const [activeTab, setActiveTab] = useState<LaneDetailTab>('transcript');
  const [interjectOpen, setInterjectOpen] = useState(false);

  // Re-derived every render, never trusted from state directly: `selectedLaneId` can go stale two
  // ways a plain `useState` initializer/setter pair cannot self-correct for -- a live `lanes` update
  // that removes the previously-selected lane out from under it (a real, ordinary "the lane finished
  // and was pruned" read-model transition), and the reverse, a screen first rendered before any lanes
  // exist yet (`lanes: []`) whose `useState(lanes[0]?.id)` initializer only ever runs once, at mount,
  // so it can never retroactively pick up the first lane once `lanes` later populates. Falling back to
  // `lanes[0]?.id` in both cases -- rather than leaving a stale or permanently-`undefined` id in place
  // -- keeps `selectedLaneId` (and everything downstream of it: `detail`, every lane-action command)
  // always naming a lane that genuinely exists in the current `lanes`, or `undefined` only when `lanes`
  // itself is genuinely empty.
  const activeLaneId =
    selectedLaneId !== undefined && lanes.some((lane) => lane.id === selectedLaneId)
      ? selectedLaneId
      : lanes[0]?.id;

  const detail = activeLaneId === undefined ? undefined : laneDetails.get(activeLaneId);

  // Pinned at the moment `i` opens the modal (below), deliberately never re-derived the way
  // `activeLaneId` is -- the interject flow is the one place in this screen where a user's own action
  // (typing a message) is deferred across an arbitrary number of intervening renders before it is
  // actually submitted. A round-3 critic reproduced directly that using live `activeLaneId` at submit
  // time instead let an ordinary "the previously-selected lane finished and was pruned" prop update,
  // arriving *while the modal was still open*, silently retarget an already-typed, in-flight message
  // at whichever lane `activeLaneId` had newly fallen back to -- delivering it to a lane the user never
  // selected it for, with nothing in the UI ever indicating the target had changed.
  const [interjectLaneId, setInterjectLaneId] = useState<string | undefined>(undefined);

  function handleInterjectAnswer(answer: Answer): void {
    setInterjectOpen(false);
    if (interjectLaneId === undefined || answer.kind !== 'text') return;
    // The pinned lane may itself have been pruned while the modal was open -- never silently deliver
    // to a lane that no longer exists, matching every other lane-action key's own `undefined` guard.
    if (!lanes.some((lane) => lane.id === interjectLaneId)) return;
    onCommand({ type: 'lane.interject', laneId: interjectLaneId, message: answer.value });
  }

  useInput(
    (input) => {
      if (input === 'v') {
        setActiveTab((current) => nextTab(current));
        return;
      }
      if (input === 'd') {
        setActiveTab('diff');
        return;
      }
      if (activeLaneId === undefined) return;
      if (input === 'f') {
        onCommand({ type: 'lane.follow', laneId: activeLaneId });
        return;
      }
      if (input === 'i') {
        setInterjectLaneId(activeLaneId);
        setInterjectOpen(true);
        return;
      }
      if (input === 's') {
        onCommand({ type: 'lane.stop', laneId: activeLaneId });
        return;
      }
      if (input === 'R') {
        onCommand({ type: 'lane.retryStep', laneId: activeLaneId });
        return;
      }
      if (input === 'm') {
        onCommand({ type: 'lane.requestMerge', laneId: activeLaneId });
        return;
      }
      if (input === 'o') {
        onCommand({ type: 'lane.openWorktree', laneId: activeLaneId });
      }
    },
    { isActive: focusedPane === DETAIL_PANE_INDEX && !interjectOpen },
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Lanes" focused={focusedPane === LIST_PANE_INDEX} mode={mode}>
          <ListPane
            items={lanes}
            getId={(lane) => lane.id}
            getFilterText={(lane) => lane.label}
            renderItem={(lane) =>
              defaultListItemLabel(lane.label, LANE_STATUS_GLYPH[lane.status], mode)
            }
            onSelect={(lane) => {
              setSelectedLaneId(lane.id);
            }}
            focused={focusedPane === LIST_PANE_INDEX && !interjectOpen}
            height={LIST_HEIGHT}
          />
        </Pane>
        <Pane
          title={`Lane: ${detail?.headline ?? (mode.ascii ? '-' : '—')} ${mode.ascii ? '-' : '—'} ${TAB_LABEL[activeTab]}`}
          focused={focusedPane === DETAIL_PANE_INDEX}
          mode={mode}
        >
          <LaneDetailBody
            detail={detail}
            tab={activeTab}
            mode={mode}
            focused={focusedPane === DETAIL_PANE_INDEX && !interjectOpen}
          />
        </Pane>
      </Box>
      <Pane title="Scheduler" focused={false} mode={mode}>
        <Text>{formatSchedulerLine(scheduler, mode)}</Text>
      </Pane>
      <Modal
        open={interjectOpen}
        onClose={() => {
          setInterjectOpen(false);
        }}
      >
        <QuestionForm
          questions={[{ id: 'interject', kind: 'text', prompt: 'Message to send into this lane:' }]}
          onAnswer={handleInterjectAnswer}
          focused={interjectOpen}
        />
        {interjectSupported ? undefined : (
          <Text dimColor>
            This adapter cannot deliver a live interject {mode.ascii ? '-' : '—'} your message will
            be queued as an addendum for the next step.
          </Text>
        )}
      </Modal>
    </Box>
  );
}
