import { enterEclipseMode, getEclipseInfo, type EclipseType } from '../simulation/Eclipse';
import { getPhaseInfo, type PhaseInfo } from '../simulation/MoonPhase';
import { simulationStore } from '../main';
import { i18n, t } from '../i18n/i18n';
import type { SimulationState } from '../simulation/SimulationState';

const PHASE_EMOJIS: Record<string, string> = {
  newMoon: '🌑',
  waxingCrescent: '🌒',
  firstQuarter: '🌓',
  waxingGibbous: '🌔',
  fullMoon: '🌕',
  waningGibbous: '🌖',
  lastQuarter: '🌗',
  waningCrescent: '🌘',
};

const ECLIPSE_EMOJIS: Record<EclipseType, string> = {
  solar: '🌞',
  lunar: '🌚',
};

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

export class InfoPanel {
  private element: HTMLElement;
  private currentContentSignature = '';
  private isExpanded = !window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  private illuminationValue: HTMLElement | null = null;
  private dayValue: HTMLElement | null = null;
  private angleValue: HTMLElement | null = null;
  private summaryValue: HTMLElement | null = null;
  private alignmentValue: HTMLElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;
  private eclipseButtons: HTMLButtonElement[] = [];
  private isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;

  constructor() {
    const element = document.getElementById('info-panel');
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element with id "info-panel" was not found');
    }
    this.element = element;

    simulationStore.subscribe((state) => {
      this.render(state);
    });

    window.addEventListener('resize', () => {
      const nextIsMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
      if (nextIsMobile !== this.isMobile) {
        this.isMobile = nextIsMobile;
        this.isExpanded = !nextIsMobile;
        this.updateDrawerState();
      }
    });

    i18n.onLanguageChange(() => {
      this.currentContentSignature = '';
      this.render(simulationStore.get());
    });
  }

  private updateDrawerState(): void {
    this.element.classList.toggle('collapsed', !this.isExpanded);
    if (this.toggleButton) {
      this.toggleButton.textContent = this.isExpanded ? '−' : '+';
      this.toggleButton.setAttribute('aria-expanded', String(this.isExpanded));
      this.toggleButton.setAttribute('aria-label', t(this.isExpanded ? 'ui.collapseDetails' : 'ui.expandDetails'));
      this.toggleButton.title = t(this.isExpanded ? 'ui.collapseDetails' : 'ui.expandDetails');
    }
  }

  private bindToggleButton(): void {
    const toggleButton = this.element.querySelector('.info-panel-toggle');
    this.toggleButton = toggleButton instanceof HTMLButtonElement ? toggleButton : null;
    this.toggleButton?.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;
      this.updateDrawerState();
    });
    this.updateDrawerState();
  }

  private activateEclipseType(type: EclipseType): void {
    simulationStore.update(enterEclipseMode(simulationStore.get(), type));
  }

  private bindEclipseButtons(activeType: EclipseType): void {
    this.eclipseButtons = Array.from(this.element.querySelectorAll<HTMLButtonElement>('.eclipse-toggle-btn'));
    this.eclipseButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.eclipseType === activeType);
      button.setAttribute('aria-pressed', String(button.dataset.eclipseType === activeType));
      button.addEventListener('click', () => {
        const nextType = button.dataset.eclipseType;
        if (nextType === 'solar' || nextType === 'lunar') {
          this.activateEclipseType(nextType);
        }
      });
    });
  }

  private renderPhaseContent(info: PhaseInfo): void {
    const phaseName = t(`phase.${info.phaseKey}.name`);
    const description = t(`phase.${info.phaseKey}.description`);
    const misconceptionKey = `phase.${info.phaseKey}.misconception`;
    const misconception = t(misconceptionKey);
    const hasMisconception = misconception !== misconceptionKey;
    const emoji = PHASE_EMOJIS[info.phaseKey] ?? '🌙';
    const misconceptionMarkup = hasMisconception
      ? `<div class="misconception-box"><div class="misconception-label">${t('ui.commonMisconception')}</div><p class="misconception-text">${misconception}</p></div>`
      : '';

    this.element.innerHTML = `<div class="info-panel-header">
      <div class="info-panel-header-copy">
        <h2 class="phase-name">${emoji} ${phaseName}</h2>
        <div class="info-panel-summary">${t('ui.illumination')} <span class="info-panel-summary-value">${Math.round(info.illumination)}%</span> · ${t('ui.day')} ${info.day.toFixed(1)}</div>
      </div>
      <button class="info-panel-toggle" type="button"></button>
    </div>
    <div class="info-panel-details">
      <div class="stat-row">
        <span class="stat-label">${t('ui.illumination')}</span>
        <span class="illumination-value">${Math.round(info.illumination)}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${t('ui.day')}</span>
        <span class="stat-value phase-day-value">${info.day.toFixed(1)} / 29.5</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${t('ui.phaseAngle')}</span>
        <span class="stat-value phase-angle-value">${info.phaseAngle.toFixed(1)}${t('ui.deg')}</span>
      </div>
      <p class="phase-description">${description}</p>
      ${misconceptionMarkup}
    </div>`;

    this.summaryValue = this.element.querySelector('.info-panel-summary-value');
    this.illuminationValue = this.element.querySelector('.illumination-value');
    this.dayValue = this.element.querySelector('.phase-day-value');
    this.angleValue = this.element.querySelector('.phase-angle-value');
    this.alignmentValue = null;
    this.eclipseButtons = [];
    this.bindToggleButton();
  }

  private renderEclipseContent(state: SimulationState): void {
    const eclipseInfo = getEclipseInfo(state.currentDay, state.eclipseType);
    const eclipseTitle = t(`eclipse.${state.eclipseType}.name`);
    const emoji = ECLIPSE_EMOJIS[state.eclipseType];
    const watchNote = t('eclipse.watchMotion');

    this.element.innerHTML = `<div class="info-panel-header">
      <div class="info-panel-header-copy">
        <h2 class="phase-name">${emoji} ${eclipseTitle}</h2>
        <div class="info-panel-summary">${t('eclipse.alignmentWindow')} <span class="info-panel-summary-value">${eclipseInfo.alignmentWindowPercent.toFixed(0)}%</span></div>
      </div>
      <button class="info-panel-toggle" type="button"></button>
    </div>
    <div class="eclipse-toggle-group" role="group" aria-label="${t('aria.eclipseType')}">
      <button class="eclipse-toggle-btn" type="button" data-eclipse-type="solar">${t('eclipse.solar.short')}</button>
      <button class="eclipse-toggle-btn" type="button" data-eclipse-type="lunar">${t('eclipse.lunar.short')}</button>
    </div>
    <div class="info-panel-details">
      <div class="stat-row">
        <span class="stat-label">${t('eclipse.alignmentWindow')}</span>
        <span class="stat-value eclipse-alignment-value">${eclipseInfo.alignmentWindowPercent.toFixed(0)}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${t('eclipse.shadowZone')}</span>
        <span class="stat-value">${t('eclipse.shadowZoneValue')}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${t('eclipse.lineup')}</span>
        <span class="stat-value">${t(eclipseInfo.lineupKey)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${t('ui.phaseAngle')}</span>
        <span class="stat-value eclipse-angle-value">${eclipseInfo.phaseAngle.toFixed(1)}${t('ui.deg')}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">${t('eclipse.orbitTilt')}</span>
        <span class="stat-value">${t('eclipse.orbitTiltValue')}</span>
      </div>
      <p class="phase-description">${t(eclipseInfo.descriptionKey)}</p>
      <div class="misconception-box">
        <div class="misconception-label">${t('eclipse.watchLabel')}</div>
        <p class="misconception-text">${watchNote}</p>
      </div>
    </div>`;

    this.summaryValue = this.element.querySelector('.info-panel-summary-value');
    this.illuminationValue = null;
    this.dayValue = null;
    this.angleValue = this.element.querySelector('.eclipse-angle-value');
    this.alignmentValue = this.element.querySelector('.eclipse-alignment-value');
    this.bindToggleButton();
    this.bindEclipseButtons(state.eclipseType);
  }

  render(state: SimulationState): void {
    if (state.viewMode === 'eclipse') {
      const signature = `eclipse:${state.eclipseType}`;
      if (this.currentContentSignature !== signature) {
        this.renderEclipseContent(state);
        this.currentContentSignature = signature;
      }

      const eclipseInfo = getEclipseInfo(state.currentDay, state.eclipseType);
      if (this.summaryValue) {
        this.summaryValue.textContent = `${eclipseInfo.alignmentWindowPercent.toFixed(0)}%`;
      }
      if (this.alignmentValue) {
        this.alignmentValue.textContent = `${eclipseInfo.alignmentWindowPercent.toFixed(0)}%`;
      }
      if (this.dayValue) {
        this.dayValue.textContent = `${state.currentDay.toFixed(1)} / 29.5`;
      }
      if (this.angleValue) {
        this.angleValue.textContent = `${eclipseInfo.phaseAngle.toFixed(1)}${t('ui.deg')}`;
      }
      this.eclipseButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.eclipseType === state.eclipseType);
        button.setAttribute('aria-pressed', String(button.dataset.eclipseType === state.eclipseType));
      });
      this.updateDrawerState();
      return;
    }

    const phaseInfo = getPhaseInfo(state.currentDay);
    const signature = `phase:${phaseInfo.phaseIndex}`;
    if (this.currentContentSignature !== signature) {
      this.renderPhaseContent(phaseInfo);
      this.currentContentSignature = signature;
    }

    if (this.summaryValue) {
      this.summaryValue.textContent = `${Math.round(phaseInfo.illumination)}%`;
    }
    if (this.illuminationValue) {
      this.illuminationValue.textContent = `${Math.round(phaseInfo.illumination)}%`;
    }
    if (this.dayValue) {
      this.dayValue.textContent = `${phaseInfo.day.toFixed(1)} / 29.5`;
    }
    if (this.angleValue) {
      this.angleValue.textContent = `${phaseInfo.phaseAngle.toFixed(1)}${t('ui.deg')}`;
    }
    this.updateDrawerState();
  }
}

export function createInfoPanel(): InfoPanel {
  return new InfoPanel();
}
