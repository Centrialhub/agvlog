import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDriverDeliveryEvent } from '@/components/driver/deliveries/driverDeliveryEvents';

const deliveries = readFileSync('src/pages/driver/DriverDeliveries.tsx', 'utf8');
const form = readFileSync('src/components/driver/deliveries/DriverDeliveryEventFormSheet.tsx', 'utf8');

describe('reported driver delivery event regressions', () => {
  it.each(['cliente_recusou', 'cliente_estava_fora'])('classifies %s as a finalizer', key => {
    expect(getDriverDeliveryEvent(key)).toMatchObject({ category: 'finalizador', finalAction: 'refused' });
  });

  it('requires and serializes a fiscal snapshot only for finalizers', () => {
    expect(deliveries).toContain("if(def.category==='finalizador'&&!fiscalSnapshot)");
    expect(deliveries).toContain("...(def.category==='finalizador'&&fiscalSnapshot?");
    expect(deliveries).toContain("const requiresFiscalSnapshot = def?.category === 'finalizador'");
  });

  it('does not promise an optional signature control that is absent', () => {
    expect(form).not.toContain('Assinatura opcional');
    expect(form).toContain('{def.requiresSignature && <ActionButton');
    expect(form).toContain("{def.requiresSignature && <div id=\"sig-anchor\" />}");
  });
});
