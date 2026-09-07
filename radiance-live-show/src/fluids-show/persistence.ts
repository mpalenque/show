import {
  CURVE_IDS,
  parseShowDoc,
  serializeShowDoc,
  type ShowDoc,
} from './show-doc';

/**
 * Persistencia del documento de show.
 *
 * Tres orígenes, en este orden: lo que quedó en el navegador, el JSON
 * commiteado en `public/show/` y, si no hay ninguno, un documento vacío. Es la
 * misma escalera que usa la página de Tres Masas para sus ajustes, con el
 * mismo criterio: un snapshot dañado nunca puede impedir que el show arranque.
 */

export const SHOW_STORAGE_KEY = 'radiance-fluids-show-doc-v1';
/** JSON del show maduro, commiteado para que la página arranque con él. */
export const SHIPPED_SHOW_PATH = '/show/fluids.show.json';
export const EXPORT_FILENAME = 'fluids.show.json';

/** ¿Hay algo que el operador haya escrito y que sembrar pisaría? */
export const docHasEdits = (doc: ShowDoc): boolean => (
  doc.events.length > 0
  || doc.gestures.length > 0
  || CURVE_IDS.some((id) => doc.curves[id].keys.length > 0)
);

export const loadStoredDoc = (duration?: number): ShowDoc | null => {
  try {
    const raw = localStorage.getItem(SHOW_STORAGE_KEY);
    if (!raw) return null;
    return parseShowDoc(raw, duration);
  } catch {
    // Storage puede estar deshabilitado; la página tiene que seguir viva.
    return null;
  }
};

export const saveStoredDoc = (doc: ShowDoc): void => {
  try {
    localStorage.setItem(SHOW_STORAGE_KEY, serializeShowDoc(doc));
  } catch {
    // Cuota llena o storage bloqueado: se pierde el autosave, no el show.
  }
};

export const clearStoredDoc = (): void => {
  try {
    localStorage.removeItem(SHOW_STORAGE_KEY);
  } catch {
    // Ídem.
  }
};

/** El show commiteado, si existe. Que falte es normal hasta que madure. */
export const fetchShippedDoc = async (duration?: number): Promise<ShowDoc | null> => {
  try {
    const response = await fetch(SHIPPED_SHOW_PATH);
    if (!response.ok) return null;
    return parseShowDoc(await response.json(), duration);
  } catch {
    return null;
  }
};

/** Descarga el documento como archivo, para commitearlo o guardarlo aparte. */
export const downloadDoc = (doc: ShowDoc, filename = EXPORT_FILENAME): void => {
  const blob = new Blob([serializeShowDoc(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revocar en el próximo turno: revocar en el mismo cancela la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const readDocFile = async (file: File, duration?: number): Promise<ShowDoc> => (
  parseShowDoc(await file.text(), duration)
);
