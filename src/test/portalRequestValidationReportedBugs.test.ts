import { describe, expect, it } from 'vitest';
import {
  futurePortalPickupIso,
  normalizePortalPickupCancellationReason,
  normalizePortalOccurrence,
  PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH,
  PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH,
} from '@/lib/portal/portalRequestValidation';

describe('validação das solicitações do portal', () => {
  it('normaliza ocorrência válida antes do envio', () => {
    expect(normalizePortalOccurrence({
      client_id: 'client-1',
      event_type: '  Avaria  ',
      severity: ' HIGH ',
      description: '  Embalagem danificada durante o transporte.  ',
    })).toEqual({
      client_id: 'client-1',
      event_type: 'Avaria',
      severity: 'high',
      description: 'Embalagem danificada durante o transporte.',
    });
  });

  it('rejeita campos vazios após trim e campos acima dos limites', () => {
    const base = { client_id: 'client-1', event_type: 'Avaria', severity: 'medium', description: 'Descrição válida' };
    expect(() => normalizePortalOccurrence({ ...base, event_type: '   ' })).toThrow();
    expect(() => normalizePortalOccurrence({ ...base, description: '   ' })).toThrow();
    expect(() => normalizePortalOccurrence({ ...base, event_type: 'x'.repeat(PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH + 1) })).toThrow();
    expect(() => normalizePortalOccurrence({ ...base, description: 'x'.repeat(PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH + 1) })).toThrow();
    expect(() => normalizePortalOccurrence({ ...base, severity: 'urgent' })).toThrow();
  });

  it('aceita somente data de coleta futura', () => {
    const now = Date.parse('2026-09-21T12:00:00.000Z');
    expect(futurePortalPickupIso('2026-09-21T10:00', now)).toBe('2026-09-21T13:00:00.000Z');
    expect(() => futurePortalPickupIso('2026-09-21T08:00', now)).toThrow('devem estar no futuro');
  });

  it('exige uma justificativa útil e limitada para cancelar coleta', () => {
    expect(normalizePortalPickupCancellationReason('  Cliente desistiu da coleta.  ')).toBe('Cliente desistiu da coleta.');
    expect(() => normalizePortalPickupCancellationReason('   ')).toThrow();
    expect(() => normalizePortalPickupCancellationReason('curto')).toThrow();
  });
});
