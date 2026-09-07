import { SYNODIC_PERIOD } from '../simulation/MoonPhase';
import { simulationStore } from '../main';
import { i18n, t } from '../i18n/i18n';

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
const PHASE_DAYS = [0, 3.69, 7.38, 11.07, 14.77, 18.46, 22.15, 25.84];

export class Timeline {
  private element: HTMLElement;
  private playButton!: HTMLButtonElement;
  private previousStepButton!: HTMLButtonElement;
  private nextStepButton!: HTMLButtonElement;
  private slider!: HTMLInputElement;
  private dayLabel!: HTMLElement;
  private speedButtons: HTMLButtonElement[] = [];

  constructor() {
    const element = document.getElementById('timeline-bar');
    if (!(element instanceof HTMLElement)) {
      throw new Error('Element with id "timeline-bar" was not found');
    }
    this.element = element;

    this.build();
    this.bindKeyboardEvents();

    i18n.onLanguageChange(() => {
      this.build();
      this.renderState(simulationStore.get());
    });

    simulationStore.subscribe((state) => {
      this.renderState(state);
    });
  }

  private build(): void {
    const ticksMarkup = PHASE_DAYS.map((day) => {
      const position = (day / SYNODIC_PERIOD) * 100;
      return `<span class="phase-tick" style="left:${position.toFixed(2)}%"></span>`;
    }).join('');

    const speedButtonsMarkup = SPEED_OPTIONS.map(
      (speed) => `<button class="speed-btn" data-speed="${speed}">${speed}x</button>`,
    ).join('');

    this.element.innerHTML = `<div class="timeline-controls">
      <div class="timeline-primary-row">
        <button class="play-btn" aria-label="${t('aria.togglePlayback')}">⏸</button>
        <div class="speed-buttons">${speedButtonsMarkup}</div>
        <span class="day-label">${t('ui.dayLabel').replace('{value}', '0.0')}</span>
      </div>
      <div class="timeline-slider-row">
        <button class="step-btn" data-step="prev" aria-label="${t('aria.previousStep')}">−</button>
        <div class="timeline-slider-container">
          <input type="range" class="timeline-slider" min="0" max="29.53" step="0.01" aria-label="${t('aria.lunarDay')}">
          <div class="phase-ticks">${ticksMarkup}</div>
        </div>
        <button class="step-btn" data-step="next" aria-label="${t('aria.nextStep')}">+</button>
      </div>
    </div>`;

    const playButton = this.element.querySelector('.play-btn');
    const previousStepButton = this.element.querySelector('.step-btn[data-step="prev"]');
    const nextStepButton = this.element.querySelector('.step-btn[data-step="next"]');
    const slider = this.element.querySelector('.timeline-slider');
    const dayLabel = this.element.querySelector('.day-label');
    const speedButtons = Array.from(this.element.querySelectorAll('.speed-btn'));

    if (
      !(playButton instanceof HTMLButtonElement) ||
      !(previousStepButton instanceof HTMLButtonElement) ||
      !(nextStepButton instanceof HTMLButtonElement) ||
      !(slider instanceof HTMLInputElement) ||
      !(dayLabel instanceof HTMLElement)
    ) {
      throw new Error('Timeline controls failed to initialize');
    }

    this.playButton = playButton;
    this.previousStepButton = previousStepButton;
    this.nextStepButton = nextStepButton;
    this.slider = slider;
    this.dayLabel = dayLabel;
    this.speedButtons = speedButtons.filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement);

    this.bindControlEvents();
  }

  private bindControlEvents(): void {
    this.playButton.addEventListener('click', () => {
      const state = simulationStore.get();
      simulationStore.update({ isPlaying: !state.isPlaying });
    });

    this.speedButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.speed);
        simulationStore.update({ playSpeed: speed });
      });
    });

    this.slider.addEventListener('input', () => {
      simulationStore.update({ currentDay: Number(this.slider.value) });
    });

    this.previousStepButton.addEventListener('click', () => {
      const state = simulationStore.get();
      simulationStore.update({ currentDay: Math.max(0, state.currentDay - 0.5) });
    });

    this.nextStepButton.addEventListener('click', () => {
      const state = simulationStore.get();
      simulationStore.update({ currentDay: (state.currentDay + 0.5) % SYNODIC_PERIOD });
    });
  }

  private bindKeyboardEvents(): void {
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        const state = simulationStore.get();
        simulationStore.update({ isPlaying: !state.isPlaying });
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        const state = simulationStore.get();
        const day = Math.max(0, state.currentDay - 0.5);
        simulationStore.update({ currentDay: day });
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault();
        const state = simulationStore.get();
        const day = (state.currentDay + 0.5) % SYNODIC_PERIOD;
        simulationStore.update({ currentDay: day });
      }
    });
  }

  private renderState(state: ReturnType<typeof simulationStore.get>): void {
    this.slider.value = state.currentDay.toFixed(2);
    this.playButton.textContent = state.isPlaying ? '⏸' : '▶';
    this.dayLabel.textContent = t('ui.dayLabel').replace('{value}', state.currentDay.toFixed(1));

    this.speedButtons.forEach((button) => {
      const speed = Number(button.dataset.speed);
      button.classList.toggle('active', Math.abs(speed - state.playSpeed) < 0.001);
    });
  }
}

export function createTimeline(): Timeline {
  return new Timeline();
}
