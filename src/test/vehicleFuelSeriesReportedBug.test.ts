import { describe, expect, it } from 'vitest';
import { fuelUnitLabel, summarizeFuelSeries } from '@/lib/fleet/fuelSeries';

describe('série de combustível da ficha do veículo', () => {
  it('não compara nem mistura no gráfico leituras em percentual e litros', () => {
    expect(summarizeFuelSeries([
      { fuel_value: 80, fuel_unit: 'percent' },
      { fuel_value: 40, fuel_unit: 'liters' },
    ])).toMatchObject({ comparable: false, difference: null, unavailableReason: 'mixed_units' });
  });

  it('calcula variação apenas em uma unidade reconhecida e rotula cada unidade', () => {
    expect(summarizeFuelSeries([
      { fuel_value: 80, fuel_unit: 'liters' },
      { fuel_value: 40, fuel_unit: 'liters' },
    ])).toMatchObject({ comparable: true, difference: 40, unavailableReason: null });
    expect(fuelUnitLabel('liters')).toBe('L');
    expect(fuelUnitLabel('percent')).toBe('%');
    expect(fuelUnitLabel('gallons')).toBe('gallons');
  });
});
