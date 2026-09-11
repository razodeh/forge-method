/**
 * `<KeyValue>` -- `04` §4.5's own aligned two-column metadata display.
 *
 * @see specs/04 §4.5
 * @see PLAN-M9.md P2
 */
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { KeyValue } from '../../src/components/key-value.tsx';

describe('KeyValue', () => {
  it('pads every key to the width of the widest key in the same rows array', () => {
    const { lastFrame } = render(
      <KeyValue
        rows={[
          { key: 'id', value: '42' },
          { key: 'status', value: 'running' },
        ]}
      />,
    );
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines[0]).toBe('id     42');
    expect(lines[1]).toBe('status running');
  });

  it('renders nothing for an empty rows array', () => {
    const { lastFrame } = render(<KeyValue rows={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('renders a single row with no padding needed', () => {
    const { lastFrame } = render(<KeyValue rows={[{ key: 'name', value: 'acme-billing' }]} />);
    expect(lastFrame()).toBe('name acme-billing');
  });

  it('aligns the value column by terminal display width, not UTF-16 code-unit length -- a fresh critic round reproduced a full-width key throwing off a plain .length-based pad', () => {
    const { lastFrame } = render(
      <KeyValue
        rows={[
          { key: '日本語', value: 'wide' },
          { key: 'id', value: 'short' },
        ]}
      />,
    );
    const lines = (lastFrame() ?? '').split('\n');
    // '日本語' is 3 code units but 6 terminal columns; 'id' is 2 columns, so it needs 4 more spaces
    // of padding than a naive .length-based pad (which would only add 1) to reach the same 6-column
    // width the first row's own key occupies.
    expect(lines[0]).toBe('日本語 wide');
    expect(lines[1]).toBe('id     short');
  });
});
