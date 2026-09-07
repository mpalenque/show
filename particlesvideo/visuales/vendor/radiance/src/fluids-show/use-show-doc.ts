import { useCallback, useRef, useState } from 'react';
import { emptyDoc, parseShowDoc, serializeShowDoc, type ShowDoc } from './show-doc';

/**
 * El documento de show vivo, con su pila de deshacer.
 *
 * El doc se guarda en un ref y la escena lo recibe por referencia, así que
 * editar una curva se ve en el preview sin reiniciar nada; `version` existe
 * sólo para que las lanes sepan que tienen que redibujarse.
 *
 * Deshacer usa snapshots serializados: el documento es chico (unas decenas de
 * KB con el show entero sembrado) y clonar es más simple y más difícil de
 * romper que registrar operaciones inversas.
 */

/** Ventana de fusión: un arrastre entero es un solo paso de deshacer. */
const COALESCE_MS = 500;
const MAX_HISTORY = 80;

export interface ShowDocStore {
  doc: ShowDoc;
  version: number;
  /** Edición normal: fusiona los cambios seguidos en un solo paso. */
  mutate: (produce: (doc: ShowDoc) => ShowDoc) => void;
  /** Reemplazo completo (sembrar, importar): siempre su propio paso. */
  replace: (next: ShowDoc) => void;
  /** Carga inicial: adopta el documento sin dejar historia que deshacer. */
  adopt: (next: ShowDoc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const useShowDoc = (initial?: ShowDoc): ShowDocStore => {
  const docRef = useRef<ShowDoc>(initial ?? emptyDoc());
  const [version, setVersion] = useState(0);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPushAt = useRef(-Infinity);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });

  const syncCounts = useCallback(() => {
    setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  }, []);

  const push = useCallback((coalesce: boolean) => {
    const now = performance.now();
    if (coalesce && now - lastPushAt.current < COALESCE_MS) {
      lastPushAt.current = now;
      return;
    }
    lastPushAt.current = now;
    undoStack.current.push(serializeShowDoc(docRef.current));
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current.length = 0;
  }, []);

  const mutate = useCallback((produce: (doc: ShowDoc) => ShowDoc) => {
    push(true);
    docRef.current = produce(docRef.current);
    setVersion((value) => value + 1);
    syncCounts();
  }, [push, syncCounts]);

  const replace = useCallback((next: ShowDoc) => {
    push(false);
    docRef.current = next;
    setVersion((value) => value + 1);
    syncCounts();
  }, [push, syncCounts]);

  const adopt = useCallback((next: ShowDoc) => {
    undoStack.current.length = 0;
    redoStack.current.length = 0;
    lastPushAt.current = -Infinity;
    docRef.current = next;
    setVersion((value) => value + 1);
    syncCounts();
  }, [syncCounts]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (previous === undefined) return;
    redoStack.current.push(serializeShowDoc(docRef.current));
    docRef.current = parseShowDoc(previous, docRef.current.duration);
    lastPushAt.current = -Infinity;
    setVersion((value) => value + 1);
    syncCounts();
  }, [syncCounts]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(serializeShowDoc(docRef.current));
    docRef.current = parseShowDoc(next, docRef.current.duration);
    lastPushAt.current = -Infinity;
    setVersion((value) => value + 1);
    syncCounts();
  }, [syncCounts]);

  return {
    doc: docRef.current,
    version,
    mutate,
    replace,
    adopt,
    undo,
    redo,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
  };
};
