// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cooldownRemainingSeconds, legacyWindowStart, parsePollOptions, pollWindowMinutes, rateLimitSeconds } from '../../supabase/functions/ssx-poll-positions/poll-policy.ts';

const now = Date.parse('2026-10-06T13:19:00Z');
const base = { now, configuredWindow: 15, lastSuccess: '2026-10-04T00:00:00Z', bindingStart: '2026-10-01T00:00:00Z', forceRediscovery: false };
describe('SSX explicit polling controls', () => {
  it.each([null, [], false, 'body'])('rejects non-object request %j', body => {
    expect(parsePollOptions(body).ok).toBe(false);
  });
  it('defaults omitted flags to false and preserves JSON booleans', () => {
    expect(parsePollOptions({})).toEqual({ ok: true, options: { manual_run: false, force_rediscovery: false, lookback_minutes: undefined } });
    expect(parsePollOptions({ manual_run: true, force_rediscovery: false }).ok).toBe(true);
  });
  it.each(['false', 'true', 0, 1, null, [], {}])('rejects truthy/coerced flag %j', value => {
    for (const field of ['manual_run', 'force_rediscovery']) expect(parsePollOptions({ [field]: value })).toMatchObject({ ok: false });
  });
  it.each([0, -1, NaN, Infinity, Number.MAX_VALUE, '5', null])('rejects invalid window %s', value => {
    expect(parsePollOptions({ lookback_minutes: value }).ok).toBe(false);
  });
  it.each([0.5, 5, 43200])('accepts explicit finite window %s including FleetMap 30 days', value => {
    expect(parsePollOptions({ lookback_minutes: value })).toMatchObject({ ok: true, options: { lookback_minutes: value } });
  });
  it('preserves configured/default initial window while explicit lookback always wins', () => {
    expect(pollWindowMinutes(5, 15, 10080, true)).toBe(5);
    expect(pollWindowMinutes(undefined, 15, 60, true)).toBe(60);
    expect(pollWindowMinutes(undefined, 15, undefined, true)).toBe(10080);
    expect(pollWindowMinutes(undefined, 15)).toBe(15);
    expect(pollWindowMinutes(undefined, -1)).toBe(15);
  });
  it('uses the latest of account/settings cooldowns, ignores expired/invalid dates', () => {
    expect(cooldownRemainingSeconds(now, '2026-10-06T13:21:00Z', '2026-10-06T13:29:00Z')).toBe(600);
    expect(cooldownRemainingSeconds(now, 'invalid', '2026-10-06T13:18:00Z')).toBe(0);
  });
  it.each([[600, 600], [600.1, 601], [86400, 86400], [30, 120], [0, 120], [-1, 120], [undefined, 120], [NaN, 120], ['600', 120]])('retains Retry-After %s as %s seconds with legacy floor', (value, expected) => {
    expect(rateLimitSeconds(value)).toBe(expected);
  });
  it('honors five minutes with stale and invalid cursors instead of implicit 24 hours', () => {
    expect(legacyWindowStart({ ...base, lookback: 5 })).toBe('2026-10-06T13:14:00.000Z');
    expect(legacyWindowStart({ ...base, lookback: 5, lastSuccess: 'invalid' })).toBe('2026-10-06T13:14:00.000Z');
    expect(legacyWindowStart(base)).toBe('2026-10-06T13:04:00.000Z');
  });
  it('keeps overlap, binding clamp, future clamp and explicit rediscovery', () => {
    expect(legacyWindowStart({ ...base, lookback: 5, lastSuccess: '2026-10-06T13:18:00Z' })).toBe('2026-10-06T13:16:00.000Z');
    expect(legacyWindowStart({ ...base, lookback: 5, bindingStart: '2026-10-06T13:18:00Z' })).toBe('2026-10-06T13:18:00.000Z');
    expect(legacyWindowStart({ ...base, lastSuccess: '2099-01-01T00:00:00Z' })).toBe('2026-10-06T13:19:00.000Z');
    expect(legacyWindowStart({ ...base, lookback: 5, lastSuccess: '2026-10-06T13:18:00Z', forceRediscovery: true })).toBe('2026-10-06T13:14:00.000Z');
  });
});
