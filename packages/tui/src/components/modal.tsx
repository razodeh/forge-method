/**
 * `<Modal>` — `04` §4.4's own focus-trapping overlay: while open, no key reaches anything but the
 * modal's own subtree; `Esc` closes; it renders as a real overlay layer, not a screen replacement (the
 * underlying screen's own state is preserved, matching §4.4's "pop to parent" framing -- this component
 * never unmounts the background, it is simply rendered *alongside* it by the caller).
 *
 * Ink's `useInput` has no concept of z-order: every mounted hook with `isActive: true` receives the
 * same keypress, regardless of which component is "on top" visually. A `<Modal>` and the screen behind
 * it are ordinary React siblings (a real app renders `<Screen/>` and `<Modal>` next to each other, not
 * one inside the other), so `<Modal>` cannot reach into a sibling's own `useInput` call to disable it on
 * its own. The trap is therefore a real, shared contract, not something `<Modal>` alone can enforce:
 * this file exports `ModalStackContext`/`useIsBackgrounded` for background content to read, and it is
 * the *orchestrating parent* -- the one component that already knows whether a modal is open, since it
 * owns both the modal and the screen behind it as siblings -- that wraps the *background* content in
 * `ModalStackContext.Provider value={{ isBackgrounded: <a modal is open> }}`. Background content folds
 * the result into its own `useInput({ isActive: focused && !isBackgrounded })`. `<AppShell>` (a later
 * piece, `PLAN-M9.md` P6) is the real integrator that does this for every real screen against its own
 * modal stack; this piece defines the mechanism and proves it end-to-end against a test double.
 *
 * **Left deliberately un-enforced here, disclosed rather than guessed at: `<Modal>` itself has no**
 * **notion of "topmost" among multiple simultaneously-`open` instances.** A fresh critic round
 * reproduced directly that mounting two `<Modal open>` siblings and pressing `Esc` once calls *both*
 * `onClose` callbacks -- nothing in this component's own contract says only one should respond.
 * `PLAN-M9.md` P6's own text names a real "modal stack" (`readonly ModalEntry[]`) whose own Check reads
 * "`Esc` pops exactly one level, never the whole stack" -- deciding *which* modal is topmost, and
 * routing `Esc` (and the focus trap) to only that one, is that stack's own real ownership, not something
 * a single, stack-unaware `<Modal>` instance could resolve correctly on its own without knowing about
 * every other instance that might also be mounted. A caller that renders more than one `<Modal
 * open>` at once without a stack coordinating them will see this exact double-close.
 *
 * @see specs/04 §4.2, §4.4, §4.5
 * @see PLAN-M9.md P5
 */
import { Box, useInput } from 'ink';
import type { JSX, ReactNode } from 'react';
import { createContext, useContext } from 'react';

export interface ModalStackState {
  readonly isBackgrounded: boolean;
}

export const ModalStackContext = createContext<ModalStackState>({ isBackgrounded: false });

/** Background content calls this and folds the result into its own `useInput({ isActive: ... })` to
 * honour the focus trap while something has declared itself on top via `ModalStackContext.Provider`. */
export function useIsBackgrounded(): boolean {
  return useContext(ModalStackContext).isBackgrounded;
}

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function Modal({ open, onClose, children }: ModalProps): JSX.Element {
  useInput(
    (_input, key) => {
      if (key.escape) onClose();
    },
    { isActive: open },
  );

  if (!open) return <></>;

  return (
    <Box borderStyle="double" flexDirection="column" paddingX={1}>
      {children}
    </Box>
  );
}
