/** SSX position polling controls. Manual selection never overrides provider throttling. */
export type PollOptions = { manual_run: boolean; force_rediscovery: boolean; lookback_minutes?: number };
type ParsedOptions = { ok: true; options: PollOptions } | { ok: false; error: string };
const MAX_DATE_MS = 8.64e15;

function validWindow(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 &&
    Number.isFinite(value * 60_000) && Math.abs(Date.now() - value * 60_000) <= MAX_DATE_MS;
}

export function parsePollOptions(body: unknown): ParsedOptions {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "JSON body must be an object" };
  const input = body as Record<string, unknown>;
  for (const field of ["manual_run", "force_rediscovery"]) {
    if (input[field] !== undefined && typeof input[field] !== "boolean") return { ok: false, error: field + " must be a boolean" };
  }
  if (input.lookback_minutes !== undefined && !validWindow(input.lookback_minutes)) {
    return { ok: false, error: "lookback_minutes must be a positive finite number of minutes" };
  }
  return { ok: true, options: { manual_run: input.manual_run === true, force_rediscovery: input.force_rediscovery === true,
    lookback_minutes: input.lookback_minutes as number | undefined } };
}

export function pollWindowMinutes(explicit: unknown, configured: unknown, initial?: unknown, firstPoll = false): number {
  if (validWindow(explicit)) return explicit;
  if (firstPoll) return validWindow(initial) ? initial : 10080;
  return validWindow(configured) ? configured : 15;
}

export function cooldownRemainingSeconds(now: number, ...deadlines: unknown[]): number {
  const timestamps = deadlines.map(value => typeof value === "string" ? Date.parse(value) : NaN).filter(Number.isFinite);
  return Math.max(0, Math.ceil((Math.max(now, ...timestamps) - now) / 1000));
}

/** Keep the existing 120-second floor; never shorten a valid parsed Retry-After. */
export function rateLimitSeconds(retryAfter: unknown): number {
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0 &&
    Date.now() + Math.ceil(retryAfter) * 1000 <= MAX_DATE_MS ? Math.max(120, Math.ceil(retryAfter)) : 120;
}

export function legacyWindowStart(input: {
  now: number; lookback?: number; configuredWindow: unknown; initialWindow?: unknown;
  lastSuccess?: unknown; bindingStart: string; forceRediscovery: boolean;
}): string {
  const cursorMs = typeof input.lastSuccess === "string" ? Date.parse(input.lastSuccess) : NaN;
  const window = pollWindowMinutes(input.lookback, input.configuredWindow, input.initialWindow, !Number.isFinite(cursorMs));
  let start = input.now - window * 60_000;
  if (Number.isFinite(cursorMs) && !input.forceRediscovery) start = Math.max(start, cursorMs - 120_000);
  const bindingMs = Date.parse(input.bindingStart);
  if (Number.isFinite(bindingMs)) start = Math.max(start, bindingMs);
  return new Date(Math.min(input.now, start)).toISOString();
}
