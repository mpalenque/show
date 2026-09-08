export const DISPLAY_PROFILE = 'led-2688x1008-v1';
export const LED_DISPLAY_PARAMETERS = {
  'output.resolution': '2688x1008', 'output.preview': 'composition',
  'composition.stripes.x': 0, 'composition.stripes.y': .8057,
  'composition.stripes.width': 2, 'composition.stripes.stripWidth': 2 / 6,
  'composition.stripes.height': .7061, 'composition.stripes.rotation': 0,
  'composition.view.mode': 'show-strip', 'composition.view.x': 0, 'composition.view.y': -.82,
  'composition.view.scaleX': 1, 'composition.view.scaleY': 1.57,
  'composition.view.outputX': 0, 'composition.view.outputY': -.43,
  'composition.view.outputScaleX': 1, 'composition.view.outputScaleY': 1,
  ...Object.fromEntries(['fullVideo', 'fullMilky'].flatMap(layer => Object.entries({ x: 0, y: .8057, width: 2, height: .7061, rotation: 0 })
    .map(([key, value]) => [`composition.${layer}.${key}`, value]))),
};

/** Upgrade only the old display layout; preserve clips, effect controls and MIDI. */
export function migrateDisplayProfile(document) {
  if (!document || document.displayProfile === DISPLAY_PROFILE) return document;
  const patch = values => values && typeof values === 'object' && !Array.isArray(values)
    ? { ...values, ...LED_DISPLAY_PARAMETERS } : values;
  const scenes = document.scenes && typeof document.scenes === 'object' && !Array.isArray(document.scenes)
    ? Object.fromEntries(Object.entries(document.scenes).map(([id, values]) => [id, patch(values)])) : document.scenes;
  return { ...document, displayProfile: DISPLAY_PROFILE,
    parameters: patch(document.parameters ?? {}), ...(scenes != null ? { scenes } : {}) };
}
