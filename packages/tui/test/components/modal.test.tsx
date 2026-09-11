/**
 * `<Modal>` -- `04` §4.4's own focus-trapping overlay.
 *
 * See `list-pane.test.tsx`'s own header comment for why every test that presses a key awaits `flush()`
 * once right after `render()`, before the first `stdin.write()`.
 *
 * @see specs/04 §4.4, §4.5
 * @see PLAN-M9.md P5
 */
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import type { JSX } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Modal, ModalStackContext, useIsBackgrounded } from '../../src/components/modal.tsx';

const ESC = '\x1B';

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

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { lastFrame } = render(
      <Modal open={false} onClose={() => undefined}>
        <Text>hello</Text>
      </Modal>,
    );
    expect(lastFrame()).toBe('');
  });

  it('renders its children when open', () => {
    const { lastFrame } = render(
      <Modal open onClose={() => undefined}>
        <Text>hello</Text>
      </Modal>,
    );
    expect(lastFrame() ?? '').toContain('hello');
  });

  it('Esc closes the modal by invoking onClose', async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <Modal open onClose={onClose}>
        <Text>hello</Text>
      </Modal>,
    );
    await flush();
    await press(stdin, ESC);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc does nothing when the modal is closed', async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <Modal open={false} onClose={onClose}>
        <Text>hello</Text>
      </Modal>,
    );
    await flush();
    await press(stdin, ESC);
    expect(onClose).not.toHaveBeenCalled();
  });
});

/** A minimal stand-in for "a real screen behind the modal": it counts every keypress it receives,
 * honouring the shared focus-trap contract via `useIsBackgrounded()` exactly the way a real screen is
 * expected to. */
function BackgroundContent({ onKey }: { onKey: () => void }): JSX.Element {
  const isBackgrounded = useIsBackgrounded();
  useInput(
    () => {
      onKey();
    },
    { isActive: !isBackgrounded },
  );
  return <Text>background</Text>;
}

function Scene({
  modalOpen,
  onBackgroundKey,
}: {
  modalOpen: boolean;
  onBackgroundKey: () => void;
}) {
  const [closed, setClosed] = useState(false);
  return (
    <>
      <ModalStackContext.Provider value={{ isBackgrounded: modalOpen && !closed }}>
        <BackgroundContent onKey={onBackgroundKey} />
      </ModalStackContext.Provider>
      <Modal
        open={modalOpen && !closed}
        onClose={() => {
          setClosed(true);
        }}
      >
        <Text>modal content</Text>
      </Modal>
    </>
  );
}

describe('Modal focus-trap contract (ModalStackContext / useIsBackgrounded)', () => {
  it('a scripted key sequence targeting content behind an open modal produces zero effect on that background content', async () => {
    const onBackgroundKey = vi.fn();
    const { stdin } = render(<Scene modalOpen onBackgroundKey={onBackgroundKey} />);
    await flush();
    await press(stdin, 'a');
    await press(stdin, 'b');
    await press(stdin, '\r');
    expect(onBackgroundKey).not.toHaveBeenCalled();
  });

  it('once no modal is open, the same background content receives keys again', async () => {
    const onBackgroundKey = vi.fn();
    const { stdin } = render(<Scene modalOpen={false} onBackgroundKey={onBackgroundKey} />);
    await flush();
    await press(stdin, 'a');
    expect(onBackgroundKey).toHaveBeenCalledTimes(1);
  });

  it("Esc closes the modal and background content immediately starts receiving keys again -- the prior screen's own focus state (never touched by Modal) is preserved exactly", async () => {
    const onBackgroundKey = vi.fn();
    const { stdin } = render(<Scene modalOpen onBackgroundKey={onBackgroundKey} />);
    await flush();
    await press(stdin, 'a');
    expect(onBackgroundKey).not.toHaveBeenCalled();

    await press(stdin, ESC);
    await press(stdin, 'b');
    expect(onBackgroundKey).toHaveBeenCalledTimes(1);
  });
});
