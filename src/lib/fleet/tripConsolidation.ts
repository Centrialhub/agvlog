type TripFragment = {
  start_at: string;
  end_at: string | null;
  detection_mode: string;
};

/** Só trata como fragmentos registros do mesmo detector que realmente se sobrepõem. */
export function shouldMergeVehicleTrips(current: TripFragment, next: TripFragment): boolean {
  if (!current.end_at || current.detection_mode !== next.detection_mode) return false;
  const currentEnd = Date.parse(current.end_at);
  const nextStart = Date.parse(next.start_at);
  return Number.isFinite(currentEnd) && Number.isFinite(nextStart) && nextStart <= currentEnd;
}
