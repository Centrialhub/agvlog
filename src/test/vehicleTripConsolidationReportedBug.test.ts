import { describe, expect, it } from 'vitest';
import { shouldMergeVehicleTrips } from '@/lib/fleet/tripConsolidation';

const trip = (start_at: string, end_at: string | null, detection_mode = 'basic') => ({
  start_at, end_at, detection_mode,
});

describe('consolidação de viagens na ficha do veículo', () => {
  it('preserva viagens sequenciais mesmo quando o intervalo é menor que cinco minutos', () => {
    expect(shouldMergeVehicleTrips(
      trip('2026-09-22T10:00:00Z', '2026-09-22T10:30:00Z'),
      trip('2026-09-22T10:31:00Z', '2026-09-22T11:00:00Z'),
    )).toBe(false);
  });

  it('não mistura modos e só consolida fragmentos realmente sobrepostos do mesmo detector', () => {
    const current = trip('2026-09-22T10:00:00Z', '2026-09-22T10:30:00Z', 'basic');
    expect(shouldMergeVehicleTrips(current, trip('2026-09-22T10:20:00Z', '2026-09-22T10:40:00Z', 'ignition'))).toBe(false);
    expect(shouldMergeVehicleTrips(current, trip('2026-09-22T10:20:00Z', '2026-09-22T10:40:00Z', 'basic'))).toBe(true);
  });
});
