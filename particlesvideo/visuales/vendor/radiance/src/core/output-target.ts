/**
 * Master canvas for the performance output.  The browser preview may be
 * letterboxed, but every scene receives these logical pixels so captures and
 * the physical 10:3 output are deterministic.
 */
export const OUTPUT_TARGET_WIDTH = 3360;
export const OUTPUT_TARGET_HEIGHT = 1008;
export const OUTPUT_TARGET_ASPECT = OUTPUT_TARGET_WIDTH / OUTPUT_TARGET_HEIGHT;
export const OUTPUT_TARGET_DPR = 1;

export const isNativeOutputTarget = (width: number, height: number): boolean =>
  width >= OUTPUT_TARGET_WIDTH && height >= OUTPUT_TARGET_HEIGHT;
