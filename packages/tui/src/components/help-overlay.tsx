/**
 * `<HelpOverlay>` — `04` §4.5's own "keys + 'what can I do here'" contextual help: renders the
 * *current screen's own* real, active key bindings, not a static, global cheat sheet. A stateless,
 * pure function of `context`/`keys` -- the caller (whichever screen is active) is the one that knows
 * its own real, currently-active bindings; this component never guesses or hardcodes a global list.
 *
 * @see specs/04 §4.5
 * @see PLAN-M9.md P5
 */
import { Box, Text } from 'ink';
import type { JSX } from 'react';

import type { RenderMode } from '../env.ts';

export interface HelpKeyBinding {
  readonly key: string;
  readonly action: string;
}

export interface HelpOverlayProps {
  readonly open: boolean;
  readonly context: string;
  readonly keys: readonly HelpKeyBinding[];
  /** `04` §4.7's own degradation-mode pass (`PLAN-M9.md` P15) found this component never accepted a
   * `mode` prop at all -- an unconditional `borderStyle="round"` (real Unicode box-drawing characters)
   * and a hardcoded em dash (`—`) both rendered regardless of `RenderMode.ascii`. Added to close it,
   * using `<Pane>` (P2)'s own already-established `single`/`classic` border convention for consistency. */
  readonly mode: Pick<RenderMode, 'ascii'>;
}

export function HelpOverlay({ open, context, keys, mode }: HelpOverlayProps): JSX.Element {
  if (!open) return <></>;

  const separator = mode.ascii ? '-' : '—';

  return (
    <Box flexDirection="column" borderStyle={mode.ascii ? 'classic' : 'round'} paddingX={1}>
      <Text bold>{context}</Text>
      {keys.map((binding) => (
        <Text key={binding.key}>
          {binding.key} {separator} {binding.action}
        </Text>
      ))}
    </Box>
  );
}
