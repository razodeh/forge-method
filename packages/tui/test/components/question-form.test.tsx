/**
 * `<QuestionForm>` -- `04` §4.4's own max-3-questions cap, "I don't know" escape hatch, and the five
 * question kinds this piece invents fresh (`SPEC-QUESTIONS.md` Q137).
 *
 * @see specs/04 §4.4, §4.5
 * @see PLAN-M9.md P5
 */
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';

import {
  type Answer,
  assertQuestionCount,
  type Question,
  QuestionForm,
  TooManyQuestionsError,
} from '../../src/components/question-form.tsx';

const UP = '\x1B[A';
const DOWN = '\x1B[B';
const ENTER = '\r';
const BACKSPACE = '\x7F';
const CTRL_U = '\x15';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface StdinLike {
  write(data: string): void;
}

async function press(stdin: StdinLike, data: string): Promise<void> {
  stdin.write(data);
  await flush();
}

async function renderForm(questions: readonly Question[], onAnswer: (answer: Answer) => void) {
  const result = render(<QuestionForm questions={questions} onAnswer={onAnswer} focused />);
  await flush();
  return result;
}

const selectQuestion: Question = {
  id: 'q1',
  kind: 'select',
  prompt: 'Which approach?',
  options: [
    { value: 'a', label: 'Approach A' },
    { value: 'b', label: 'Approach B' },
  ],
  recommended: 'b',
};

describe('QuestionForm', () => {
  it('throws a real, typed TooManyQuestionsError synchronously when given more than 3 questions', () => {
    // Called as a plain function, not through Ink's own `render()`: Ink wraps every rendered tree in
    // its own internal error boundary (`componentDidCatch` -> `onExit(error)`), which swallows a
    // thrown render error into a rejected `waitUntilExit()` promise that `ink-testing-library`'s own
    // `render()` wrapper doesn't even expose -- confirmed directly (the first version of this test used
    // `render()` and never observed the throw at all, only a console error from Ink's own boundary).
    // Calling the component function directly bypasses React's reconciler entirely, so the real,
    // synchronous `throw` at the top of this component's own body reaches the caller unmodified -- safe
    // here specifically because the throw happens before any hook is called.
    const fourQuestions: Question[] = Array.from({ length: 4 }, (_, index) => ({
      ...selectQuestion,
      id: `q${String(index)}`,
    }));
    expect(() => {
      QuestionForm({ questions: fourQuestions, onAnswer: () => undefined, focused: true });
    }).toThrow(TooManyQuestionsError);
  });

  it("assertQuestionCount lets a real caller catch the refusal in ordinary control flow before ever rendering, including on a LATER questions-array update -- the case a render-phase throw inside an already-mounted component cannot reach cleanly, since Ink's own internal error boundary intercepts it into an uncatchable stack-trace dump instead", () => {
    const twoQuestions: Question[] = [selectQuestion, { ...selectQuestion, id: 'q2' }];
    expect(() => {
      assertQuestionCount(twoQuestions);
    }).not.toThrow();

    const fiveQuestions: Question[] = Array.from({ length: 5 }, (_, index) => ({
      ...selectQuestion,
      id: `q${String(index)}`,
    }));
    expect(() => {
      assertQuestionCount(fiveQuestions);
    }).toThrow(TooManyQuestionsError);
  });

  it('exactly 3 questions is accepted, not refused', () => {
    const threeQuestions: Question[] = Array.from({ length: 3 }, (_, index) => ({
      ...selectQuestion,
      id: `q${String(index)}`,
    }));
    expect(() => {
      render(<QuestionForm questions={threeQuestions} onAnswer={() => undefined} focused />);
    }).not.toThrow();
  });

  it('a select question renders its options with the recommended one marked', () => {
    const { lastFrame } = render(
      <QuestionForm questions={[selectQuestion]} onAnswer={() => undefined} focused />,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Approach A');
    expect(frame).toContain('Approach B (recommended)');
  });

  it("a select question's recommended default is genuinely preselected, not merely labelled -- a fresh critic round reproduced the original design reading `recommended` in exactly one place (the label suffix) while the cursor itself always started at index 0 regardless", async () => {
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([selectQuestion], onAnswer);
    // No key pressed at all: Enter immediately answers with the recommended option ("b"), not "a".
    expect(stripAnsi(lastFrame() ?? '')).toContain('> Approach B (recommended)');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'select',
      value: 'b',
    });
  });

  it("a multiselect question's recommended values are genuinely preselected, and a confirm question's recommended value is announced", () => {
    const multiselect: Question = {
      id: 'q1',
      kind: 'multiselect',
      prompt: 'Which apply?',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      recommended: ['b'],
    };
    const multiselectFrame = stripAnsi(
      render(
        <QuestionForm questions={[multiselect]} onAnswer={() => undefined} focused />,
      ).lastFrame() ?? '',
    );
    expect(multiselectFrame).toContain('[x] B');
    expect(multiselectFrame).toContain('[ ] A');

    const confirm: Question = {
      id: 'q1',
      kind: 'confirm',
      prompt: 'Proceed?',
      recommended: true,
    };
    const confirmFrame = stripAnsi(
      render(
        <QuestionForm questions={[confirm]} onAnswer={() => undefined} focused />,
      ).lastFrame() ?? '',
    );
    expect(confirmFrame).toContain('(recommended: y)');

    const text: Question = { id: 'q1', kind: 'text', prompt: 'Explain?', recommended: 'because' };
    const textFrame = stripAnsi(
      render(<QuestionForm questions={[text]} onAnswer={() => undefined} focused />).lastFrame() ??
        '',
    );
    expect(textFrame).toContain('> because');
  });

  it("a multiselect question's recommended value naming no real option is filtered out, never leaking into onAnswer as a value no option ever actually offered -- a second critic round reproduced a typo'd recommended value surviving untouched into the submitted answer", async () => {
    const question: Question = {
      id: 'q1',
      kind: 'multiselect',
      prompt: 'Which apply?',
      options: [{ value: 'a', label: 'A' }],
      recommended: ['a', 'typo-value'],
    };
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([question], onAnswer);
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'multiselect',
      values: ['a'],
    });
  });

  it("a later question's own recommended default is honoured too, not only the first question's", async () => {
    const q1: Question = { id: 'q1', kind: 'confirm', prompt: 'First?' };
    const q2: Question = {
      id: 'q2',
      kind: 'select',
      prompt: 'Second?',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
      ],
      recommended: 'y',
    };
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([q1, q2], onAnswer);
    await press(stdin, 'y');
    expect(stripAnsi(lastFrame() ?? '')).toContain('> Y (recommended)');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenNthCalledWith(2, { questionId: 'q2', kind: 'select', value: 'y' });
  });

  it('a select question: ↓ moves the cursor, Enter answers with the highlighted option', async () => {
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([selectQuestion], onAnswer);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'select',
      value: 'b',
    });
  });

  it('a select question: ↑ never moves the cursor above the first option', async () => {
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([selectQuestion], onAnswer);
    await press(stdin, DOWN);
    await press(stdin, UP);
    await press(stdin, UP);
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'select',
      value: 'a',
    });
  });

  it('Ctrl+U answers "I don\'t know" from a select question, regardless of cursor position', async () => {
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([selectQuestion], onAnswer);
    await press(stdin, DOWN);
    await press(stdin, CTRL_U);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ questionId: 'q1', kind: 'unknown' });
  });

  it('a multiselect question: space toggles, Enter submits every toggled value', async () => {
    const question: Question = {
      id: 'q1',
      kind: 'multiselect',
      prompt: 'Which apply?',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    };
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([question], onAnswer);
    await press(stdin, ' ');
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ' ');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'multiselect',
      values: ['a', 'c'],
    });
  });

  it('a multiselect question: toggling the same option twice deselects it', async () => {
    const question: Question = {
      id: 'q1',
      kind: 'multiselect',
      prompt: 'Which apply?',
      options: [{ value: 'a', label: 'A' }],
    };
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([question], onAnswer);
    await press(stdin, ' ');
    await press(stdin, ' ');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'multiselect',
      values: [],
    });
  });

  it('a multiselect question: ↑ never moves the cursor above the first option', async () => {
    const question: Question = {
      id: 'q1',
      kind: 'multiselect',
      prompt: 'Which apply?',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    };
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([question], onAnswer);
    await press(stdin, UP);
    await press(stdin, UP);
    await press(stdin, ' ');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'multiselect',
      values: ['a'],
    });
  });

  it('a text question: typed characters build the answer, backspace edits, Enter submits', async () => {
    const question: Question = { id: 'q1', kind: 'text', prompt: 'Explain?' };
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([question], onAnswer);
    await press(stdin, 'hi there');
    await press(stdin, BACKSPACE);
    expect(stripAnsi(lastFrame() ?? '')).toContain('> hi ther');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'text',
      value: 'hi ther',
    });
  });

  it('a confirm question: "y" and "n" answer directly', async () => {
    const question: Question = { id: 'q1', kind: 'confirm', prompt: 'Proceed?' };
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([question], onAnswer);
    await press(stdin, 'y');
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'confirm',
      value: true,
    });
  });

  it('a rank question: "J" demotes the highlighted item, Enter submits the resulting order', async () => {
    const question: Question = {
      id: 'q1',
      kind: 'rank',
      prompt: 'Order these',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    };
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([question], onAnswer);
    // Cursor starts at index 0 ("a"); "J" demotes it below "b".
    await press(stdin, 'J');
    expect(stripAnsi(lastFrame() ?? '')).toBe(
      "Order these\n  1. B\n> 2. A\n  3. C\nCtrl+U: I don't know",
    );
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'rank',
      order: ['b', 'a', 'c'],
    });
  });

  it('a rank question: ↓ moves the cursor down, "K" promotes the highlighted item back up, ↑ never moves above the first item', async () => {
    const question: Question = {
      id: 'q1',
      kind: 'rank',
      prompt: 'Order these',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    };
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([question], onAnswer);
    await press(stdin, UP);
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    // Cursor now at index 2 ("c"); "K" promotes it above "b".
    await press(stdin, 'K');
    expect(stripAnsi(lastFrame() ?? '')).toBe(
      "Order these\n  1. A\n> 2. C\n  3. B\nCtrl+U: I don't know",
    );
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'rank',
      order: ['a', 'c', 'b'],
    });
  });

  it('a rank question: "K" at the top and "J" at the bottom are safe no-ops', async () => {
    const question: Question = {
      id: 'q1',
      kind: 'rank',
      prompt: 'Order these',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    };
    const onAnswer = vi.fn();
    const { stdin } = await renderForm([question], onAnswer);
    await press(stdin, 'K');
    await press(stdin, DOWN);
    await press(stdin, 'J');
    await press(stdin, ENTER);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      questionId: 'q1',
      kind: 'rank',
      order: ['a', 'b'],
    });
  });

  it('advances to the next question after answering, and onAnswer fires once per question, not once at the end', async () => {
    const q1: Question = { id: 'q1', kind: 'confirm', prompt: 'First?' };
    const q2: Question = { id: 'q2', kind: 'confirm', prompt: 'Second?' };
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([q1, q2], onAnswer);
    expect(stripAnsi(lastFrame() ?? '')).toContain('First?');
    await press(stdin, 'y');
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(stripAnsi(lastFrame() ?? '')).toContain('Second?');
    await press(stdin, 'n');
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('keys are ignored entirely when not focused', async () => {
    const onAnswer = vi.fn();
    const { stdin } = render(
      <QuestionForm questions={[selectQuestion]} onAnswer={onAnswer} focused={false} />,
    );
    await flush();
    await press(stdin, ENTER);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('an empty questions array renders a completion marker and does not crash on navigation', async () => {
    const onAnswer = vi.fn();
    const { lastFrame, stdin } = await renderForm([], onAnswer);
    expect(lastFrame()).toBe('done');
    await press(stdin, ENTER);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
