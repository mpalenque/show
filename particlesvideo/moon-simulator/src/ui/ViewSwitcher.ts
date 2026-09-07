import { simulationStore } from '../main';
import { enterEclipseMode, exitEclipseMode } from '../simulation/Eclipse';
import type { SimulationState } from '../simulation/SimulationState';
import { i18n, t } from '../i18n/i18n';

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

const VIEW_OPTIONS: Array<{ labelKey: string; value: SimulationState['viewMode'] }> = [
  { labelKey: 'view.default', value: 'default' },
  { labelKey: 'view.observer', value: 'observer' },
  { labelKey: 'view.orbital', value: 'orbital' },
  { labelKey: 'view.eclipse', value: 'eclipse' },
];

const activateView = (viewMode: SimulationState['viewMode']): void => {
  const state = simulationStore.get();

  if (viewMode === 'eclipse') {
    simulationStore.update(enterEclipseMode(state, state.eclipseType));
    return;
  }

  if (state.viewMode === 'eclipse') {
    simulationStore.update(exitEclipseMode(viewMode));
    return;
  }

  simulationStore.update({ viewMode });
};

export function createViewSwitcher(): void {
  const element = document.getElementById('view-switcher');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Element with id "view-switcher" was not found');
  }

  const originalParent = element.parentElement;
  const originalNextSibling = element.nextElementSibling;

  if (!(originalParent instanceof HTMLElement)) {
    throw new Error('View switcher parent was not found');
  }

  let isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  let buttons: Array<{ button: HTMLButtonElement; value: SimulationState['viewMode']; labelKey: string }> = [];
  let select: HTMLSelectElement | null = null;

  const relocateContainer = (): void => {
    if (isMobile) {
      const appTitle = document.querySelector('.app-title');
      const languageSwitcher = document.getElementById('language-switcher');
      if (appTitle instanceof HTMLElement && languageSwitcher instanceof HTMLElement && languageSwitcher.parentElement === appTitle) {
        appTitle.insertBefore(element, languageSwitcher);
      }
      return;
    }

    if (originalNextSibling instanceof HTMLElement && originalNextSibling.parentElement === originalParent) {
      originalParent.insertBefore(element, originalNextSibling);
    } else {
      originalParent.appendChild(element);
    }
  };

  const render = (): void => {
    relocateContainer();
    element.innerHTML = '';
    buttons = [];
    select = null;
    element.setAttribute('role', isMobile ? 'group' : 'toolbar');

    if (isMobile) {
      const mobileSelect = document.createElement('select');
      mobileSelect.className = 'view-switcher-select glass-panel';
      mobileSelect.setAttribute('aria-label', t('aria.viewSwitcher'));

      VIEW_OPTIONS.forEach(({ labelKey, value }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(labelKey);
        mobileSelect.appendChild(option);
      });

      mobileSelect.addEventListener('change', () => {
        activateView(mobileSelect.value as SimulationState['viewMode']);
      });

      element.appendChild(mobileSelect);
      select = mobileSelect;
      return;
    }

    buttons = VIEW_OPTIONS.map(({ labelKey, value }) => {
      const button = document.createElement('button');
      button.className = 'view-btn glass-panel';
      button.textContent = t(labelKey);
      button.type = 'button';
      button.addEventListener('click', () => {
        activateView(value);
      });
      element.appendChild(button);
      return { button, value, labelKey };
    });
  };

  const syncState = (state: SimulationState): void => {
    if (select) {
      select.value = state.viewMode;
    }

    buttons.forEach(({ button, value }) => {
      button.classList.toggle('active', state.viewMode === value);
    });
  };

  render();
  syncState(simulationStore.get());
  requestAnimationFrame(() => {
    relocateContainer();
    syncState(simulationStore.get());
  });

  i18n.onLanguageChange(() => {
    render();
    syncState(simulationStore.get());
  });

  simulationStore.subscribe((state) => {
    syncState(state);
  });

  window.addEventListener('resize', () => {
    const nextIsMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
    isMobile = nextIsMobile;
    render();
    syncState(simulationStore.get());
  });
}
