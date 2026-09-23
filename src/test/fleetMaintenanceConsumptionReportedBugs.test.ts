import { describe, expect, it } from 'vitest';
import { calculateConsumptionHistory } from '@/hooks/useFleetManagement';
import { maintenanceAlertDate, maintenanceAlertHorizon, maintenanceFormError } from '@/lib/fleet/maintenanceSchedule';

const fueling = (fueled_at: string, odometer_km: number, liters: number, total_cost: number, is_full_tank: boolean) =>
  ({ fueled_at, odometer_km, liters, total_cost, is_full_tank });

describe('manutenção e consumo da frota', () => {
  it('calcula o horizonte no mesmo calendário e prioriza a obrigação agendada atual', () => {
    expect(maintenanceAlertHorizon('2026-09-21')).toBe('2026-09-28');
    expect(maintenanceAlertDate({ scheduled_date: '2026-09-21', next_date: '2027-01-01' })).toBe('2026-09-21');
    expect(maintenanceAlertDate({ scheduled_date: null, next_date: '2027-01-01' })).toBe('2027-01-01');
  });

  it('impede manutenção vazia e exige descrição e ao menos um gatilho', () => {
    expect(maintenanceFormError({ description: '', scheduledDate: '', nextDate: '', nextOdometer: '' })).toContain('descrição');
    expect(maintenanceFormError({ description: 'Troca de óleo', scheduledDate: '', nextDate: '', nextOdometer: '' })).toContain('data agendada');
    expect(maintenanceFormError({ description: 'Troca de óleo', scheduledDate: '2026-09-30', nextDate: '', nextOdometer: '' })).toBeNull();
  });

  it('soma abastecimentos parciais entre dois tanques cheios', () => {
    const result = calculateConsumptionHistory([
      fueling('2026-09-01T10:00:00Z', 1_000, 50, 300, true),
      fueling('2026-09-05T10:00:00Z', 1_100, 10, 60, false),
      fueling('2026-09-10T10:00:00Z', 1_200, 30, 180, true),
    ]);
    expect(result.consumption).toEqual([expect.objectContaining({ km: 200, liters: 40, kmPerLiter: 5, costPerKm: 1.2 })]);
  });

  it('pondera a média global por distância e litros', () => {
    const result = calculateConsumptionHistory([
      fueling('2026-09-01T10:00:00Z', 0, 40, 200, true),
      fueling('2026-09-02T10:00:00Z', 100, 10, 50, true),
      fueling('2026-09-10T10:00:00Z', 1_000, 100, 500, true),
    ]);
    expect(result.avgKmPerLiter).toBeCloseTo(1_000 / 110);
    expect(result.avgKmPerLiter).not.toBeCloseTo((10 + 9) / 2);
  });
});
