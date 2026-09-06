/**
 * The shared `renderFlowchart`/`renderErDiagram`/`renderSequenceDiagram` primitives, tested directly
 * for the edge cases no single generator's own golden test happens to exercise.
 *
 * @see PLAN-M3.md P3
 */
import { isForgeError } from '@forge/core';
import { describe, expect, it } from 'vitest';

import {
  renderErDiagram,
  renderFlowchart,
  renderSequenceDiagram,
  VALID_ER_CARDINALITIES,
  type ErCardinality,
} from '../../src/index.ts';

describe('renderFlowchart', () => {
  it('renders an edge with an explicit empty-string label as a plain arrow', () => {
    const source = renderFlowchart(
      [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' },
      ],
      [{ from: 'A', to: 'B', label: '' }],
    );
    expect(source).toBe(['flowchart TB', '  A["A"]', '  B["B"]', '  A --> B'].join('\n'));
  });

  it('sanitizes an id containing characters invalid in an unquoted Mermaid identifier', () => {
    const source = renderFlowchart([{ id: 'component:api', label: 'API' }], []);
    expect(source).toContain('component_api["API"]');
  });

  it('replaces an embedded double-quote in a label with an apostrophe', () => {
    const source = renderFlowchart([{ id: 'A', label: 'The "Main" Service' }], []);
    expect(source).toContain(`A["The 'Main' Service"]`);
  });

  it('breaks ties between edges sharing the same from/to by label, in either direction', () => {
    const nodes = [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
    ];
    const scrambled = renderFlowchart(nodes, [
      { from: 'A', to: 'B', label: 'second' },
      { from: 'A', to: 'B' },
      { from: 'A', to: 'B', label: 'first' },
    ]);
    expect(scrambled.split('\n').slice(3)).toEqual([
      '  A --> B',
      '  A -->|first| B',
      '  A -->|second| B',
    ]);
  });
});

describe('renderErDiagram', () => {
  it('omits the attribute block entirely for an entity with no attributes', () => {
    const source = renderErDiagram([{ name: 'Ghost' }], []);
    expect(source).toBe('erDiagram');
  });

  it('honours an explicit, non-default cardinality', () => {
    const source = renderErDiagram(
      [],
      [{ from: 'A', to: 'B', label: 'has', cardinality: '||--||' }],
    );
    expect(source).toContain('A ||--|| B : has');
  });

  it('rejects a cardinality outside the 16 valid crow’s-foot combinations with KB-002', () => {
    // The type closes this for a caller with real type-checking; `runGenerator`'s `unknown`-typed
    // dynamic dispatch does not, so the cast below simulates exactly that boundary.
    const badCardinality = 'not-a-real-one' as unknown as ErCardinality;
    let thrown: unknown;
    try {
      renderErDiagram([], [{ from: 'A', to: 'B', label: 'has', cardinality: badCardinality }]);
    } catch (error) {
      thrown = error;
    }
    expect(isForgeError(thrown) && thrown.code === 'KB-002').toBe(true);
  });

  it('sorts a scrambled entity list into alphabetical order', () => {
    const source = renderErDiagram(
      [
        { name: 'Zebra', attributes: ['id'] },
        { name: 'Apple', attributes: ['id'] },
        { name: 'Mango', attributes: ['id'] },
      ],
      [],
    );
    const entityLines = source.split('\n').filter((line) => line.endsWith(' {'));
    expect(entityLines).toEqual(['  Apple {', '  Mango {', '  Zebra {']);
  });

  it('breaks ties between relationships sharing the same from/to by label, in either direction', () => {
    const source = renderErDiagram(
      [],
      [
        { from: 'A', to: 'B', label: 'second' },
        { from: 'A', to: 'B', label: 'first' },
      ],
    );
    expect(source.split('\n')).toEqual([
      'erDiagram',
      '  A ||--o{ B : first',
      '  A ||--o{ B : second',
    ]);
  });
});

describe('renderSequenceDiagram', () => {
  it('renders an empty step list as a bare sequenceDiagram header', () => {
    expect(renderSequenceDiagram([])).toBe('sequenceDiagram');
  });

  it('omits the title line when no title is given', () => {
    expect(renderSequenceDiagram([{ from: 'A', to: 'B', message: 'hi' }])).toBe(
      ['sequenceDiagram', '  participant A as A', '  participant B as B', '  A->>B: hi'].join('\n'),
    );
  });

  it('omits the title line when title is an empty string', () => {
    expect(renderSequenceDiagram([], '')).toBe('sequenceDiagram');
  });

  it('sanitizes a participant id while keeping its real name as the displayed alias', () => {
    const source = renderSequenceDiagram([{ from: 'end', to: 'end', message: 'loop' }]);
    expect(source).toBe(
      ['sequenceDiagram', '  participant n_end as end', '  n_end->>n_end: loop'].join('\n'),
    );
  });

  it('keeps two colliding participant names distinguishable in their own aliases', () => {
    const source = renderSequenceDiagram([
      { from: 'component-api', to: 'component_api', message: 'hi' },
    ]);
    expect(source).toBe(
      [
        'sequenceDiagram',
        '  participant component_api as component-api',
        '  participant component_api_2 as component_api',
        '  component_api->>component_api_2: hi',
      ].join('\n'),
    );
  });
});

describe('VALID_ER_CARDINALITIES', () => {
  it('contains every one of the 16 real crow’s-foot combinations, and nothing else', () => {
    expect(VALID_ER_CARDINALITIES.size).toBe(16);
    expect(VALID_ER_CARDINALITIES.has('||--o{')).toBe(true);
    expect(VALID_ER_CARDINALITIES.has('}o--|{')).toBe(true);
    expect(VALID_ER_CARDINALITIES.has('not-a-real-one')).toBe(false);
  });
});
