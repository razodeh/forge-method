/**
 * `<SessionsScreen>` — `04` §4.3 S6: the facilitated-discussion list + live-session transcript/
 * technique-step-indicator/input view (`16`'s own facilitated discussions). Composes `<ListPane>` (P3),
 * `<StreamView>` (P4), `<Modal>`/`<QuestionForm>` (P5).
 *
 * Real design decisions, recorded fully in `SPEC-QUESTIONS.md` Q144:
 *
 * 1. **`@forge/sessions` (M10) does not exist in this codebase yet — confirmed directly** (no such
 *    package under `packages/`). `PLAN-M9.md` P12's own text names this a real, disclosed forward
 *    dependency: the technique/step indicator renders against a plain, typed `SessionProgress
 *    { technique, step, total }` shape this file defines independently, never blocked on M10 — whatever
 *    `@forge/sessions` eventually emits is expected to satisfy this same shape, or a later piece adapts
 *    between the two; this screen makes no assumption about `@forge/sessions`'s own real API at all.
 * 2. No `RunReadModel` field carries session state either — the caller-supplied-fact pattern every
 *    prior S-screen this milestone already established.
 * 3. **The list's own "start new" row is a real, synthetic sentinel entry** (`START_NEW_SESSION_ID`),
 *    not a real `SessionSummary` — selecting it emits `session.start` instead of navigating into it as
 *    a live session, the identical shape a caller-emitted "create" affordance takes everywhere else a
 *    `<ListPane>` needs one in this codebase (no dedicated "new item" prop exists on `<ListPane>` itself
 *    to special-case this more cleanly without inventing one, an out-of-scope change for this piece).
 * 4. **The free-text contribution box re-uses `<QuestionForm>` (P5) inside a `<Modal>`, exactly like**
 *    **`<RunBoard>` (P8)'s own interject flow, `<KbScreen>` (P10)'s own search, and `<GatesScreen>`**
 *    **(P11)'s own waive-reason flow** — not a bespoke always-capturing raw input line. `04`'s own mockup
 *    renders the input box as part of the live transcript pane, but Ink's own `useInput` has no
 *    "only the topmost/focused consumer sees this key" routing (this milestone's own repeatedly-
 *    rediscovered hazard, `<AppShell>`'s `q`-binding saga first, `<RunBoard>`'s interject saga second):
 *    an always-capturing raw text line would collide with every one of `[space]`/`c`/`s`/`Esc`'s own
 *    single-key bindings the instant the user typed any of those literal characters into a real
 *    contribution. The modal flow reuses already-hardened machinery instead of re-deriving that same
 *    lesson a fourth time. `Enter` opens the modal (gated to a live session with focus, not a command
 *    itself); submitting emits `session.contribute`.
 * 5. `[space]`/`c`/`s`/`Esc` (advance step/converge/save-to-KB/end) are real, unconfirmed,
 *    single-keystroke commands, each active only against a live session (one with a real `progress`) —
 *    `04`'s own mockup key legend lists all four at the same level with no confirmation step for any.
 * 6. **A round-1 critic found `<StreamView>`'s own `focused` prop was hardcoded `false`, unconditionally**
 *    — unlike every other consumer in this file, which correctly derives it from `focusedPane`/
 *    `contributeOpen`. Since `<StreamView>` (P4)'s own `f`/`j`/`k`/arrow scroll-follow `useInput` is
 *    gated on `focused`, that hook never activated at all: `following` started (and stayed) `true`
 *    forever, so a real, longer transcript's own earlier turns were permanently unreachable — no way to
 *    ever scroll up, for the life of the component. Not a disclosed scope cut (unlike `<RunBoard>`
 *    (P8)'s own deliberate `f` double-binding, a real, different situation): this screen owns no `f`
 *    key of its own to collide with, so there was no reason for this. **Fixed:** `focused` now derives
 *    the same way every other consumer here does —
 *    `focusedPane === DETAIL_PANE_INDEX && !contributeOpen`.
 *
 * @see specs/04 §4.3 S6
 * @see specs/16
 * @see PLAN-M9.md P12
 * @see SPEC-QUESTIONS.md Q144
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { defaultListItemLabel, ListPane } from '../components/list-pane.tsx';
import { Modal } from '../components/modal.tsx';
import { Pane } from '../components/pane.tsx';
import { type Answer, QuestionForm } from '../components/question-form.tsx';
import { StreamView } from '../components/stream-view.tsx';
import type { EngineCommand } from '../state/engine-command.ts';

export interface SessionProgress {
  readonly technique: string;
  readonly step: number;
  readonly total: number;
}

export interface SessionTurn {
  readonly speaker: string;
  readonly text: string;
  readonly isYou?: boolean;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly topic: string;
  readonly transcript: readonly SessionTurn[];
  /** Present only for a currently-live session. */
  readonly progress?: SessionProgress;
}

export interface SessionsScreenProps extends ScreenProps {
  readonly sessions: readonly SessionSummary[];
  readonly onCommand: (command: EngineCommand) => void;
}

const PANE_COUNT = 2;
const LIST_PANE_INDEX = 0;
const DETAIL_PANE_INDEX = 1;
const LIST_HEIGHT = 8;
const TRANSCRIPT_HEIGHT = 10;

const START_NEW_SESSION_ID = '__start_new__';

const startNewRow: SessionSummary = {
  id: START_NEW_SESSION_ID,
  title: '+ start new session',
  topic: '',
  transcript: [],
};

function turnLine(turn: SessionTurn): string {
  const label = turn.isYou ? `you        >` : turn.speaker.padEnd(10);
  return `${label} ${turn.text}`;
}

function SessionDetail({
  session,
  focused,
}: {
  readonly session: SessionSummary | undefined;
  readonly focused: boolean;
}): JSX.Element {
  if (!session) return <Text dimColor>No session selected.</Text>;

  const lines = session.transcript.map(turnLine);

  return (
    <Box flexDirection="column">
      <Text bold>
        {session.title} · &quot;{session.topic}&quot;
        {session.progress
          ? ` · technique: ${session.progress.technique} (${String(session.progress.step)}/${String(session.progress.total)})`
          : ''}
      </Text>
      <StreamView source={lines} height={TRANSCRIPT_HEIGHT} focused={focused} />
      {!session.progress ? <Text dimColor>This session has ended.</Text> : undefined}
    </Box>
  );
}

export function SessionsScreen({
  mode,
  focusedPaneIndex,
  sessions,
  onCommand,
}: SessionsScreenProps): JSX.Element {
  const focusedPane = focusedPaneIndex % PANE_COUNT;
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(sessions[0]?.id);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [contributeSessionId, setContributeSessionId] = useState<string | undefined>(undefined);

  // Re-derived every render, never trusted from state directly -- the same "never act on a possibly-
  // stale id" discipline every prior S-screen this milestone already established.
  const activeSessionId =
    selectedSessionId !== undefined && sessions.some((session) => session.id === selectedSessionId)
      ? selectedSessionId
      : sessions[0]?.id;
  const activeSession =
    activeSessionId === undefined
      ? undefined
      : sessions.find((session) => session.id === activeSessionId);
  const isLive = activeSession?.progress !== undefined;

  function handleContributeAnswer(answer: Answer): void {
    setContributeOpen(false);
    if (contributeSessionId === undefined || answer.kind !== 'text' || answer.value.length === 0) {
      return;
    }
    // Re-derived from the live `sessions` prop at submit time, never trusted from the moment the modal
    // opened -- the same pinned-then-re-verified discipline `<GatesScreen>` (P11)'s own waive flow
    // established after its own round-1 critic finding: a session can end while the modal is still
    // open, and a contribution to an ended session is never valid.
    const pinnedSession = sessions.find((session) => session.id === contributeSessionId);
    if (pinnedSession?.progress === undefined) return;
    onCommand({
      type: 'session.contribute',
      sessionId: contributeSessionId,
      message: answer.value,
    });
  }

  useInput(
    (input, key) => {
      if (activeSession === undefined || !isLive) return;
      if (key.return) {
        setContributeSessionId(activeSession.id);
        setContributeOpen(true);
        return;
      }
      if (input === ' ') {
        onCommand({ type: 'session.advanceStep', sessionId: activeSession.id });
        return;
      }
      if (input === 'c') {
        onCommand({ type: 'session.converge', sessionId: activeSession.id });
        return;
      }
      if (input === 's') {
        onCommand({ type: 'session.saveToKb', sessionId: activeSession.id });
        return;
      }
      if (key.escape) {
        onCommand({ type: 'session.end', sessionId: activeSession.id });
      }
    },
    { isActive: focusedPane === DETAIL_PANE_INDEX && !contributeOpen },
  );

  const listItems = [startNewRow, ...sessions];

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Sessions" focused={focusedPane === LIST_PANE_INDEX} mode={mode}>
          <ListPane
            items={listItems}
            getId={(session) => session.id}
            getFilterText={(session) => session.title}
            renderItem={(session) => defaultListItemLabel(session.title, undefined, mode)}
            onSelect={(session) => {
              if (session.id === START_NEW_SESSION_ID) {
                onCommand({ type: 'session.start' });
                return;
              }
              setSelectedSessionId(session.id);
            }}
            focused={focusedPane === LIST_PANE_INDEX && !contributeOpen}
            height={LIST_HEIGHT}
          />
        </Pane>
        <Pane title="Session detail" focused={focusedPane === DETAIL_PANE_INDEX} mode={mode}>
          <SessionDetail
            session={activeSession}
            focused={focusedPane === DETAIL_PANE_INDEX && !contributeOpen}
          />
        </Pane>
      </Box>
      <Modal
        open={contributeOpen}
        onClose={() => {
          setContributeOpen(false);
        }}
      >
        <QuestionForm
          questions={[{ id: 'contribution', kind: 'text', prompt: 'Your contribution:' }]}
          onAnswer={handleContributeAnswer}
          focused={contributeOpen}
        />
      </Modal>
    </Box>
  );
}
