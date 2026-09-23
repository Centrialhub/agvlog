import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('recuperação da paginação dos filtros de acertos', () => {
  it('descarta a revisão divergente e retorna cada catálogo à primeira página', () => {
    const hook = readFileSync('src/hooks/useDriverSettlements.tsx', 'utf8');
    const page = readFileSync('src/pages/DriverSettlements.tsx', 'utf8');
    const dialog = readFileSync('src/components/financial/NewManualSettlementDialog.tsx', 'utf8');
    expect(hook).toContain('settlementFilterRevisions.delete(key)');
    expect(hook).toContain("DriverSettlementSnapshotChangedError('As opções mudaram");
    expect(page).toContain('driverOptions.error instanceof DriverSettlementSnapshotChangedError');
    expect(page).toContain('vehicleOptions.error instanceof DriverSettlementSnapshotChangedError');
    expect(page).toContain('else setDriverOptionPage(1)');
    expect(page).toContain('else setVehicleOptionPage(1)');
    expect(dialog).toContain('driverOptions.isError');
    expect(dialog).toContain('vehicleOptions.isError');
    expect(dialog).toContain('Tentar carregar motoristas novamente');
    expect(dialog).toContain('Tentar carregar veículos novamente');
    expect(dialog).toContain('Nenhum motorista encontrado.');
    expect(dialog).toContain('Nenhum veículo encontrado.');
  });
});
