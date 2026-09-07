import type { QualityLevel, VisualScene } from '../core/types';

export type SceneFactory = (host: HTMLElement, quality: QualityLevel) => Promise<VisualScene>;
