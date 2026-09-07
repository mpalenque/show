import * as THREE from 'three';
import { isWithinEclipseWindow, type EclipseType } from '../simulation/Eclipse';

const SOLAR_COLOR = new THREE.Color(0xffc95c);
const LUNAR_COLOR = new THREE.Color(0xff7a7a);

const setLinePoints = (line: THREE.Line, points: THREE.Vector3[]): void => {
  line.geometry.setFromPoints(points);
};

export interface EclipseGuides {
  group: THREE.Group;
  update: (enabled: boolean, type: EclipseType, moonPosition: THREE.Vector3, alignmentWindowPercent: number) => void;
}

export function createEclipseGuides(scene: THREE.Scene): EclipseGuides {
  const group = new THREE.Group();
  group.visible = false;

  const alignmentMaterial = new THREE.LineBasicMaterial({
    color: SOLAR_COLOR,
    transparent: true,
    opacity: 0.7,
  });

  const shadowPathMaterial = new THREE.LineBasicMaterial({
    color: SOLAR_COLOR,
    transparent: true,
    opacity: 0.55,
  });

  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: 0x8da8ff,
    transparent: true,
    opacity: 0.7,
  });

  const alignmentLine = new THREE.Line(new THREE.BufferGeometry(), alignmentMaterial);
  const shadowPathLine = new THREE.Line(new THREE.BufferGeometry(), shadowPathMaterial);
  const nodeGeometry = new THREE.SphereGeometry(0.14, 18, 18);
  const leadingNode = new THREE.Mesh(nodeGeometry, nodeMaterial);
  const trailingNode = new THREE.Mesh(nodeGeometry, nodeMaterial.clone());

  group.add(alignmentLine, shadowPathLine, leadingNode, trailingNode);
  scene.add(group);

  const update = (enabled: boolean, type: EclipseType, moonPosition: THREE.Vector3, alignmentWindowPercent: number): void => {
    group.visible = enabled;
    if (!enabled) {
      return;
    }

    const guideColor = type === 'solar' ? SOLAR_COLOR : LUNAR_COLOR;
    alignmentMaterial.color.copy(guideColor);
    shadowPathMaterial.color.copy(guideColor);

    const orbitRadius = moonPosition.length();
    const sunCue = new THREE.Vector3(Math.max(orbitRadius + 4, 14), 0, 0);
    const earthPosition = new THREE.Vector3(0, 0, 0);
    const casterPosition = type === 'solar' ? moonPosition.clone() : earthPosition.clone();
    const targetPosition = type === 'solar' ? earthPosition.clone() : moonPosition.clone();

    setLinePoints(alignmentLine, [sunCue, earthPosition, moonPosition.clone()]);
    setLinePoints(shadowPathLine, [casterPosition, targetPosition]);
    shadowPathLine.visible = isWithinEclipseWindow(alignmentWindowPercent);

    leadingNode.position.set(orbitRadius, 0, 0);
    trailingNode.position.set(-orbitRadius, 0, 0);
  };

  return { group, update };
}
