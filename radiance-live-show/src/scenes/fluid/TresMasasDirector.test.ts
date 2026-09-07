import { describe, expect, it } from 'vitest';
import TresMasasDirector, { TRES_MASAS_CUES, TRES_MASAS_MATERIALS } from './TresMasasDirector';

const ASPECT = 8 / 3;

const run = (
  director: TresMasasDirector,
  seconds: number,
  particleCount = 0,
  startNow = 0,
) => {
  const dt = 1 / 60;
  let output = director.update({ dt, now: startNow, aspect: ASPECT, particleCount });
  const steps = Math.round(seconds / dt);
  for (let step = 1; step < steps; step += 1) {
    output = director.update({ dt, now: startNow + step * dt, aspect: ASPECT, particleCount });
  }
  return output;
};

describe('TresMasasDirector', () => {
  it('declares the eighteen sub-scenes and the white/red/blue materials', () => {
    expect(TRES_MASAS_CUES).toHaveLength(18);
    expect(TRES_MASAS_CUES[0]).toEqual({ id: '1A', name: 'LÍNEA' });
    expect(TRES_MASAS_CUES[11].id).toBe('4C');
    expect(TRES_MASAS_CUES[17].id).toBe('5B');
    expect(TRES_MASAS_MATERIALS.colors[0]).toBe(0xffffff);
    expect(TRES_MASAS_MATERIALS.colors[1]).toBe(0xff0000);
    expect(TRES_MASAS_MATERIALS.colors[2]).toBe(0x0000ff);
    expect(TRES_MASAS_MATERIALS.masses[0]).toBeLessThan(TRES_MASAS_MATERIALS.masses[2]);
    expect(TRES_MASAS_MATERIALS.masses[2]).toBeLessThan(TRES_MASAS_MATERIALS.masses[1]);
  });

  it('clears the field on its very first frame and clamps navigation', () => {
    const director = new TresMasasDirector();
    const first = director.update({ dt: 1 / 60, now: 0, aspect: ASPECT, particleCount: 0 });
    expect(first.resetParticles).toEqual([0, 0, 0, 0]);
    const second = director.update({ dt: 1 / 60, now: 1 / 60, aspect: ASPECT, particleCount: 0 });
    expect(second.resetParticles).toBeNull();
    director.prev();
    expect(director.cue).toBe(0);
    for (let step = 0; step < 40; step += 1) director.next();
    expect(director.cue).toBe(TRES_MASAS_CUES.length - 1);
  });

  it('keeps physics finite and geometry bounded in every cue', () => {
    const director = new TresMasasDirector();
    for (let cue = 0; cue < TRES_MASAS_CUES.length; cue += 1) {
      director.setCue(cue);
      const output = run(director, 3, 1200, cue * 40);
      for (const value of Object.values(output.physics)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(output.geometry.length).toBeLessThan(160);
      for (const item of output.geometry) {
        expect(Number.isFinite(item.x)).toBe(true);
        expect(Number.isFinite(item.y)).toBe(true);
        expect(item.w).toBeGreaterThan(0);
        expect(item.h).toBeGreaterThan(0);
      }
      for (const value of Object.values(output.render)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('runs the portal: white first, then red, then blue, always opaque', () => {
    const director = new TresMasasDirector();
    director.setCue(7);
    const dt = 1 / 60;
    const emitted = new Set<number>();
    let sawDrag = false;
    let render: Record<string, number> = {};
    for (let step = 0; step < 60 * 6; step += 1) {
      const output = director.update({ dt, now: step * dt, aspect: ASPECT, particleCount: 0 });
      render = output.render;
      for (const interaction of output.interactions) {
        if (interaction.mode === 'emit') emitted.add(interaction.materialId);
        if (interaction.mode === 'drag') sawDrag = true;
      }
    }
    expect(emitted.has(0)).toBe(true);
    expect(sawDrag).toBe(true);
    // Nothing emits during the portal: the line is the only light.
    expect(render.emissiveMaterial).toBe(3);

    director.setCue(8);
    const emittedLate = new Set<number>();
    for (let step = 0; step < 60 * 12; step += 1) {
      const output = director.update({ dt, now: 400 + step * dt, aspect: ASPECT, particleCount: 0 });
      for (const interaction of output.interactions) {
        if (interaction.mode === 'emit') emittedLate.add(interaction.materialId);
      }
    }
    expect(emittedLate.has(1)).toBe(true);
    expect(emittedLate.has(2)).toBe(true);
    expect(emittedLate.has(3)).toBe(false);
  });

  it('ignites the white lamp and attracts the particles toward it', () => {
    const director = new TresMasasDirector();
    director.setCue(9);
    const output = run(director, 4, 6000, 800);
    expect(output.render.emissiveMaterial).toBe(0);
    expect(output.render.allEmitters).toBe(1);
    expect(output.render.velocityEmission).toBe(1);
    const attract = output.interactions.find((interaction) => interaction.mode === 'attract');
    expect(attract).toBeDefined();
    expect(attract!.strength).toBeGreaterThan(0);
  });

  it('breathes the separate/reunite cycle through cross attraction', () => {
    const director = new TresMasasDirector();
    director.setCue(10);
    const united = run(director, 1.5, 6000, 1200);
    const separated = run(director, 9, 6000, 1210);
    expect(united.physics.differentRestDensity)
      .toBeGreaterThan(separated.physics.differentRestDensity + 2);
  });

  it('pushes the fluid with the light wind during the convergence', () => {
    const director = new TresMasasDirector();
    director.setCue(16);
    const output = run(director, 3, 6000, 1600);
    const winds = output.interactions.filter((interaction) => interaction.mode === 'drag');
    expect(winds.length).toBeGreaterThanOrEqual(3);
    expect(output.render.emissiveMaterial).toBe(1);
  });

  it('runs the vacuum: directional flow through the line, converted glow decays', () => {
    const director = new TresMasasDirector();
    director.setCue(16);
    const dt = 1 / 60;
    let sawDelete = false;
    let vacuumDrags = 0;
    let maxSecondary = 0;
    let secondaryMaterial = -1;
    const spat = new Set<number>();
    for (let step = 0; step < 60 * 12; step += 1) {
      const output = director.update({ dt, now: 5000 + step * dt, aspect: ASPECT, particleCount: 12000 });
      const t = (step + 1) * dt;
      if (t < 8) continue; // primera fase: viento
      for (const interaction of output.interactions) {
        if (interaction.mode === 'delete') sawDelete = true;
        if (interaction.mode === 'drag') vacuumDrags += 1;
        if (interaction.mode === 'emit') spat.add(interaction.materialId);
      }
      const strength = Number(output.render.reactiveSecondaryStrength ?? 0);
      if (strength > maxSecondary) {
        maxSecondary = strength;
        secondaryMaterial = Number(output.render.reactiveSecondaryMaterial);
      }
    }
    // Campo direccional (empujes), no imán puntual.
    expect(vacuumDrags).toBeGreaterThan(60);
    expect(sawDelete).toBe(true);
    expect(spat.size).toBeGreaterThan(0);
    for (const material of spat) expect([0, 1, 2]).toContain(material);
    // El convertido brilla en su propio color aunque la lámpara sea roja.
    expect(maxSecondary).toBeGreaterThan(0.4);
    expect([0, 2]).toContain(secondaryMaterial);

    // Y el brillo decae en ~2 s al frenar la bomba: seguimos hasta pasada la
    // frontera t=16 (vuelve el viento) y unos segundos más de decaimiento.
    let strengthAfter = 1;
    for (let step = 0; step < 60 * 7; step += 1) {
      const output = director.update({ dt, now: 5012 + step * dt, aspect: ASPECT, particleCount: 12000 });
      strengthAfter = Number(output.render.reactiveSecondaryStrength ?? 0);
    }
    expect(strengthAfter).toBeLessThan(0.1);
  });

  it('fills the swarm while it is sparse and stops at the target density', () => {
    const director = new TresMasasDirector();
    director.setCue(11);
    const dt = 1 / 60;
    let emitted = 0;
    for (let step = 0; step < 60 * 4; step += 1) {
      const output = director.update({ dt, now: 2000 + step * dt, aspect: ASPECT, particleCount: 2000 });
      for (const interaction of output.interactions) {
        if (interaction.mode === 'emit') emitted += interaction.emitCount;
      }
    }
    expect(emitted).toBeGreaterThan(1000);
    // Blobs, not soup: cohesión propia alta, cruce mínimo, lámpara blanca.
    const settled = run(director, 2, 14000, 2600);
    expect(settled.physics.sameRestDensity).toBeGreaterThan(9);
    expect(settled.physics.differentRestDensity).toBeLessThan(3);
    expect(settled.render.emissiveMaterial).toBe(0);
    const full = director.update({ dt, now: 2700, aspect: ASPECT, particleCount: 20000 });
    expect(full.interactions.some((interaction) => interaction.mode === 'emit')).toBe(false);
  });

  it('drifts the blobs with orbiting attractors and cycles the lamp in mutation', () => {
    const director = new TresMasasDirector();
    director.setCue(12);
    const drift = run(director, 2, 14000, 3000);
    const attractors = drift.interactions.filter((interaction) => interaction.mode === 'attract');
    expect(attractors.length).toBe(4);

    director.setCue(13);
    const early = run(director, 2, 14000, 3100);
    expect(early.render.emissiveMaterial).toBe(0);
    const later = run(director, 6, 14000, 3200);
    expect(later.render.emissiveMaterial).toBe(1);
  });
});
