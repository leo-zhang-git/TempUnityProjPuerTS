import { useCallback, useMemo, useRef, useState } from "react";

export interface SerializedDocumentState<T> {
  readonly source: T;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly commit: (updater: (source: T) => T) => void;
  readonly beginTransient: () => void;
  readonly updateTransient: (updater: (source: T) => T) => void;
  readonly endTransient: () => void;
  readonly cancelTransient: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly replace: (source: T) => void;
  readonly markSaved: (source: T) => void;
}

export function useSerializedDocumentState<T>(
  initial: T,
  serialize: (source: T) => string,
  initialSaved: T = initial,
): SerializedDocumentState<T> {
  const [source, setSource] = useState(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const [saved, setSaved] = useState(serialize(initialSaved));
  const transientStart = useRef<T | null>(null);

  const commit = useCallback(
    (updater: (source: T) => T) => {
      setSource((current) => {
        const next = updater(structuredClone(current));
        if (serialize(next) === serialize(current)) return current;
        setPast((items) => [...items.slice(-99), current]);
        setFuture([]);
        return next;
      });
    },
    [serialize],
  );

  const beginTransient = useCallback(() => {
    setSource((current) => {
      transientStart.current = current;
      return current;
    });
  }, []);

  const updateTransient = useCallback((updater: (source: T) => T) => {
    setSource((current) => updater(structuredClone(current)));
  }, []);

  const endTransient = useCallback(() => {
    setSource((current) => {
      const start = transientStart.current;
      transientStart.current = null;
      if (!start || serialize(start) === serialize(current)) return current;
      setPast((items) => [...items.slice(-99), start]);
      setFuture([]);
      return current;
    });
  }, [serialize]);

  const cancelTransient = useCallback(() => {
    setSource((current) => {
      const start = transientStart.current;
      transientStart.current = null;
      return start ?? current;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setSource((current) => {
        setFuture((futureItems) => [current, ...futureItems].slice(0, 100));
        return previous;
      });
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setSource((current) => {
        setPast((pastItems) => [...pastItems.slice(-99), current]);
        return next;
      });
      return items.slice(1);
    });
  }, []);

  const replace = useCallback(
    (next: T) => {
      setSource(next);
      setPast([]);
      setFuture([]);
      setSaved(serialize(next));
      transientStart.current = null;
    },
    [serialize],
  );

  const markSaved = useCallback(
    (next: T) => {
      setSource(next);
      setSaved(serialize(next));
    },
    [serialize],
  );

  return useMemo(
    () => ({
      source,
      dirty: serialize(source) !== saved,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      commit,
      beginTransient,
      updateTransient,
      endTransient,
      cancelTransient,
      undo,
      redo,
      replace,
      markSaved,
    }),
    [
      source,
      saved,
      past.length,
      future.length,
      commit,
      beginTransient,
      updateTransient,
      endTransient,
      cancelTransient,
      undo,
      redo,
      replace,
      markSaved,
      serialize,
    ],
  );
}
