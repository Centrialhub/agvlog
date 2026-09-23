import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('isolamento das justificativas do acerto', () => {
  it('limpa diálogos e motivos ao fechar ou trocar o acerto', () => {
    const drawer = readFileSync('src/components/financial/DriverSettlementDrawer.tsx', 'utf8');
    expect(drawer).toContain("setApproveOpen(false); setExceptionReason('')");
    expect(drawer).toContain("setZeroOpen(false); setZeroReason('')");
    expect(drawer).toContain("setCloseOpen(false); setCloseReason('')");
    expect(drawer).toContain("setDeleteOpen(false); setDeleteReason('')");
    expect(drawer).toContain('[open, settlementId]');
  });

  it('oferece o fechamento excepcional para acertos aprovados', () => {
    const drawer = readFileSync('src/components/financial/DriverSettlementDrawer.tsx', 'utf8');
    const hook = readFileSync('src/hooks/useDriverSettlements.tsx', 'utf8');
    expect(hook).toContain("case 'approved': return isAdmin ? ['paid', 'closed'] : ['paid']");
    expect(drawer).toContain("next === 'closed' && s.status === 'approved'");
    expect(drawer).toContain('setCloseOpen(true)');
  });
});
