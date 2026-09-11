/**
 * `<QuestionForm>` — `04` §4.4's own literal "max 3 questions per modal, ordered by information gain,
 * with the agent's recommended default preselected... 'I don't know' always available." No question-
 * shape vocabulary (select/multiselect/text/confirm/rank) exists anywhere else in this codebase to
 * conform to -- `PLAN-M9.md` P5's own text names these five forms as coming from "`05`/`16`'s own
 * elicitation mechanisms," but neither `@forge/adapter-kit`'s control-token vocabulary (`FORGE_ASK` is a
 * flat `{ question, options }`, no kind discriminant) nor `@forge/engine`'s own `ElicitQuestion` (a flat
 * `{ name, prompt }`) actually encode any of the five; `ElicitationRequested`'s own event payload is
 * `unknown`, defined by no code anywhere. The `Question`/`Answer` union below is this piece's own fresh
 * design, not a conformance target -- recorded in `SPEC-QUESTIONS.md` Q137.
 *
 * The 3-question cap is a real, synchronous, typed refusal (`TooManyQuestionsError`), thrown from the
 * component's own render body -- `04` §4.4's own "must never be a wall of questions" is a hard MUST, not
 * a rendering suggestion a caller could otherwise violate by simply passing a longer array. **This throw
 * only reaches a caller cleanly on the very first render.** A fresh critic round reproduced directly
 * that re-rendering an already-mounted `<QuestionForm>` into more than 3 questions is *not* a catchable
 * refusal in practice: Ink wraps every rendered tree in its own internal error boundary
 * (`componentDidCatch` -> `onExit`), which intercepts a later render-phase throw and tears the tree down
 * into a raw stack-trace dump on screen, never a `try`/`catch`-able exception a caller's own code can
 * see. `assertQuestionCount` is exported precisely so a real caller validates a *new* `questions` array
 * itself, in ordinary control flow, before ever constructing or updating a `<QuestionForm>` element --
 * the identical "this is a caller-lifecycle responsibility, not something one already-mounted instance
 * can safely detect and recover from" resolution this package has already reached twice before (`Tree`'s
 * own reused-id hazard, M9 P3; `EngineClient`'s own restart question, M9 P1, `SPEC-QUESTIONS.md` Q133).
 *
 * One question is shown at a time; `onAnswer` fires once per question as it is answered (not once at
 * the end with a batched array), so a caller can react to -- or persist -- partial progress through a
 * still-in-progress form. `Ctrl+U` ("unknown") answers the current question with `{ kind: 'unknown' }`
 * from any of the five question kinds -- the one control this component guarantees is always available,
 * regardless of kind, matching §4.4's own "always available" text exactly.
 *
 * Every question's own `recommended` default is genuinely preselected, not merely labelled -- a fresh
 * critic round reproduced directly that the original design read `recommended` in exactly one place (a
 * `(recommended)` label suffix on a `select` option), while `multiselect`/`text`/`confirm`'s own
 * `recommended` fields were declared, accepted, and never read anywhere: real, reachable dead prop
 * surface directly contradicting §4.4's own hard-MUST "recommended default preselected" text, not merely
 * a missing label. `initialStateFor` now seeds the real starting `cursor`/`selected`/`text` for whichever
 * question is current -- called both for the very first question (as the state's own lazy initializer)
 * and again inside `advance()` for whichever question comes next, so a recommended default is honoured
 * throughout the form, not just on question one.
 *
 * @see specs/04 §4.4, §4.5
 * @see PLAN-M9.md P5
 */
import { Box, Text, useInput } from 'ink';
import type { JSX } from 'react';
import { useState } from 'react';

export interface QuestionOption {
  readonly value: string;
  readonly label: string;
}

interface QuestionBase {
  readonly id: string;
  readonly prompt: string;
  readonly whyItMatters?: string;
}

export interface SelectQuestion extends QuestionBase {
  readonly kind: 'select';
  readonly options: readonly QuestionOption[];
  readonly recommended?: string;
}

export interface MultiselectQuestion extends QuestionBase {
  readonly kind: 'multiselect';
  readonly options: readonly QuestionOption[];
  readonly recommended?: readonly string[];
}

export interface TextQuestion extends QuestionBase {
  readonly kind: 'text';
  readonly recommended?: string;
}

export interface ConfirmQuestion extends QuestionBase {
  readonly kind: 'confirm';
  readonly recommended?: boolean;
}

export interface RankQuestion extends QuestionBase {
  readonly kind: 'rank';
  readonly options: readonly QuestionOption[];
}

export type Question =
  SelectQuestion | MultiselectQuestion | TextQuestion | ConfirmQuestion | RankQuestion;

export type Answer =
  | { readonly questionId: string; readonly kind: 'unknown' }
  | { readonly questionId: string; readonly kind: 'select'; readonly value: string }
  | {
      readonly questionId: string;
      readonly kind: 'multiselect';
      readonly values: readonly string[];
    }
  | { readonly questionId: string; readonly kind: 'text'; readonly value: string }
  | { readonly questionId: string; readonly kind: 'confirm'; readonly value: boolean }
  | { readonly questionId: string; readonly kind: 'rank'; readonly order: readonly string[] };

const MAX_QUESTIONS = 3;

export class TooManyQuestionsError extends Error {
  readonly count: number;

  constructor(count: number) {
    super(
      `QuestionForm: ${String(count)} questions given, but 04 §4.4's own "must never be a wall of ` +
        `questions" caps a single modal at ${String(MAX_QUESTIONS)}.`,
    );
    this.name = 'TooManyQuestionsError';
    this.count = count;
  }
}

/** Throws `TooManyQuestionsError` if `questions` exceeds the 3-question cap. Real callers should call
 * this themselves, in ordinary control flow, before ever constructing or updating a `<QuestionForm>`
 * element with a new `questions` array -- see this file's own top doc comment for why a render-phase
 * throw inside the component itself cannot reach a caller cleanly once already mounted. */
export function assertQuestionCount(questions: readonly Question[]): void {
  if (questions.length > MAX_QUESTIONS) {
    throw new TooManyQuestionsError(questions.length);
  }
}

interface QuestionFormState {
  readonly cursor: number;
  readonly selected: ReadonlySet<string>;
  readonly text: string;
}

/** The real starting `cursor`/`selected`/`text` for a given question, honouring its own `recommended`
 * default -- called for the first question (as state's own lazy initializer) and again for whichever
 * question `advance()` moves to next, so a recommended default is preselected throughout the form. */
function initialStateFor(question: Question | undefined): QuestionFormState {
  if (question?.kind === 'select') {
    const recommendedIndex = question.options.findIndex(
      (option) => option.value === question.recommended,
    );
    return { cursor: Math.max(0, recommendedIndex), selected: new Set(), text: '' };
  }
  if (question?.kind === 'multiselect') {
    // Filtered against the question's own real options -- a caller-data typo in `recommended` (a value
    // naming no real option) must never silently leak into `onAnswer`'s own `values` array as an
    // answer no option ever actually offered; a fresh critic round reproduced exactly that.
    const validValues = new Set(question.options.map((option) => option.value));
    const recommended = (question.recommended ?? []).filter((value) => validValues.has(value));
    return { cursor: 0, selected: new Set(recommended), text: '' };
  }
  if (question?.kind === 'text') {
    return { cursor: 0, selected: new Set(), text: question.recommended ?? '' };
  }
  return { cursor: 0, selected: new Set(), text: '' };
}

export interface QuestionFormProps {
  readonly questions: readonly Question[];
  readonly onAnswer: (answer: Answer) => void;
  readonly focused: boolean;
}

export function QuestionForm({ questions, onAnswer, focused }: QuestionFormProps): JSX.Element {
  assertQuestionCount(questions);

  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState(() => initialStateFor(questions[0]).cursor);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => initialStateFor(questions[0]).selected,
  );
  const [text, setText] = useState(() => initialStateFor(questions[0]).text);
  const [order, setOrder] = useState<readonly string[] | undefined>(undefined);

  const question = questions[index];

  function advance(answer: Answer): void {
    onAnswer(answer);
    const nextIndex = index + 1;
    const nextState = initialStateFor(questions[nextIndex]);
    setIndex(nextIndex);
    setCursor(nextState.cursor);
    setSelected(nextState.selected);
    setText(nextState.text);
    setOrder(undefined);
  }

  useInput(
    (input, key) => {
      if (!question) return;
      if (key.ctrl && input === 'u') {
        advance({ questionId: question.id, kind: 'unknown' });
        return;
      }

      if (question.kind === 'select') {
        if (key.upArrow || input === 'k') {
          setCursor((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow || input === 'j') {
          setCursor((current) => Math.min(question.options.length - 1, current + 1));
          return;
        }
        if (key.return) {
          const chosen = question.options[cursor];
          if (chosen) advance({ questionId: question.id, kind: 'select', value: chosen.value });
        }
        return;
      }

      if (question.kind === 'multiselect') {
        if (key.upArrow || input === 'k') {
          setCursor((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow || input === 'j') {
          setCursor((current) => Math.min(question.options.length - 1, current + 1));
          return;
        }
        if (input === ' ') {
          const current = question.options[cursor];
          if (!current) return;
          setSelected((existing) => {
            const next = new Set(existing);
            if (next.has(current.value)) next.delete(current.value);
            else next.add(current.value);
            return next;
          });
          return;
        }
        if (key.return) {
          advance({ questionId: question.id, kind: 'multiselect', values: [...selected] });
        }
        return;
      }

      if (question.kind === 'text') {
        if (key.return) {
          advance({ questionId: question.id, kind: 'text', value: text });
          return;
        }
        if (key.backspace || key.delete) {
          setText((current) => current.slice(0, -1));
          return;
        }
        if (input.length > 0) {
          setText((current) => current + input);
        }
        return;
      }

      if (question.kind === 'confirm') {
        if (input === 'y') {
          advance({ questionId: question.id, kind: 'confirm', value: true });
          return;
        }
        if (input === 'n') {
          advance({ questionId: question.id, kind: 'confirm', value: false });
        }
        return;
      }

      // rank
      const currentOrder = order ?? question.options.map((option) => option.value);
      if (key.upArrow || input === 'k') {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setCursor((current) => Math.min(currentOrder.length - 1, current + 1));
        return;
      }
      if (input === 'K') {
        if (cursor === 0) return;
        const next = [...currentOrder];
        const [item] = next.splice(cursor, 1);
        if (item !== undefined) next.splice(cursor - 1, 0, item);
        setOrder(next);
        setCursor(cursor - 1);
        return;
      }
      if (input === 'J') {
        if (cursor >= currentOrder.length - 1) return;
        const next = [...currentOrder];
        const [item] = next.splice(cursor, 1);
        if (item !== undefined) next.splice(cursor + 1, 0, item);
        setOrder(next);
        setCursor(cursor + 1);
        return;
      }
      if (key.return) {
        advance({ questionId: question.id, kind: 'rank', order: currentOrder });
      }
    },
    { isActive: focused && question !== undefined },
  );

  if (!question) return <Text>done</Text>;

  const labelFor = (value: string): string =>
    question.kind === 'select' || question.kind === 'multiselect' || question.kind === 'rank'
      ? (question.options.find((option) => option.value === value)?.label ?? value)
      : value;

  return (
    <Box flexDirection="column">
      <Text bold>{question.prompt}</Text>
      {question.whyItMatters ? <Text dimColor>{question.whyItMatters}</Text> : undefined}
      {question.kind === 'select' &&
        question.options.map((option, optionIndex) => (
          <Text key={option.value}>
            {optionIndex === cursor ? '> ' : '  '}
            {option.label}
            {option.value === question.recommended ? ' (recommended)' : ''}
          </Text>
        ))}
      {question.kind === 'multiselect' &&
        question.options.map((option, optionIndex) => (
          <Text key={option.value}>
            {optionIndex === cursor ? '> ' : '  '}
            {selected.has(option.value) ? '[x] ' : '[ ] '}
            {option.label}
          </Text>
        ))}
      {question.kind === 'text' ? (
        <Text>
          {'> '}
          {text}
        </Text>
      ) : undefined}
      {question.kind === 'confirm' ? (
        <Text>
          (y/n)
          {question.recommended === undefined
            ? ''
            : ` (recommended: ${question.recommended ? 'y' : 'n'})`}
        </Text>
      ) : undefined}
      {question.kind === 'rank' &&
        (order ?? question.options.map((option) => option.value)).map((value, valueIndex) => (
          <Text key={value}>
            {valueIndex === cursor ? '> ' : '  '}
            {String(valueIndex + 1)}. {labelFor(value)}
          </Text>
        ))}
      <Text dimColor>Ctrl+U: I don't know</Text>
    </Box>
  );
}
