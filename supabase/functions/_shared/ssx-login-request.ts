const DEFAULT_LOGIN_TIMEOUT_MS = 30_000;
const MAX_LOGIN_TIMEOUT_MS = 120_000;

/** Keep malformed settings and oversized JS timers from disabling cancellation. */
export function ssxLoginTimeoutMs(value: unknown): number {
  const parsed = typeof value === "number" || (typeof value === "string" && value.trim())
    ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(MAX_LOGIN_TIMEOUT_MS, Math.max(1, Math.floor(parsed)))
    : DEFAULT_LOGIN_TIMEOUT_MS;
}

/** One deadline covers both response headers and the complete login body. */
export async function requestSsxLogin(
  endpoint: string,
  timeoutSetting: unknown,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ssxLoginTimeoutMs(timeoutSetting));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}
