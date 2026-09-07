import { describe, expect, it } from 'vitest';
import { docHasEdits } from './persistence';
import { emptyDoc, makeEvent, parseShowDoc, serializeShowDoc, withKey } from './show-doc';
import { parseAnalysis, seedShowDoc } from './seed';
import analysisJson from '../../public/show/fluids.analysis.json';

const analysis = parseAnalysis(analysisJson)!;

describe('docHasEdits', () => {
  it('no ve ediciones en un documento vacío', () => {
    expect(docHasEdits(emptyDoc())).toBe(false);
  });

  it('ve una curva escrita, un evento o un gesto', () => {
    const withCurve = emptyDoc();
    withCurve.curves.gravity = withKey(withCurve.curves.gravity, { t: 1, v: 0.5, shape: 'linear' });
    expect(docHasEdits(withCurve)).toBe(true);

    const withEvent = emptyDoc();
    withEvent.events = [makeEvent('flash', 3)];
    expect(docHasEdits(withEvent)).toBe(true);

    const withGesture = emptyDoc();
    withGesture.gestures = [{
      id: 'g', t0: 0, t1: 1, mode: 'drag', radius: 0.1, strength: 1,
      samples: [{ t: 0, x: 0.5, y: 0.5 }],
    }];
    expect(docHasEdits(withGesture)).toBe(true);
  });

  it('ve el documento sembrado como editable, para pedir confirmación', () => {
    expect(docHasEdits(seedShowDoc(analysis))).toBe(true);
  });
});

describe('round-trip de exportar e importar', () => {
  it('devuelve un documento idéntico', () => {
    const doc = seedShowDoc(analysis);
    doc.gestures = [{
      id: 'g', t0: 12, t1: 14, mode: 'vortex', radius: 0.12, strength: 1.4,
      samples: [{ t: 0, x: 0.2, y: 0.4 }, { t: 2, x: 0.7, y: 0.6 }],
    }];
    const text = serializeShowDoc(doc);
    expect(parseShowDoc(text, doc.duration)).toEqual(doc);
    // Y sobrevive una segunda vuelta, que es lo que pasa con el autosave.
    expect(parseShowDoc(serializeShowDoc(parseShowDoc(text, doc.duration)), doc.duration))
      .toEqual(doc);
  });

  it('sobrevive a un archivo truncado sin tirar la página', () => {
    const text = serializeShowDoc(seedShowDoc(analysis));
    const doc = parseShowDoc(text.slice(0, Math.floor(text.length / 2)));
    expect(doc.version).toBe(1);
    expect(doc.events).toEqual([]);
  });
});
