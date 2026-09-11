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

export interface HelpKeyBinding {
  readonly key: string;
  readonly action: string;
}

export interface HelpOverlayProps {
  readonly open: boolean;
  readonly context: string;
  readonly keys: readonly HelpKeyBinding[];
}

export function HelpOverlay({ open, context, keys }: HelpOverlayProps): JSX.Element {
  if (!open) return <></>;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{context}</Text>
      {keys.map((binding) => (
        <Text key={binding.key}>
          {binding.key} — {binding.action}
        </Text>
      ))}
    </Box>
  );
}
