/**
 * `<Toast>` — `04` §4.5's own transient notifications, queued, max 3 visible at once. This component
 * is a pure function of `queue`: it renders only the newest 3 entries, dropping older ones, and never
 * grows its own rendered output unbounded regardless of how many entries `queue` actually holds.
 * Expiry itself (removing an entry from `queue` after its own display duration) is a caller concern --
 * a real timer is stateful, and this piece's own components are deliberately stateless (`PLAN-M9.md`
 * P2's mandate); the state-owning screen/`<AppShell>` (a later piece) is what actually times entries
 * out and re-renders with a shorter `queue`.
 *
 * Every entry's own `kind` is rendered as a real, distinct text label (`[INFO]`/`[WARN]`/`[ERROR]`),
 * not only as `KIND_COLOR`'s colour -- a fresh critic round reproduced directly that the original
 * design rendered `message.text` alone, so two toasts sharing identical text but different `kind`
 * were byte-identical once `color: false` (this component's own test suite proved it, asserting away
 * the only channel that carried `kind` at all): under `NO_COLOR`/`TERM=dumb` a real error toast was
 * textually indistinguishable from an info one, violating `04` §4.7's "colour is never *only*
 * meaning-bearing" rule the same way `<StatusGlyph>` already satisfies it for the 8 canonical states.
 *
 * @see specs/04 §4.5, §4.7
 * @see PLAN-M9.md P2
 */
import { Box, Text } from 'ink';
import type { JSX } from 'react';

export type ToastKind = 'info' | 'warn' | 'error';

export interface ToastMessage {
  readonly id: string;
  readonly text: string;
  readonly kind: ToastKind;
}

export interface ToastProps {
  readonly queue: readonly ToastMessage[];
  readonly color: boolean;
}

const MAX_VISIBLE = 3;

const KIND_COLOR: Readonly<Record<ToastKind, string>> = {
  info: 'blue',
  warn: 'yellow',
  error: 'red',
};

/** A real, distinct text label for each kind -- ordinary ASCII, safe to render regardless of
 * `RenderMode.ascii`, unlike `<StatusGlyph>`'s own Unicode/ascii glyph pair. */
const KIND_LABEL: Readonly<Record<ToastKind, string>> = {
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
};

export function Toast({ queue, color }: ToastProps): JSX.Element {
  const visible = queue.slice(Math.max(0, queue.length - MAX_VISIBLE));

  return (
    <Box flexDirection="column">
      {visible.map((message) => (
        <Text key={message.id} {...(color ? { color: KIND_COLOR[message.kind] } : {})}>
          {KIND_LABEL[message.kind]} {message.text}
        </Text>
      ))}
    </Box>
  );
}
