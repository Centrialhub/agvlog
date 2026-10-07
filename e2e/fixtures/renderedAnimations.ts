import type { Locator } from '@playwright/test';

// Call after the actual route content appears so lazy-mounted entrance effects
// have entered layout. Infinite progress/spinner animations never block axe.
export async function waitForRenderedAnimations(root: Locator) {
  await root.evaluate(async element => {
    element.getBoundingClientRect();
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
  });
}
