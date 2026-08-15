# Plan - High-Speed Batch CT-e Emission

Transition from sequential, blocking CT-e emission to a parallel batch architecture to leverage the Hub Fiscal's high-speed mass emission capabilities.

## User Review Required

> [!IMPORTANT]
> - The new "Parallel Emission" will send all CT-e requests simultaneously to the Hub.
> - While this is significantly faster, very large batches (e.g., >100 documents) might hit rate limits or timeout thresholds. I will implement a sliding window/concurrency limit of 5 simultaneous requests to balance speed and stability.
> - Error reporting will remain granular: you will still see which specific CT-es failed in the batch.

## Proposed Changes

### Logic & Performance
- **Parallel Dispatch**: Refactor `CteEmissionPreviewDialog.tsx` to launch emissions in parallel instead of a sequential `for` loop.
- **Concurrency Control**: Implement a simple batching utility to limit active simultaneous requests (e.g., max 5 at a time) to prevent Edge Function timeouts (55s limit) and provider rate limits.
- **Transactional Consistency**: Update `useIssueCTe.tsx` to handle its internal state updates (creating `transmitting` records) efficiently before the parallel burst.

### Components & UI
- **CteEmissionPreviewDialog.tsx**:
  - Replace the sequential loop in `transmit()` with `Promise.all` wrapped in a concurrency limiter.
  - Optimize credential fetching by batching or caching lookups within the same emission turn.

### Hooks & API
- **useIssueCTe.tsx**: Keep the mutation atomic per document to maintain individual audit trails in `fiscal_documents` and `hub_fiscal_emissions`, but optimize for rapid successive calls.
- **hub-fiscal-proxy**: The existing proxy already supports concurrent execution per request.

## Technical Details

- **Concurrency Utility**:
  ```typescript
  async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];
    for (const item of items) {
      const p = fn(item).then((res) => { results.push(res); });
      executing.push(p);
      if (executing.length >= limit) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(e => e === p), 1);
      }
    }
    await Promise.all(executing);
    return results;
  }
  ```
- **Credential Caching**: Fetch credentials once per unique `emitterId` in the batch to avoid redundant Supabase lookups during the parallel burst.
