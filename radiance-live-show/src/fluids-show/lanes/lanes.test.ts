import { describe, expect, it } from 'vitest';
import { packRows } from './EventLane';
import { nextShape } from './CurveLane';
import { tickLabel } from './lane-canvas';
import { makeEvent, type ShowEvent } from '../show-doc';

const event = (t: number, dur: number, id: string): ShowEvent => ({
  ...makeEvent('flash', t), id, dur,
});

describe('packRows', () => {
  it('deja en la primera fila lo que no se solapa', () => {
    const rows = packRows([event(0, 1, 'a'), event(2, 1, 'b'), event(4, 1, 'c')]);
    expect([...rows.values()]).toEqual([0, 0, 0]);
  });

  it('apila lo solapado y vuelve a la primera fila cuando se libera', () => {
    const rows = packRows([
      event(0, 5, 'a'),
      event(1, 5, 'b'),
      event(2, 5, 'c'),
      event(20, 1, 'd'),
    ]);
    expect(rows.get('a')).toBe(0);
    expect(rows.get('b')).toBe(1);
    expect(rows.get('c')).toBe(2);
    expect(rows.get('d')).toBe(0);
  });

  it('amontona en la última fila cuando se acaban', () => {
    const rows = packRows([0, 1, 2, 3, 4].map((index) => event(index, 10, `e${index}`)));
    expect(rows.get('e3')).toBe(2);
    expect(rows.get('e4')).toBe(2);
  });

  it('no depende del orden de entrada', () => {
    const events = [event(4, 1, 'c'), event(0, 5, 'a'), event(1, 5, 'b')];
    const rows = packRows(events);
    expect(rows.get('a')).toBe(0);
    expect(rows.get('b')).toBe(1);
  });
});

describe('nextShape', () => {
  it('cicla lineal -> suave -> sostenida -> lineal', () => {
    expect(nextShape('linear')).toBe('smooth');
    expect(nextShape('smooth')).toBe('hold');
    expect(nextShape('hold')).toBe('linear');
  });
});

describe('tickLabel', () => {
  it('ajusta los decimales al zoom', () => {
    // Las marcas caen en múltiplos del paso, así que redondear es correcto.
    expect(tickLabel(80, 20)).toBe('1:20');
    expect(tickLabel(83.88, 20)).toBe('1:24');
    expect(tickLabel(83.88, 1)).toBe('1:23.9');
    expect(tickLabel(83.88, 0.05)).toBe('1:23.88');
    expect(tickLabel(5, 20)).toBe('0:05');
    expect(tickLabel(5, 0.5)).toBe('0:05.0');
  });
});
