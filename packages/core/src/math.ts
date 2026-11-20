export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scroll progress (0..1) of a tall section whose content is sticky.
 * 0 when the section top reaches the viewport top, 1 when its bottom reaches the viewport bottom.
 */
export function progressFromRect(top: number, height: number, viewportHeight: number): number {
  const distance = height - viewportHeight;
  if (distance <= 0) return top <= 0 ? 1 : 0;
  return clamp(-top / distance);
}

export function frameIndexFromProgress(progress: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  return Math.round(clamp(progress) * (frameCount - 1));
}

/**
 * Coarse-to-fine load order: every 16th frame first, then every 8th, 4th, 2nd, then the rest.
 * Scrubbing works (at lower temporal resolution) long before every frame is downloaded.
 */
export function coarseToFineOrder(frameCount: number): number[] {
  const order: number[] = [];
  const seen = new Uint8Array(frameCount);
  for (let step = 16; step >= 1; step /= 2) {
    for (let i = 0; i < frameCount; i += step) {
      if (!seen[i]) {
        seen[i] = 1;
        order.push(i);
      }
    }
    // The last frame belongs to the first pass, so the end of the scroll is never blank.
    if (step === 16 && frameCount > 0 && !seen[frameCount - 1]) {
      seen[frameCount - 1] = 1;
      order.push(frameCount - 1);
    }
  }
  return order;
}

/** Closest index (searching both directions) for which `isLoaded` returns true, or -1. */
export function nearestLoaded(index: number, frameCount: number, isLoaded: (i: number) => boolean): number {
  for (let offset = 0; offset < frameCount; offset++) {
    const before = index - offset;
    const after = index + offset;
    if (before >= 0 && isLoaded(before)) return before;
    if (after < frameCount && isLoaded(after)) return after;
  }
  return -1;
}
