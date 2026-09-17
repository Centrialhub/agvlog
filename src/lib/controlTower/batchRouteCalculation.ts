type Pause = (milliseconds: number) => Promise<void>;

const defaultPause: Pause = milliseconds => new Promise(resolve => {
  window.setTimeout(resolve, milliseconds);
});

export async function settleInBatches<Item, Result>(
  items: readonly Item[],
  batchSize: number,
  pauseMilliseconds: number,
  worker: (item: Item) => Promise<Result>,
  pause: Pause = defaultPause,
): Promise<PromiseSettledResult<Result>[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('O tamanho do lote precisa ser um inteiro positivo.');
  }
  const results: PromiseSettledResult<Result>[] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    results.push(...await Promise.allSettled(items.slice(offset, offset + batchSize).map(worker)));
    if (offset + batchSize < items.length && pauseMilliseconds > 0) {
      await pause(pauseMilliseconds);
    }
  }
  return results;
}
