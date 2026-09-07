/**
 * Minimal slider panel for the observer view: a few faders, nothing else.
 * Hidden with H so a recording stays clean without reloading the page.
 */
export interface FaderDefinition {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Called on input and once at creation, so the scene starts in sync. */
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

export interface ToggleDefinition {
  id: string;
  label: string;
  value: boolean;
  /** Called on click and once at creation, so the scene starts in sync. */
  onChange: (value: boolean) => void;
}

export interface PanelControls {
  faders: FaderDefinition[];
  toggles?: ToggleDefinition[];
}

export interface FaderPanel {
  element: HTMLElement;
  setVisible: (visible: boolean) => void;
  toggle: () => void;
}

const PANEL_STYLES = `
.fader-panel {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px 18px;
  align-items: center;
  padding: 10px 16px;
  max-width: calc(100vw - 24px);
  border-radius: 12px;
  background: rgba(10, 12, 18, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  font: 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: rgba(255, 255, 255, 0.72);
  opacity: 0.35;
  transition: opacity 0.25s ease;
  z-index: 10;
}
.fader-panel:hover { opacity: 1; }
.fader-panel.hidden { display: none; }
.fader-panel .fader { display: flex; flex-direction: column; gap: 5px; }
.fader-panel .fader-head { display: flex; justify-content: space-between; gap: 10px; }
.fader-panel .fader-label { letter-spacing: 0.06em; text-transform: uppercase; }
.fader-panel .fader-value { font-variant-numeric: tabular-nums; color: rgba(255, 255, 255, 0.95); }
.fader-panel input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 110px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.22);
  outline: none;
}
.fader-panel input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #dfe7f5;
  cursor: pointer;
}
.fader-panel .fader-hint { align-self: flex-end; opacity: 0.5; font-size: 10px; }
.fader-panel button.toggle {
  font: inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
}
.fader-panel button.toggle[aria-pressed='true'] {
  color: #08131f;
  background: #cfe0ff;
  border-color: #cfe0ff;
}
@media (max-width: 768px) {
  .fader-panel { flex-wrap: wrap; justify-content: center; max-width: calc(100vw - 24px); }
  .fader-panel input[type='range'] { width: 84px; }
}
`;

const injectStyles = (): void => {
  if (document.getElementById('fader-panel-styles')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'fader-panel-styles';
  style.textContent = PANEL_STYLES;
  document.head.appendChild(style);
};

const defaultFormat = (value: number): string => value.toFixed(2);

export function createFaderPanel(controls: PanelControls, visible = true): FaderPanel {
  injectStyles();

  const element = document.createElement('div');
  element.className = 'fader-panel';

  (controls.toggles ?? []).forEach((toggle) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle';
    button.textContent = toggle.label;

    let enabled = toggle.value;

    const apply = (value: boolean): void => {
      enabled = value;
      button.setAttribute('aria-pressed', String(value));
      toggle.onChange(value);
    };

    button.addEventListener('click', () => {
      apply(!enabled);
    });

    element.appendChild(button);
    apply(enabled);
  });

  controls.faders.forEach((fader) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'fader';

    const head = document.createElement('div');
    head.className = 'fader-head';

    const label = document.createElement('span');
    label.className = 'fader-label';
    label.textContent = fader.label;

    const readout = document.createElement('span');
    readout.className = 'fader-value';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(fader.min);
    input.max = String(fader.max);
    input.step = String(fader.step);
    input.value = String(fader.value);
    input.setAttribute('aria-label', fader.label);

    const format = fader.format ?? defaultFormat;

    const apply = (value: number): void => {
      readout.textContent = format(value);
      fader.onChange(value);
    };

    input.addEventListener('input', () => {
      apply(Number.parseFloat(input.value));
    });

    head.append(label, readout);
    wrapper.append(head, input);
    element.appendChild(wrapper);

    apply(fader.value);
  });

  const hint = document.createElement('span');
  hint.className = 'fader-hint';
  hint.textContent = 'H';
  hint.title = 'Press H to hide these controls';
  element.appendChild(hint);

  document.body.appendChild(element);

  const setVisible = (next: boolean): void => {
    element.classList.toggle('hidden', !next);
  };

  setVisible(visible);

  return {
    element,
    setVisible,
    toggle: () => {
      setVisible(element.classList.contains('hidden'));
    },
  };
}
