import { describe, expect, it } from 'vitest';
import { isOperationallyActiveLoad, vehicleOccupancyPercentage } from '@/lib/reports/operationsDashboardMetrics';
import { deliverySuccessRate } from '@/lib/reports/productivityMetrics';

describe('cargas ativas do painel operacional', () => {
  it.each(['delivered', 'divergent', 'cancelled', 'partial_delivery', 'returned', 'refused', 'failed'])(
    'exclui o estado terminal %s',
    status => expect(isOperationallyActiveLoad(status)).toBe(false),
  );

  it('mantém uma carga em trânsito como ativa', () => {
    expect(isOperationallyActiveLoad('in_transit')).toBe(true);
  });
});

describe('ocupação do veículo no painel operacional', () => {
  it('preserva a magnitude da sobrecarga', () => {
    expect(vehicleOccupancyPercentage(30, 20)).toBe(150);
  });
});

describe('sucesso de entrega do painel operacional', () => {
  it('não inventa 100% sem desfechos concluídos', () => {
    expect(deliverySuccessRate([{ status: 'in_transit' }])).toBeNull();
  });

  it('reduz a taxa para cada desfecho terminal malsucedido', () => {
    expect(deliverySuccessRate([
      { status: 'delivered' },
      { status: 'returned' },
      { status: 'refused' },
      { status: 'failed' },
      { status: 'partial_delivery' },
    ])).toBe(20);
  });
});
