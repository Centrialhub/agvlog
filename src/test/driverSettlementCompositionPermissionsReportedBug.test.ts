import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canDeleteDriverSettlement,
  canEditSettlementComposition,
  canApproveDriverSettlementWithException,
  getAllowedDriverSettlementTransitions,
} from '@/hooks/useDriverSettlements';

describe('edição da composição do acerto', () => {
  it('permite alterar romaneios somente nos estados aceitos pelo banco', () => {
    expect(canEditSettlementComposition('pending_review')).toBe(true);
    expect(canEditSettlementComposition('in_review')).toBe(true);
    expect(canEditSettlementComposition('reopened')).toBe(true);
    expect(canEditSettlementComposition('approved')).toBe(false);
    expect(canEditSettlementComposition('paid')).toBe(false);
    expect(canEditSettlementComposition('closed')).toBe(false);
  });

  it('aplica a permissão de composição ao botão de nova despesa', () => {
    const drawer = readFileSync('src/components/financial/DriverSettlementDrawer.tsx', 'utf8');
    expect(drawer).toContain('<Button size="sm" disabled={!canEditComposition}><Plus');
  });

  it('reserva a exclusão de acertos pagos ou fechados para administradores', () => {
    expect(canDeleteDriverSettlement('operator', 'pending_review')).toBe(true);
    expect(canDeleteDriverSettlement('operator', 'paid')).toBe(false);
    expect(canDeleteDriverSettlement('operator', 'closed')).toBe(false);
    expect(canDeleteDriverSettlement('admin', 'paid')).toBe(true);
    expect(canDeleteDriverSettlement('owner', 'closed')).toBe(true);
    expect(canDeleteDriverSettlement('driver', 'pending_review')).toBe(false);
  });

  it('oferece novo pagamento somente para acertos aprovados ou pagos e atualizados', () => {
    const drawer = readFileSync('src/components/financial/DriverSettlementDrawer.tsx', 'utf8');
    expect(drawer).toContain("!needsRecalc && (s?.status === 'approved' || s?.status === 'paid')");
    expect(drawer).toContain('disabled={!canRecordNewPayment}');
    expect(drawer).toContain('allowNew={canRecordNewPayment && !paymentRecoveryOnly}');
  });

  it('habilita recálculo somente quando a composição ainda pode ser reconstruída', () => {
    const drawer = readFileSync('src/components/financial/DriverSettlementDrawer.tsx', 'utf8');
    expect(drawer).toContain('disabled={!canEditComposition || regen.isPending');
  });

  it('não oferece reabertura de acerto pago ou fechado para operador', () => {
    expect(getAllowedDriverSettlementTransitions('operator', 'paid')).toEqual(['closed']);
    expect(getAllowedDriverSettlementTransitions('operator', 'closed')).toEqual([]);
    expect(getAllowedDriverSettlementTransitions('admin', 'paid')).toContain('reopened');
    expect(getAllowedDriverSettlementTransitions('owner', 'closed')).toEqual(['reopened']);
  });

  it('permite devolver um acerto em conferência para pendente', () => {
    expect(getAllowedDriverSettlementTransitions('operator', 'in_review')).toEqual([
      'approved',
      'pending_review',
    ]);
  });

  it('reserva a aprovação com exceção para administradores', () => {
    expect(canApproveDriverSettlementWithException('operator')).toBe(false);
    expect(canApproveDriverSettlementWithException('driver')).toBe(false);
    expect(canApproveDriverSettlementWithException('admin')).toBe(true);
    expect(canApproveDriverSettlementWithException('owner')).toBe(true);
  });
});
