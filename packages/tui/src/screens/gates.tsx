/**
 * `<GatesScreen>` — `04` §4.3 S5: gate status/checks/evidence/open-questions, and the approve/reject/
 * waive/re-run-checks flow. `04` §4.4's own "Gate review modal reuses this screen's own body, as S5,
 * focused" is not built here — that's a later, real `<AppShell>`-modal integration piece; this file is
 * the reusable body itself.
 *
 * Real design decisions, recorded fully in `SPEC-QUESTIONS.md` Q143:
 *
 * 1. No `RunReadModel` field carries per-gate status/checks/evidence/open-questions — confirmed
 *    directly: `run-read-model.ts`'s exhaustive `EventType` switch folds `GateEvaluated`/`GateApproved`/
 *    `GateRejected`/`GateWaived` into its own no-op catch-all group, with no dedicated projection at
 *    all. `gates` is accepted as an explicit, caller-supplied prop, the same pattern every prior S-
 *    screen this milestone (P7-P10) already established for its own out-of-scope facts.
 * 2. **`04`'s own literal hard MUST — "approving a gate with failing deterministic checks MUST be**
 *    **impossible" — is enforced structurally in this file, not by convention.** `a` never constructs a
 *    `gate.approve` `EngineCommand` at all when any deterministic check on the focused gate has
 *    `status !== 'pass'`; the refusal is a real, typed reason rendered in the UI (`why approval is
 *    currently blocked`), not a command sent and rejected by whatever engine-side enforcement also
 *    exists. This is a UI-layer guarantee layered *on top of* real engine-side enforcement, never a
 *    substitute for it — the engine is still the actual authority; this screen simply never gives a
 *    human the chance to construct the wrong request in the first place.
 * 3. **Waiving an `alwaysHuman` gate is refused outright — no path to waive at all, not even with a**
 *    **typed reason** — matching `13`'s own already-established "waivers of `alwaysHuman` gates are not
 *    permitted at any autonomy level." `w` on such a gate opens no modal, emits nothing; the modal only
 *    ever opens for a gate whose own `alwaysHuman` flag is `false`.
 * 4. Waive re-uses `<QuestionForm>` (P5)'s own single `text` question shape for the typed reason —
 *    `04` §4.1's own "type \"abort\" to confirm" pattern, generalised to an actual waiver reason (not the
 *    literal word "abort"), matching this milestone's own established typed-confirmation precedent
 *    rather than inventing a bespoke confirmation widget.
 * 5. `Enter` (open question) is a pure, local view concern — the identical reasoning every prior S-
 *    screen this milestone already established for its own view-only keys — showing the selected open
 *    question's own full text in a dedicated panel, never an `EngineCommand`. `c` (re-run checks) and
 *    `x` (reject) are real, unconfirmed, single-keystroke commands — `04`'s own mockup lists all four
 *    gate keys (`a`/`x`/`w`/`c`) at the same level with no confirmation step named for any but `w`
 *    (whose own confirmation is the typed-reason requirement itself, not an extra step on top of it).
 * 6. **A round-1 critic found a real, reachable gap in hard MUST #3's own enforcement**: the waive
 *    submit handler used to re-check only that the pinned gate still *existed* in `gates` by id, never
 *    that its `alwaysHuman` flag was still `false` — a live prop update flipping that same gate's own
 *    `alwaysHuman` to `true` while the modal stayed open (`waiveOpen` is local state, untouched by a
 *    `gates` prop change) could still let a typed reason submitted afterward construct a real
 *    `gate.waive` command, a direct violation of this screen's own documented guarantee. **Fixed**: the
 *    submit handler re-derives the pinned gate from the *live* `gates` prop and re-checks
 *    `!pinnedGate.alwaysHuman` immediately before ever constructing the command — the only re-check that
 *    actually matters is the one at the instant a command would be built, not the one at the instant the
 *    modal opened.
 * 7. **The same round found a second, real (non-command-emitting) bug**: the open-question panel used a
 *    bare `questionId: string | undefined`, looked up against whichever gate happened to be active —
 *    ambiguous the moment two different gates reuse the same question id (`Q1`/`Q2` are an obvious,
 *    plausible convention across gates), so `activeGateId`'s own automatic stale-selection fallback
 *    (switching to a different gate after a live `gates` update removes the previously-selected one)
 *    could silently display a *different* gate's own question text under an id that only ever meant
 *    something on the gate the user actually selected it from. **Fixed**: the open-question selection is
 *    now tracked as `{ gateId, questionId }` together, and only ever displayed when `gateId` still
 *    matches the current `activeGateId` — the identical "pin the full context, not just an id that could
 *    collide" discipline point 6's own fix applies to the waive flow.
 *
 * @see specs/04 §4.1, §4.3 S5, §4.4
 * @see specs/13
 * @see PLAN-M9.md P11
 * @see SPEC-QUESTIONS.md Q143
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ScreenProps } from '../components/app-shell.tsx';
import { defaultListItemLabel, ListPane } from '../components/list-pane.tsx';
import { Modal } from '../components/modal.tsx';
import { Pane } from '../components/pane.tsx';
import { type Answer, QuestionForm } from '../components/question-form.tsx';
import { StatusGlyph, type StatusState } from '../components/status-glyph.tsx';
import type { EngineCommand } from '../state/engine-command.ts';

export interface GateCheck {
  readonly id: string;
  readonly status: StatusState;
  readonly detail: string;
}

export interface GateOpenQuestion {
  readonly id: string;
  readonly text: string;
}

export interface GateInfo {
  readonly id: string;
  readonly label: string;
  readonly status: StatusState;
  readonly deterministicChecks: readonly GateCheck[];
  readonly advisoryChecks: readonly GateCheck[];
  readonly openQuestions: readonly GateOpenQuestion[];
  readonly alwaysHuman: boolean;
}

export interface GatesScreenProps extends ScreenProps {
  readonly gates: readonly GateInfo[];
  readonly onCommand: (command: EngineCommand) => void;
}

const PANE_COUNT = 2;
const LIST_PANE_INDEX = 0;
const DETAIL_PANE_INDEX = 1;
const LIST_HEIGHT = 8;

function approvalBlockedReason(gate: GateInfo): string | undefined {
  const failing = gate.deterministicChecks.filter((check) => check.status !== 'pass');
  if (failing.length === 0) return undefined;
  return `Blocked: ${failing.map((check) => check.id).join(', ')} ${failing.length === 1 ? 'is' : 'are'} still failing.`;
}

function CheckRow({
  check,
  mode,
}: {
  readonly check: GateCheck;
  readonly mode: ScreenProps['mode'];
}): JSX.Element {
  return (
    <Text>
      <StatusGlyph state={check.status} mode={mode} /> {check.id} {mode.ascii ? '-' : '—'}{' '}
      {check.detail}
    </Text>
  );
}

function GateDetail({
  gate,
  openQuestionId,
  mode,
}: {
  readonly gate: GateInfo | undefined;
  readonly openQuestionId: string | undefined;
  readonly mode: ScreenProps['mode'];
}): JSX.Element {
  if (!gate) return <Text dimColor>No gate selected.</Text>;

  const blockedReason = approvalBlockedReason(gate);
  const openQuestion = gate.openQuestions.find((question) => question.id === openQuestionId);

  return (
    <Box flexDirection="column">
      <Text bold>{gate.label}</Text>
      <Text>Deterministic checks</Text>
      {gate.deterministicChecks.map((check) => (
        <CheckRow check={check} mode={mode} key={check.id} />
      ))}
      <Text>Advisory (LLM)</Text>
      {gate.advisoryChecks.map((check) => (
        <CheckRow check={check} mode={mode} key={check.id} />
      ))}
      <Text>Open questions ({gate.openQuestions.length})</Text>
      {gate.openQuestions.map((question) => (
        <Text key={question.id}>
          {question.id} {question.text}
        </Text>
      ))}
      {openQuestion ? (
        <Text dimColor>
          {mode.ascii ? '>' : '▸'} {openQuestion.id}: {openQuestion.text}
        </Text>
      ) : undefined}
      {blockedReason ? (
        <Text {...(mode.color ? { color: 'red' } : {})}>{blockedReason}</Text>
      ) : undefined}
      {gate.alwaysHuman ? (
        <Text dimColor>This gate cannot be waived at any autonomy level.</Text>
      ) : undefined}
    </Box>
  );
}

export function GatesScreen({
  mode,
  focusedPaneIndex,
  gates,
  onCommand,
}: GatesScreenProps): JSX.Element {
  const focusedPane = focusedPaneIndex % PANE_COUNT;
  const [selectedGateId, setSelectedGateId] = useState<string | undefined>(gates[0]?.id);
  // Tracks *which gate* the open question was selected on, alongside its own id -- a plain
  // `questionId: string | undefined` would be ambiguous the moment two different gates happen to reuse
  // the same open-question id (`Q1` is an obvious, plausible convention across gates), letting a stale
  // selection from a previously-focused gate silently appear to match a different gate's own row of the
  // same id after `activeGateId`'s automatic stale-selection fallback (below) switches gates out from
  // under the user. A round-1 critic reproduced this directly.
  const [openQuestion, setOpenQuestion] = useState<
    { readonly gateId: string; readonly questionId: string } | undefined
  >(undefined);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveGateId, setWaiveGateId] = useState<string | undefined>(undefined);

  // Re-derived every render, never trusted from state directly -- the same "never act on a possibly-
  // stale id" discipline every prior S-screen this milestone already established.
  const activeGateId =
    selectedGateId !== undefined && gates.some((gate) => gate.id === selectedGateId)
      ? selectedGateId
      : gates[0]?.id;
  const activeGate =
    activeGateId === undefined ? undefined : gates.find((gate) => gate.id === activeGateId);
  const activeOpenQuestionId =
    openQuestion !== undefined && openQuestion.gateId === activeGateId
      ? openQuestion.questionId
      : undefined;

  function handleWaiveAnswer(answer: Answer): void {
    setWaiveOpen(false);
    if (waiveGateId === undefined || answer.kind !== 'text' || answer.value.length === 0) return;
    // Re-derived from the LIVE `gates` prop at submit time, never trusted from the moment `w` opened
    // the modal -- a round-1 critic reproduced directly that checking only "does a gate with this id
    // still exist" was not enough to uphold this screen's own hard MUST: a gate can still exist by id
    // while its own `alwaysHuman` flag has flipped to `true` on a live prop update that arrived while
    // the modal stayed open (`waiveOpen` is local state, untouched by a `gates` prop change), and the
    // typed-reason requirement is not itself a substitute for re-checking `alwaysHuman` at the only
    // moment that actually matters -- the instant a `gate.waive` command would be constructed.
    const pinnedGate = gates.find((gate) => gate.id === waiveGateId);
    if (pinnedGate === undefined || pinnedGate.alwaysHuman) return;
    onCommand({ type: 'gate.waive', gateId: waiveGateId, reason: answer.value });
  }

  useInput(
    (input) => {
      if (activeGate === undefined) return;
      if (input === 'a') {
        if (approvalBlockedReason(activeGate) !== undefined) return;
        onCommand({ type: 'gate.approve', gateId: activeGate.id });
        return;
      }
      if (input === 'x') {
        onCommand({ type: 'gate.reject', gateId: activeGate.id });
        return;
      }
      if (input === 'w') {
        if (activeGate.alwaysHuman) return;
        setWaiveGateId(activeGate.id);
        setWaiveOpen(true);
        return;
      }
      if (input === 'c') {
        onCommand({ type: 'gate.rerunChecks', gateId: activeGate.id });
      }
    },
    { isActive: focusedPane === DETAIL_PANE_INDEX && !waiveOpen },
  );

  useInput(
    (_input, key) => {
      if (activeGate === undefined || !key.return) return;
      const first = activeGate.openQuestions[0];
      if (!first) return;
      const currentIndex = activeGate.openQuestions.findIndex((q) => q.id === activeOpenQuestionId);
      const next = activeGate.openQuestions[(currentIndex + 1) % activeGate.openQuestions.length];
      setOpenQuestion({ gateId: activeGate.id, questionId: next?.id ?? first.id });
    },
    { isActive: focusedPane === DETAIL_PANE_INDEX && !waiveOpen },
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Gates" focused={focusedPane === LIST_PANE_INDEX} mode={mode}>
          <ListPane
            items={gates}
            getId={(gate) => gate.id}
            getFilterText={(gate) => gate.label}
            renderItem={(gate) => defaultListItemLabel(gate.label, gate.status, mode)}
            onSelect={(gate) => {
              setSelectedGateId(gate.id);
            }}
            focused={focusedPane === LIST_PANE_INDEX && !waiveOpen}
            height={LIST_HEIGHT}
          />
        </Pane>
        <Pane title="Gate detail" focused={focusedPane === DETAIL_PANE_INDEX} mode={mode}>
          <GateDetail gate={activeGate} openQuestionId={activeOpenQuestionId} mode={mode} />
        </Pane>
      </Box>
      <Modal
        open={waiveOpen}
        onClose={() => {
          setWaiveOpen(false);
        }}
      >
        <QuestionForm
          questions={[
            { id: 'waive-reason', kind: 'text', prompt: 'Reason for waiving this gate:' },
          ]}
          onAnswer={handleWaiveAnswer}
          focused={waiveOpen}
        />
      </Modal>
    </Box>
  );
}
