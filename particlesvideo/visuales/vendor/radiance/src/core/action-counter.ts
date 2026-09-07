/**
 * Returns coalesced one-shot actions from a wrapping 0..max counter.
 * Large backwards jumps are controller rebases/rollbacks, not hundreds of
 * operator clicks, and are deliberately ignored.
 */
export const actionCounterDelta = (
  previous: number | undefined,
  next: number,
  max = 999,
  maxBurst = 64,
): number => {
  if (previous === undefined || !Number.isFinite(previous) || !Number.isFinite(next)) return 0;
  const modulus = Math.max(2, Math.round(max) + 1);
  const safePrevious = Math.max(0, Math.min(modulus - 1, Math.round(previous)));
  const safeNext = Math.max(0, Math.min(modulus - 1, Math.round(next)));
  const delta = (safeNext - safePrevious + modulus) % modulus;
  return delta <= Math.max(1, Math.round(maxBurst)) ? delta : 0;
};
