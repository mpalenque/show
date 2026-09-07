import { describe, expect, it } from 'vitest';
import { EMPTY_AUDIO, createDefaultShow } from '../core/manifest';
import { AutoShowDirector } from './AutoShowDirector';
import { DirectorOverlayMixer } from './DirectorOverlayMixer';

describe('AutoShowDirector', () => {
  it('is an exact pass-through while manual', () => {
    const show = createDefaultShow();
    show.scene = 'voronoi';
    show.scenes.voronoi.look = 'mono';
    const cue = new AutoShowDirector().update(show, EMPTY_AUDIO, 20, 1 / 60);
    expect(cue).toMatchObject({ enabled: false, scene: 'voronoi', look: 'mono' });
    expect(cue.parameterTargets).toEqual({});
  });

  it('activates the complete original reactive Fluid subscene', () => {
    const show = createDefaultShow();
    show.automation.enabled = true;
    const cue = new AutoShowDirector().update(show, EMPTY_AUDIO, 0, 1 / 60);
    expect(cue).toMatchObject({ enabled: true, scene: 'fluid', look: 'reactive-original' });
  });

  it('cycles through every top-level engine without mutating manual state', () => {
    const show = createDefaultShow();
    show.automation.enabled = true;
    show.automation.sceneSeconds = 12;
    const before = structuredClone(show);
    const director = new AutoShowDirector();
    expect(director.update(show, EMPTY_AUDIO, 0, 1 / 60).scene).toBe('fluid');
    expect(director.update(show, EMPTY_AUDIO, 12.1, 1 / 60).scene).toBe('blocks');
    expect(director.update(show, EMPTY_AUDIO, 24.2, 1 / 60).scene).toBe('voronoi');
    expect(director.update(show, EMPTY_AUDIO, 36.3, 1 / 60).scene).toBe('depth-sort');
    expect(show).toEqual(before);
  });

  it('lets the operator re-anchor AUTO and restores that manual scene on OFF', () => {
    const show = createDefaultShow();
    show.automation.enabled = true;
    const director = new AutoShowDirector();
    director.update(show, EMPTY_AUDIO, 0, 1 / 60);
    show.scene = 'voronoi';
    expect(director.update(show, EMPTY_AUDIO, 2, 1 / 60).scene).toBe('voronoi');
    show.automation.enabled = false;
    show.scenes.voronoi.look = 'mono';
    expect(director.update(show, EMPTY_AUDIO, 3, 1 / 60)).toMatchObject({
      enabled: false,
      scene: 'voronoi',
      look: 'mono',
    });
  });
});

describe('DirectorOverlayMixer', () => {
  it('never changes action counters and returns the exact base object on OFF', () => {
    const show = createDefaultShow();
    show.automation.enabled = true;
    show.scene = 'blocks';
    const cue = new AutoShowDirector().update(show, { ...EMPTY_AUDIO, running: true, rms: 0.8 }, 1, 1 / 60);
    const base = { density: 0.2, turbulence: 0.1, tension: 0.1, zoom: 1, testNote: 17 };
    const overlay = new DirectorOverlayMixer();
    const automated = overlay.resolve('blocks', base, cue, 1, 1 / 60);
    expect(automated.density).not.toBe(base.density);
    expect(automated.testNote).toBe(17);
    expect(base).toEqual({ density: 0.2, turbulence: 0.1, tension: 0.1, zoom: 1, testNote: 17 });

    show.automation.enabled = false;
    const manualCue = new AutoShowDirector().update(show, EMPTY_AUDIO, 2, 1 / 60);
    expect(overlay.resolve('blocks', base, manualCue, 1, 1 / 60)).toBe(base);
  });
});
