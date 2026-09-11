/**
 * `createStore` — `04` §4.6's own hand-rolled reducer store.
 *
 * @see specs/04 §4.6
 * @see PLAN-M9.md P1
 */
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '../../src/state/store.ts';

describe('createStore', () => {
  it('getState returns the initial state before any dispatch', () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    expect(store.getState()).toBe(0);
  });

  it('dispatch folds an event through the reducer and updates getState', () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    store.dispatch(5);
    expect(store.getState()).toBe(5);
    store.dispatch(3);
    expect(store.getState()).toBe(8);
  });

  it('a subscriber is notified with the new state on a genuine change', () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(5);
    expect(listener).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('a reducer that returns the identical state reference (a real no-op) notifies no subscriber at all', () => {
    const store = createStore(0, (state: number) => state);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch(1);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toBe(0);
  });

  it('unsubscribe stops further notifications without affecting other subscribers', () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = store.subscribe(a);
    store.subscribe(b);
    store.dispatch(1);
    unsubscribeA();
    store.dispatch(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('multiple subscribers are all notified, in subscription order, on the same dispatch', () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    const calls: string[] = [];
    store.subscribe(() => calls.push('first'));
    store.subscribe(() => calls.push('second'));
    store.dispatch(1);
    expect(calls).toEqual(['first', 'second']);
  });

  it("a throwing subscriber never stops delivery to the subscribers after it -- a fresh critic round found the original draft let one bad listener silently drop every later one's own update", () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    const seenByThird: number[] = [];
    store.subscribe(() => {
      throw new Error('first subscriber has a real bug');
    });
    store.subscribe(() => {
      throw new Error('second subscriber has a real bug too');
    });
    store.subscribe((state) => {
      seenByThird.push(state);
    });

    let caught: unknown;
    try {
      store.dispatch(5);
    } catch (error) {
      caught = error;
    }
    // The new state was still committed, and the third, non-throwing subscriber still saw it --
    // dispatch() throwing afterward does not mean the update itself was rolled back or skipped.
    expect(store.getState()).toBe(5);
    expect(seenByThird).toEqual([5]);
    // Both real errors survive, not just the first -- a second, later critic round found the original
    // fix's own "re-throw only the first" design silently discarded the second listener's own real bug
    // forever, with nothing anywhere a caller could ever learn it existed.
    if (!(caught instanceof AggregateError)) throw new Error('expected an AggregateError');
    expect(caught.errors).toHaveLength(2);
    expect((caught.errors[0] as Error).message).toBe('first subscriber has a real bug');
    expect((caught.errors[1] as Error).message).toBe('second subscriber has a real bug too');
  });

  it("dispatch() called re-entrantly from inside a listener throws a real, typed error rather than corrupting delivery to listeners still pending in the outer dispatch's own loop -- a final critic round reproduced that letting it through silently skips/duplicates state for later listeners", () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    const seenByB: number[] = [];
    const seenByC: number[] = [];
    let reentrantError: unknown;
    store.subscribe((state) => {
      seenByB.push(state);
      try {
        store.dispatch(100);
      } catch (error) {
        reentrantError = error;
      }
    });
    store.subscribe((state) => {
      seenByC.push(state);
    });

    store.dispatch(1);

    expect(reentrantError).toBeInstanceOf(Error);
    expect((reentrantError as Error).message).toMatch(/re-entrantly/);
    // The re-entrant dispatch never ran at all -- state reflects only the one, real outer dispatch.
    expect(store.getState()).toBe(1);
    expect(seenByB).toEqual([1]);
    // C, registered after B, saw the outer dispatch's own real value exactly once -- never skipped,
    // never duplicated, never shown the rejected re-entrant call's own value.
    expect(seenByC).toEqual([1]);
  });

  it('a caller may dispatch again immediately after catching an AggregateError from a previous dispatch -- that is an ordinary, sequential recovery, never itself treated as re-entrant', () => {
    const store = createStore(0, (state: number, event: number) => state + event);
    store.subscribe(() => {
      throw new Error('a real bug');
    });

    expect(() => {
      store.dispatch(1);
    }).toThrow(AggregateError);
    // A second, ordinary, sequential dispatch (not called from inside a listener) succeeds normally.
    expect(() => {
      store.dispatch(1);
    }).toThrow(AggregateError);
    expect(store.getState()).toBe(2);
  });
});
