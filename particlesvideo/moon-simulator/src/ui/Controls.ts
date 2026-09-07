import GUI from 'lil-gui';
import { simulationStore } from '../main';
import { i18n, t } from '../i18n/i18n';

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

export interface ControlParams {
  day: number;
  speed: number;
  playing: boolean;
  showOrbitLine: boolean;
  realisticScale: boolean;
  autoRotate: boolean;
  autoRotateSpeed: number;
  sunIntensity: number;
  ambientIntensity: number;
}

export function createControls(): { gui: GUI; params: ControlParams } {
  const params: ControlParams = {
    day: 0,
    speed: 1,
    playing: true,
    showOrbitLine: true,
    realisticScale: false,
    autoRotate: false,
    autoRotateSpeed: 2,
    sunIntensity: 2.5,
    ambientIntensity: 0.15,
  };

  const createGui = (): GUI => {
    document.querySelectorAll<HTMLElement>('.lil-gui.root').forEach((element) => {
      element.remove();
    });

    const gui = new GUI({ title: t('settings.title') });

    const simulationFolder = gui.addFolder(t('settings.simulation'));
    simulationFolder.open();
    simulationFolder
      .add(params, 'day', 0, 29.53)
      .step(0.1)
      .name(t('settings.day'))
      .listen()
      .onChange((value: number) => simulationStore.update({ currentDay: value }));
    simulationFolder
      .add(params, 'speed', 0.1, 5)
      .name(t('settings.speed'))
      .onChange((value: number) => simulationStore.update({ playSpeed: value }));
    simulationFolder
      .add(params, 'playing')
      .name(t('settings.playing'))
      .listen()
      .onChange((value: boolean) => simulationStore.update({ isPlaying: value }));

    const displayFolder = gui.addFolder(t('settings.display'));
    displayFolder
      .add(params, 'showOrbitLine')
      .name(t('settings.orbitLine'))
      .onChange((value: boolean) => simulationStore.update({ showOrbitLine: value }));
    displayFolder
      .add(params, 'realisticScale')
      .name(t('settings.realisticScale'))
      .onChange((value: boolean) => simulationStore.update({ realisticScale: value }));

    const cameraFolder = gui.addFolder(t('settings.camera'));
    cameraFolder.add(params, 'autoRotate').name(t('settings.autoRotate'));
    cameraFolder.add(params, 'autoRotateSpeed', 0, 5).name(t('settings.rotateSpeed'));

    const lightingFolder = gui.addFolder(t('settings.lighting'));
    lightingFolder.add(params, 'sunIntensity', 0, 5).name(t('settings.sunIntensity'));
    lightingFolder.add(params, 'ambientIntensity', 0, 0.5).name(t('settings.ambient'));

    if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      gui.close();
    }

    return gui;
  };

  const controls = { gui: createGui(), params };

  i18n.onLanguageChange(() => {
    controls.gui.destroy();
    controls.gui = createGui();
  });

  simulationStore.subscribe((state) => {
    params.day = Math.round(state.currentDay * 10) / 10;
    params.playing = state.isPlaying;
    params.speed = state.playSpeed;
    params.showOrbitLine = state.showOrbitLine;
    params.realisticScale = state.realisticScale;
  });

  return controls;
}
