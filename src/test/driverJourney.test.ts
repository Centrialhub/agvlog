import { describe, expect, it } from 'vitest';

import { canRecordJourneyEvent, getDriverJourneyState } from '@/lib/driverJourney';

describe('driver journey state machine', () => {
  it('starts with only start shift available', () => {
    const state = getDriverJourneyState([]);
    expect(state).toBe('not_started');
    expect(canRecordJourneyEvent(state, 'start_shift')).toBe(true);
    expect(canRecordJourneyEvent(state, 'lunch')).toBe(false);
    expect(canRecordJourneyEvent(state, 'resume')).toBe(false);
  });

  it('allows a pause or end while working but rejects duplicate starts', () => {
    const state = getDriverJourneyState([{ event_type: 'start_shift' }]);
    expect(state).toBe('working');
    expect(canRecordJourneyEvent(state, 'lunch')).toBe(true);
    expect(canRecordJourneyEvent(state, 'end_shift')).toBe(true);
    expect(canRecordJourneyEvent(state, 'start_shift')).toBe(false);
  });

  it('requires resume after every pause', () => {
    const state = getDriverJourneyState([
      { event_type: 'start_shift' },
      { event_type: 'rest' },
    ]);
    expect(state).toBe('paused');
    expect(canRecordJourneyEvent(state, 'resume')).toBe(true);
    expect(canRecordJourneyEvent(state, 'rest')).toBe(false);
    expect(canRecordJourneyEvent(state, 'end_shift')).toBe(false);
  });

  it('permits only a new start after the shift ends', () => {
    const state = getDriverJourneyState([
      { event_type: 'start_shift' },
      { event_type: 'end_shift' },
    ]);
    expect(state).toBe('ended');
    expect(canRecordJourneyEvent(state, 'resume')).toBe(false);
    expect(canRecordJourneyEvent(state, 'start_shift')).toBe(true);
  });
});
