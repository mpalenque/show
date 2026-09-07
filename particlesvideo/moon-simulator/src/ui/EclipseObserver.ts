import * as THREE from 'three';
import { simulationStore } from '../main';
import { getEclipseInfo } from '../simulation/Eclipse';
import { createCoronaMaterial, type CoronaMaterial } from '../scene/CoronaShader';
import { MOON_TEXTURE_URL } from '../scene/Moon';
import { i18n, t } from '../i18n/i18n';

const OBSERVER_SIZE = 200;
const ORTHO_FRUSTUM = 3;
const STAR_COUNT = 200;

const MOON_NORMAL_COLOR = new THREE.Color(0.45, 0.45, 0.45);
const MOON_BLOOD_COLOR = new THREE.Color(0.55, 0.12, 0.06);
const SKY_DARK = new THREE.Color(0.012, 0.012, 0.03);
const SKY_BRIGHT = new THREE.Color(0.06, 0.06, 0.08);

export class EclipseObserver {
  private container: HTMLElement;
  private label: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.OrthographicCamera;
  private scene: THREE.Scene;
  private coronaMaterial: CoronaMaterial;
  private coronaMesh: THREE.Mesh;
  private sunDisc: THREE.Mesh;
  private solarMoonDisc: THREE.Mesh;
  private lunarMoonDisc: THREE.Mesh;
  private lunarMoonMaterial: THREE.MeshStandardMaterial;
  private lunarGlowDisc: THREE.Mesh;
  private lunarGlowMaterial: THREE.MeshBasicMaterial;
  private lunarMoonLight: THREE.DirectionalLight;
  private starsMaterial: THREE.PointsMaterial;
  private clock: THREE.Clock;
  private animationId: number | null = null;
  private isVisible = false;
  private lunarTextureLoaded = false;
  private sceneBackground = new THREE.Color();

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'eclipse-observer glass-panel';
    this.container.setAttribute('aria-label', t('eclipse.observer.label'));

    this.label = document.createElement('span');
    this.label.className = 'eclipse-observer-label';
    this.label.textContent = t('eclipse.observer.label');
    this.container.appendChild(this.label);

    const canvas = document.createElement('canvas');
    canvas.className = 'eclipse-observer-canvas';
    this.container.appendChild(canvas);

    document.body.appendChild(this.container);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setSize(OBSERVER_SIZE, OBSERVER_SIZE, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.OrthographicCamera(
      -ORTHO_FRUSTUM, ORTHO_FRUSTUM, ORTHO_FRUSTUM, -ORTHO_FRUSTUM, 0.1, 10,
    );
    this.camera.position.z = 5;

    this.scene = new THREE.Scene();
    this.scene.background = SKY_DARK.clone();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    this.lunarMoonLight = new THREE.DirectionalLight(0xfff1df, 1.15);
    this.lunarMoonLight.position.set(-2.4, 1.8, 3.2);
    this.scene.add(this.lunarMoonLight);

    this.clock = new THREE.Clock(false);

    const stars = this.createStars();
    this.scene.add(stars);

    this.coronaMaterial = createCoronaMaterial();
    this.coronaMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ORTHO_FRUSTUM * 2, ORTHO_FRUSTUM * 2),
      this.coronaMaterial,
    );
    this.coronaMesh.position.z = -0.03;
    this.scene.add(this.coronaMesh);

    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 64),
      new THREE.MeshBasicMaterial({ color: 0xfffbe8 }),
    );
    this.sunDisc.position.z = -0.02;
    this.scene.add(this.sunDisc);

    this.solarMoonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.03, 64),
      new THREE.MeshBasicMaterial({ color: 0x020202 }),
    );
    this.solarMoonDisc.position.z = -0.01;
    this.scene.add(this.solarMoonDisc);

    this.lunarGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0x440808,
      transparent: true,
      opacity: 0,
    });
    this.lunarGlowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 64),
      this.lunarGlowMaterial,
    );
    this.lunarGlowDisc.position.z = -0.02;
    this.scene.add(this.lunarGlowDisc);

    this.lunarMoonMaterial = new THREE.MeshStandardMaterial({
      color: 0xb5b5b5,
      roughness: 0.96,
      metalness: 0,
    });
    this.lunarMoonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(1.34, 48, 48),
      this.lunarMoonMaterial,
    );
    this.lunarMoonDisc.position.z = -0.01;
    this.lunarMoonDisc.rotation.x = THREE.MathUtils.degToRad(8);
    this.lunarMoonDisc.rotation.y = THREE.MathUtils.degToRad(140);
    this.scene.add(this.lunarMoonDisc);

    this.starsMaterial = stars.material as THREE.PointsMaterial;

    simulationStore.subscribe((state) => {
      const shouldBeVisible = state.viewMode === 'eclipse';
      if (shouldBeVisible && !this.isVisible) {
        this.show();
      } else if (!shouldBeVisible && this.isVisible) {
        this.hide();
      }
    });

    i18n.onLanguageChange(() => {
      this.label.textContent = t('eclipse.observer.label');
      this.container.setAttribute('aria-label', t('eclipse.observer.label'));
    });
  }

  private createStars(): THREE.Points {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * ORTHO_FRUSTUM * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * ORTHO_FRUSTUM * 2;
      positions[i * 3 + 2] = -0.05;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.04,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
  }

  private show(): void {
    this.isVisible = true;
    this.container.classList.add('visible');
    void this.loadLunarMoonTexture();
    this.clock.start();
    this.startLoop();
  }

  private async loadLunarMoonTexture(): Promise<void> {
    if (this.lunarTextureLoaded) {
      return;
    }

    const textureLoader = new THREE.TextureLoader();

    try {
      const texture = await textureLoader.loadAsync(MOON_TEXTURE_URL);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.lunarMoonMaterial.map = texture;
      this.lunarMoonMaterial.needsUpdate = true;
      this.lunarTextureLoaded = true;
    } catch { }
  }

  private hide(): void {
    this.isVisible = false;
    this.container.classList.remove('visible');
    this.stopLoop();
    this.clock.stop();
  }

  private startLoop(): void {
    if (this.animationId !== null) {
      return;
    }
    const loop = (): void => {
      this.renderFrame();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private renderFrame(): void {
    const state = simulationStore.get();
    const eclipseInfo = getEclipseInfo(state.currentDay, state.eclipseType);
    const alignment = eclipseInfo.alignmentWindowPercent / 100;
    const elapsed = this.clock.getElapsedTime();
    const isSolar = state.eclipseType === 'solar';

    this.coronaMesh.visible = isSolar;
    this.sunDisc.visible = isSolar;
    this.solarMoonDisc.visible = isSolar;
    this.lunarMoonDisc.visible = !isSolar;
    this.lunarGlowDisc.visible = !isSolar;

    if (isSolar) {
      this.renderSolarEclipse(alignment, elapsed, eclipseInfo.offsetDays);
    } else {
      this.renderLunarEclipse(alignment);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private renderSolarEclipse(alignment: number, elapsed: number, offsetDays: number): void {
    this.coronaMaterial.uniforms.uTime.value = elapsed;
    this.coronaMaterial.uniforms.uAlignment.value = alignment;

    const direction = offsetDays >= 0 ? 1 : -1;
    const moonOffset = (1 - alignment) * 5.0 * direction;
    this.solarMoonDisc.position.x = moonOffset;

    this.sceneBackground.lerpColors(SKY_BRIGHT, SKY_DARK, alignment);
    (this.scene.background as THREE.Color).copy(this.sceneBackground);

    const starOpacity = alignment > 0.7
      ? THREE.MathUtils.lerp(0.1, 0.8, (alignment - 0.7) / 0.3)
      : 0.1;
    this.starsMaterial.opacity = starOpacity;
  }

  private renderLunarEclipse(alignment: number): void {
    const moonColor = MOON_NORMAL_COLOR.clone().lerp(MOON_BLOOD_COLOR, alignment);
    this.lunarMoonMaterial.color.copy(moonColor);
    this.lunarMoonMaterial.emissive.setRGB(
      THREE.MathUtils.lerp(0, 0.22, alignment),
      THREE.MathUtils.lerp(0, 0.04, alignment),
      THREE.MathUtils.lerp(0, 0.02, alignment),
    );

    this.lunarGlowMaterial.opacity = alignment * 0.25;
    const glowColor = new THREE.Color(0.4, 0.06, 0.03);
    this.lunarGlowMaterial.color.copy(glowColor);

    (this.scene.background as THREE.Color).copy(SKY_DARK);
    this.starsMaterial.opacity = 0.6;
  }
}

export function createEclipseObserver(): EclipseObserver {
  return new EclipseObserver();
}
