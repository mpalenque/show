import * as THREE from 'three';
import { dayToPhaseAngle, getPhaseInfo, type PhaseInfo } from './MoonPhase';
import { ECLIPSE_ORBIT_INCLINATION_DEG } from './Eclipse';

const READABLE_ORBIT_RADIUS = 10;
const REALISTIC_ORBIT_RADIUS = 60;

const buildOrbitGeometry = (radius: number, inclinationDeg: number): THREE.BufferGeometry => {
  const points: THREE.Vector3[] = [];
  const segments = 128;
  const inclinationRad = THREE.MathUtils.degToRad(inclinationDeg);

  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const x = Math.cos(t) * radius;
    const baseZ = Math.sin(t) * radius;
    const y = -baseZ * Math.sin(inclinationRad);
    const z = baseZ * Math.cos(inclinationRad);
    points.push(new THREE.Vector3(x, y, z));
  }

  return new THREE.BufferGeometry().setFromPoints(points);
};

export interface OrbitalSystem {
  pivot: THREE.Group;
  orbitLine: THREE.Line;
  setDay: (day: number) => PhaseInfo;
  setRealisticScale: (realistic: boolean) => void;
  setEclipseTilt: (enabled: boolean) => void;
}

export function createOrbitalSystem(moon: THREE.Mesh): OrbitalSystem {
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, 0);

  const orbitMaterial = new THREE.LineBasicMaterial({
    color: 0x334466,
    transparent: true,
    opacity: 0.3,
  });

  let currentRadius = READABLE_ORBIT_RADIUS;
  let currentInclination = 0;
  let currentDay = 0;
  const orbitLine = new THREE.Line(buildOrbitGeometry(currentRadius, currentInclination), orbitMaterial);
  moon.position.set(currentRadius, 0, 0);
  pivot.add(moon);

  const syncMoonPosition = (): void => {
    const phaseAngle = THREE.MathUtils.degToRad(dayToPhaseAngle(currentDay));
    const inclinationRad = THREE.MathUtils.degToRad(currentInclination);
    const x = Math.cos(-phaseAngle) * currentRadius;
    const baseZ = Math.sin(-phaseAngle) * currentRadius;
    const y = -baseZ * Math.sin(inclinationRad);
    const z = baseZ * Math.cos(inclinationRad);
    moon.position.set(x, y, z);
  };

  const syncOrbitGeometry = (): void => {
    const previousGeometry = orbitLine.geometry;
    orbitLine.geometry = buildOrbitGeometry(currentRadius, currentInclination);
    previousGeometry.dispose();
  };

  const setDay = (day: number): PhaseInfo => {
    currentDay = day;
    syncMoonPosition();
    return getPhaseInfo(day);
  };

  const setRealisticScale = (realistic: boolean): void => {
    const nextRadius = realistic ? REALISTIC_ORBIT_RADIUS : READABLE_ORBIT_RADIUS;
    if (nextRadius === currentRadius) {
      return;
    }

    currentRadius = nextRadius;
    syncMoonPosition();
    syncOrbitGeometry();
  };

  const setEclipseTilt = (enabled: boolean): void => {
    const nextInclination = enabled ? ECLIPSE_ORBIT_INCLINATION_DEG : 0;
    if (Math.abs(nextInclination - currentInclination) < 0.001) {
      return;
    }

    currentInclination = nextInclination;
    syncMoonPosition();
    syncOrbitGeometry();
  };

  return { pivot, orbitLine, setDay, setRealisticScale, setEclipseTilt };
}
