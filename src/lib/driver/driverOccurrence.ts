export interface DriverOccurrenceRpcInput {
  tripId: string;
  eventType: string;
  description: string;
  severity: string;
  stopId?: string | null;
  clientId?: string | null;
}

export interface DriverOccurrenceRpcArgs {
  _trip_id: string;
  _event_type: string;
  _description: string;
  _severity: string;
  _stop_id?: string;
  _client_id?: string;
}

export function buildDriverOccurrenceRpcArgs(
  input: DriverOccurrenceRpcInput,
): DriverOccurrenceRpcArgs {
  const stopId = input.stopId?.trim();
  const args: DriverOccurrenceRpcArgs = {
    _trip_id: input.tripId,
    _event_type: input.eventType,
    _description: input.description,
    _severity: input.severity,
  };

  // Omitting both optional arguments intentionally selects trip scope in the
  // database. A client can only be sent together with an explicit stop.
  if (stopId) {
    args._stop_id = stopId;
    const clientId = input.clientId?.trim();
    if (clientId) args._client_id = clientId;
  }

  return args;
}
