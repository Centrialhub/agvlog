export const TENANT_ACTIVATION_TIMEOUT_MS = 10_000;
export type TenantActivationInterruption = 'timeout' | 'cancelled' | 'superseded';

/** One deadline for the whole attempt, including transports that ignore abort. */
export function createTenantActivationAttempt(onInterrupted: (reason: TenantActivationInterruption) => void) {
  const controller = new AbortController();
  let stopped = false;
  let rejectInterrupted!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  // Cancellation can precede the first awaited request during unmount/StrictMode.
  void interrupted.catch(() => undefined);
  const cancel = (reason: TenantActivationInterruption) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    onInterrupted(reason);
    rejectInterrupted(new Error(`tenant_activation_${reason}`));
  };
  const timer = setTimeout(() => cancel('timeout'), TENANT_ACTIVATION_TIMEOUT_MS);
  return {
    get stopped() { return stopped; },
    cancel,
    finish() { stopped = true; clearTimeout(timer); },
    wait<T>(request: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> }): Promise<T> {
      if (stopped) return Promise.reject(new Error('tenant_activation_stopped'));
      const pending = typeof request.abortSignal === 'function' ? request.abortSignal(controller.signal) : request;
      return Promise.race([pending, interrupted]);
    },
  };
}
export type TenantActivationAttempt = ReturnType<typeof createTenantActivationAttempt>;
