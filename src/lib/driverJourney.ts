export const JOURNEY_EVENT_TYPES = [
  'start_shift',
  'lunch',
  'rest',
  'overnight',
  'resume',
  'end_shift',
] as const;

export type JourneyEventType = typeof JOURNEY_EVENT_TYPES[number];
export type DriverJourneyState = 'not_started' | 'working' | 'paused' | 'ended';

type JourneyEvent = {
  event_type: string;
};

export const getDriverJourneyState = (
  events: readonly JourneyEvent[],
): DriverJourneyState => {
  const latest = [...events]
    .reverse()
    .find((event) => JOURNEY_EVENT_TYPES.includes(event.event_type as JourneyEventType));

  if (!latest) return 'not_started';
  if (latest.event_type === 'end_shift') return 'ended';
  if (['lunch', 'rest', 'overnight'].includes(latest.event_type)) return 'paused';
  return 'working';
};

export const canRecordJourneyEvent = (
  state: DriverJourneyState,
  eventType: JourneyEventType,
) => {
  if (state === 'not_started' || state === 'ended') return eventType === 'start_shift';
  if (state === 'working') {
    return ['lunch', 'rest', 'overnight', 'end_shift'].includes(eventType);
  }
  if (state === 'paused') return eventType === 'resume';
  return false;
};
