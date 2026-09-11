/**
 * `createStore` — `04` §4.6's own "hand-rolled ~80 LOC reducer store... do not pull in Redux." A plain,
 * generic `state + pure reducer` container: `getState`/`subscribe`/`dispatch`, nothing else.
 *
 * A subscriber is notified only when `reduce` returns a genuinely different state, checked via
 * `Object.is` — **the reducer itself, not this store, is responsible for returning the identical prior
 * state reference when an event changes nothing**, the same "no-op means no new object" discipline a
 * pure reducer needs regardless of the container around it. A reducer that always allocates a new
 * object on every call defeats this store's own "no redundant re-renders" guarantee silently; recorded
 * here as the real contract, not assumed obvious.
 *
 * `dispatch()` refuses a *re-entrant* call — one made from inside a listener that is itself still being
 * notified by an outer, still-in-progress `dispatch()` — with a real, typed error, rather than allowing
 * it to run. A final critic round reproduced directly that allowing it silently corrupts delivery for
 * every listener still pending in the *outer* dispatch's own loop: `dispatch()`'s per-listener loop
 * calls `listener(state)`, reading the shared closure variable at call time, not a value captured once
 * per dispatch -- a listener that itself calls `dispatch()` again mutates that same shared variable out
 * from under the outer loop, so every listener registered after the re-entrant one silently observes
 * the *inner* dispatch's own final state instead of the outer one's, some skipped entirely, others
 * notified twice with the same value. This is the identical, well-established hazard real Redux itself
 * refuses for the same reason ("Reducers may not dispatch actions") -- mirrored here without pulling in
 * the library, matching this file's own "hand-rolled... do not pull in Redux" mandate. A caller that
 * genuinely needs to react to a state change by dispatching again must defer it (e.g. a microtask),
 * exactly the same discipline Redux itself requires of its own callers.
 *
 * @see specs/04 §4.6
 * @see PLAN-M9.md P1
 */
export interface TuiStore<S, E> {
  getState(): S;
  /** Returns an unsubscribe function — the same `() => void` convention `EngineClient.subscribe`
   * (`engine-client.ts`) and every other subscription surface in this package share. */
  subscribe(listener: (state: S) => void): () => void;
  /** Throws a real `AggregateError` (never silently swallowed) if one or more listeners threw while
   * handling this dispatch — see this file's own top doc comment for why every listener still runs
   * regardless, and why every thrown error is preserved, not just the first. Throws a plain, typed
   * `Error` instead, before any listener runs at all, if called re-entrantly from inside a listener
   * still being notified by an outer, in-progress `dispatch()` — see this file's own top doc comment. */
  dispatch(event: E): void;
}

export function createStore<S, E>(initial: S, reduce: (state: S, event: E) => S): TuiStore<S, E> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();
  let isDispatching = false;

  return {
    getState(): S {
      return state;
    },
    subscribe(listener: (state: S) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(event: E): void {
      if (isDispatching) {
        throw new Error(
          'createStore: dispatch() was called re-entrantly, from inside a listener still being ' +
            'notified by an outer, in-progress dispatch(). Defer the nested dispatch (e.g. a microtask) ' +
            'instead of calling it synchronously from within a listener.',
        );
      }
      const next = reduce(state, event);
      if (Object.is(next, state)) return;
      state = next;
      isDispatching = true;
      // Each listener is isolated in its own `try`/`catch`: a fresh critic round reproduced directly
      // that one throwing listener (a buggy pane's own render) silently stopped every listener after
      // it in iteration order from ever seeing this dispatch's own new state, and propagated out of
      // `dispatch()` itself to whatever engine code called it -- a real, reachable bug in one screen
      // breaking every other screen's own subscription, not merely that one screen. Every listener
      // still runs regardless. A second, later critic round found the first fix's own "re-throw only
      // the first error" design silently discarded every error *after* the first forever, with no
      // channel anywhere to ever learn a second, independent listener was also broken -- a real
      // regression against this same comment's own "never silently swallowed" claim. Every thrown
      // error is now collected and re-thrown together, once, as a single, real `AggregateError`, once
      // every listener has run -- nothing is ever discarded, and the single, synchronous `throw`
      // contract callers already need to handle (per `dispatch()`'s own public JSDoc) does not grow a
      // second shape depending on how many listeners happened to be broken.
      const errors: unknown[] = [];
      try {
        for (const listener of listeners) {
          try {
            listener(state);
          } catch (error) {
            errors.push(error);
          }
        }
      } finally {
        // Reset before the AggregateError below is ever thrown -- a caller catching it and dispatching
        // again immediately afterward is a perfectly ordinary recovery, not itself a re-entrant call.
        isDispatching = false;
      }
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          `${String(errors.length)} store listener(s) threw while handling a dispatch`,
        );
      }
    },
  };
}
